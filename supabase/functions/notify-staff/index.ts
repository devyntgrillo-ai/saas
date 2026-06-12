// ============================================================================
// notify-staff - shared notification dispatcher. Every event detector calls
// this with { practice_id, event_name, payload }. It:
//   1. Loads the practice + its notification_prefs JSONB.
//   2. For each channel (email, sms, slack) sends only when
//      notification_prefs[event_name][channel] is enabled (merged over sane
//      per-event defaults so it works before a practice ever toggles settings).
//   3. Email -> notify_email_address (or practice.email) via branded Mailgun.
//      SMS   -> notify_sms_number via the practice's Twilio number (staff alert;
//               NOT logged as a patient conversation).
//      Slack -> CaseLift's internal SLACK_WEBHOOK_URL only (never per-practice).
//   4. Always inserts a notifications row for the in-app bell.
//
// Fans out per-user: each practice member's own email/SMS/push prefs (from
// public.user_notification_settings + user_devices) decide delivery. Service-role
// only (called by detectors, crons, and a DB trigger via pg_net).
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { requireServiceRole } from "../_shared/auth.ts";
import { type Brand, escapeHtml, renderBrandedEmail, resolveBrand } from "../_shared/brand.ts";
import { sendMailgunMessage } from "../_shared/mailgun.ts";
import { getTwilioConfig, sendSms } from "../_shared/twilio.ts";
import { resolveTwilioSmsContext } from "../_shared/twilio-sms-context.ts";
import { patientInitials } from "../_shared/phi.ts";
import { resolvePracticeRecipients } from "../_shared/recipients.ts";
import { sendExpoPush } from "../_shared/expo-push.ts";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

const APP = (Deno.env.get("APP_URL") || "https://app.caselift.io").replace(/\/$/, "");
const money = (n: unknown) => "$" + (Number(n) || 0).toLocaleString();

// Channel defaults per event (email/sms/slack), mirroring the Settings UI.
// Merged under a practice's saved prefs so notifications work out of the box.
const DEFAULTS: Record<string, { email: boolean; sms: boolean; slack: boolean }> = {
  patient_replied: { email: true, sms: true, slack: true },
  case_converted: { email: true, sms: true, slack: true },
  daily_calls_due: { email: true, sms: true, slack: false },
  low_recording_rate: { email: true, sms: false, slack: true },
};

interface Built {
  subject: string;
  heading: string;
  bodyHtml: string;
  button: { label: string; url: string };
  smsText: string;
  slackText: string;
  bellTitle: string;
  bellMessage?: string;
  link: string;
}

// deno-lint-ignore no-explicit-any
function build(event: string, p: any, practiceName: string): Built {
  const name = escapeHtml(String(p?.patient_name ?? "A patient"));
  const rawName = String(p?.patient_name ?? "A patient");
  // Initials only for low-trust sinks (Slack channels, email subject lines that
  // transit/log externally). The in-app bell, email body, and staff SMS keep the
  // full name, that's the practice viewing its own patients (treatment ops).
  const initials = patientInitials(rawName);
  switch (event) {
    case "patient_replied": {
      const prev = String(p?.message_preview ?? "").slice(0, 100);
      const link = p?.conversation_url || `${APP}/conversations`;
      return {
        // Generic subject, no patient identifier in the email header (it transits
        // and is logged/previewed externally). The name stays in the body, which
        // is the practice viewing its own patient (treatment ops).
        subject: `New patient reply`,
        heading: `${rawName} replied`,
        bodyHtml:
          `<p style="margin:0">${name} replied to your CaseLift sequence.</p>` +
          (prev ? `<p style="margin:14px 0 0;color:#cbd5e1">&ldquo;${escapeHtml(prev)}&rdquo;</p>` : "") +
          `<p style="margin:14px 0 0">Click below to view the conversation.</p>`,
        button: { label: "View Conversation", url: link },
        smsText: `CaseLift: ${rawName} replied. Log in to respond: app.caselift.io/conversations`,
        // Slack: initials only, and NO message content (it can quote the patient).
        slackText: `💬 *Patient Reply*\nPractice: ${practiceName}\nPatient: ${initials}`,
        bellTitle: `${rawName} replied`,
        bellMessage: prev || undefined,
        link: "/conversations",
      };
    }
    case "case_converted": {
      const amount = money(p?.case_value);
      const tx = p?.treatment_type ? escapeHtml(String(p.treatment_type)) : ", ";
      const link = p?.consult_id ? `${APP}/consults/${p.consult_id}` : `${APP}/`;
      return {
        subject: `🏆 Case converted, ${amount}`,
        heading: "Case converted",
        bodyHtml:
          `<p style="margin:0">A case was just marked as converted in CaseLift.</p>` +
          `<p style="margin:14px 0 0"><strong style="color:#e2e8f0">Patient:</strong> ${name}<br />` +
          `<strong style="color:#e2e8f0">Treatment:</strong> ${tx}<br />` +
          `<strong style="color:#e2e8f0">Case Value:</strong> ${amount}</p>`,
        button: { label: "View Dashboard", url: `${APP}/` },
        smsText: `CaseLift Win 🏆 ${rawName} just converted. ${amount} case. app.caselift.io`,
        slackText: `🏆 *Case Converted*\nPractice: ${practiceName}\nPatient: ${initials}\nTreatment: ${p?.treatment_type ?? ", "}\nValue: ${amount}`,
        bellTitle: `🏆 Case converted, ${amount}`,
        bellMessage: `${rawName} · ${p?.treatment_type ?? ""}`.trim(),
        link,
      };
    }
    case "daily_calls_due": {
      const names: string[] = Array.isArray(p?.patient_names) ? p.patient_names.map((s: unknown) => String(s)) : [];
      const count = Number(p?.count) || names.length;
      const listHtml = names.length
        ? `<ul style="margin:14px 0 0;padding-left:20px;color:#94a3b8;line-height:1.8">` +
          names.map((n) => `<li>${escapeHtml(n)}</li>`).join("") + `</ul>`
        : "";
      const plural = count === 1 ? "" : "s";
      return {
        subject: `${count} follow-up call${plural} due today`,
        heading: "Calls due today",
        bodyHtml:
          `<p style="margin:0">You have <strong style="color:#e2e8f0">${count}</strong> follow-up call${plural} ` +
          `scheduled for today.</p>${listHtml}`,
        button: { label: "View Patients", url: `${APP}/consults` },
        smsText: `CaseLift: ${count} follow-up call${plural} due today. app.caselift.io`,
        slackText: `📞 *Calls Due Today*\nPractice: ${practiceName}\n${count} call${plural}${names.length ? ": " + names.map((n) => patientInitials(n)).join(", ") : ""}`,
        bellTitle: `${count} call${plural} due today`,
        bellMessage: names.slice(0, 5).join(", ") || undefined,
        link: "/consults",
      };
    }
    case "low_recording_rate": {
      const wk = Number(p?.consults_this_week) || 0;
      const avg = Number(p?.previous_week_average) || 0;
      return {
        subject: "Recording rate is down this week",
        heading: "Recording rate is down this week",
        bodyHtml:
          `<p style="margin:0">Your team recorded <strong style="color:#e2e8f0">${wk}</strong> consults this week, ` +
          `which is below your average of <strong style="color:#e2e8f0">${avg}</strong>.</p>` +
          `<p style="margin:14px 0 0">Make sure your TC is recording every consultation to get the most out of CaseLift.</p>`,
        button: { label: "View Consults", url: `${APP}/consults` },
        smsText: `CaseLift: recording rate down, ${wk} consults this week (avg ${avg}). app.caselift.io/consults`,
        slackText: `📉 *Low Recording Rate*\nPractice: ${practiceName}\n${wk} consults this week (avg ${avg})`,
        bellTitle: "Recording rate is down this week",
        bellMessage: `${wk} this week · avg ${avg}`,
        link: "/consults",
      };
    }
    default: {
      // Generic fallback (e.g. ai_update).
      const msg = p?.message ? String(p.message) : "Update from CaseLift.";
      return {
        subject: "CaseLift update",
        heading: "CaseLift update",
        bodyHtml: `<p style="margin:0">${escapeHtml(msg)}</p>`,
        button: { label: "Open CaseLift", url: `${APP}/` },
        smsText: `CaseLift: ${msg} app.caselift.io`,
        slackText: `🔔 *CaseLift*\nPractice: ${practiceName}\n${msg}`,
        bellTitle: "CaseLift update",
        bellMessage: msg,
        link: "/",
      };
    }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const authErr = requireServiceRole(req);
  if (authErr) return authErr;
  try {
    const body = await req.json().catch(() => ({}));
    const practiceId: string | undefined = body.practice_id;
    const eventName: string | undefined = body.event_name;
    const payload = body.payload ?? {};
    if (!practiceId || !eventName) return json({ error: "practice_id and event_name are required" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: practice } = await admin
      .from("practices")
      .select(
        "id, name, email, notification_prefs, notify_email_address, notify_sms_number, " +
          "sms_enabled, twilio_phone_number, twilio_phone_e164, twilio_messaging_service_sid, a2p_brand_status, a2p_campaign_status, agency_id",
      )
      .eq("id", practiceId)
      .maybeSingle();
    if (!practice) return json({ error: "Practice not found" }, 404);

    const brand: Brand = await resolveBrand(admin, practice);
    const t = build(eventName, payload, practice.name || "your practice");
    const results: Record<string, unknown> = { event: eventName, recipients: [] as unknown[] };
    const perUser = results.recipients as unknown[];

    // 1) In-app bell: one practice-wide row (user_id null) — every member's bell
    // shows it, unchanged from prior behavior.
    let bell: Record<string, unknown>;
    try {
      await admin.from("notifications").insert({
        practice_id: practiceId,
        type: eventName,
        event: eventName,
        title: t.bellTitle,
        message: t.bellMessage,
        link: t.link,
      });
      bell = { sent: true };
    } catch (e) {
      bell = { sent: false, error: String((e as Error)?.message ?? e) };
    }
    results.bell = bell;

    // 2) Per-user fan-out: email / sms / push gated by each member's own prefs.
    const recipients = await resolvePracticeRecipients(admin, practiceId, eventName);
    const cfg = getTwilioConfig();
    // deno-lint-ignore no-explicit-any
    const smsCtx = cfg ? resolveTwilioSmsContext(practice as any, cfg) : null;
    const html = renderBrandedEmail(brand, { heading: t.heading, bodyHtml: t.bodyHtml, button: t.button });
    const invalidTokens: string[] = [];

    for (const r of recipients) {
      const ch: Record<string, unknown> = {};
      // Email
      if (r.prefs.email && r.email) {
        ch.email = await sendMailgunMessage({
          to: r.email,
          subject: t.subject,
          text: `${t.heading}\n\n${t.button.label}: ${t.button.url}`,
          html,
          fromName: brand.fromName,
          replyTo: brand.supportEmail,
        });
      } else if (r.prefs.email) {
        ch.email = { sent: false, reason: "no_email_address" };
      }
      // SMS (staff alert via the practice's Twilio number; not a patient convo).
      if (r.prefs.sms && r.sms) {
        if (!cfg) ch.sms = { sent: false, reason: "twilio_not_configured" };
        else if (!smsCtx?.ok) ch.sms = { sent: false, reason: smsCtx?.code ?? "no_twilio_context" };
        else {
          try {
            const sr = await sendSms(cfg, {
              messagingServiceSid: smsCtx.mode === "messaging_service" ? smsCtx.messagingServiceSid : undefined,
              from: smsCtx.mode !== "messaging_service" ? smsCtx.from : undefined,
              to: r.sms,
              body: t.smsText,
            });
            ch.sms = { sent: true, sid: sr.sid };
          } catch (e) {
            ch.sms = { sent: false, error: String((e as Error)?.message ?? e) };
          }
        }
      } else if (r.prefs.sms) {
        ch.sms = { sent: false, reason: "no_sms_number" };
      }
      // Push (Expo). Initials only — push payloads transit Apple/Google.
      if (r.prefs.push && r.pushTokens.length) {
        const pr = await sendExpoPush(r.pushTokens, {
          title: t.bellTitle,
          body: t.bellMessage,
          data: { event: eventName, link: t.link, practice_id: practiceId },
        });
        invalidTokens.push(...pr.invalidTokens);
        ch.push = { sent: pr.sent, errors: pr.errors.length ? pr.errors : undefined };
      }
      perUser.push({ user_id: r.userId, channels: ch });
    }

    // Prune dead device tokens reported by Expo (DeviceNotRegistered).
    if (invalidTokens.length) {
      try {
        await admin.from("user_devices").delete().in("expo_push_token", invalidTokens);
      } catch { /* best-effort */ }
    }

    // 3) Slack, CaseLift's internal channel ONLY (global env webhook). We do not
    // route to per-practice Slack workspaces: PHI must stay inside our own
    // BAA-covered Slack, never a workspace we can't verify is HIPAA-configured.
    // Not per-user — fires once per event based on the internal default.
    const ch = results as Record<string, unknown>;
    if (DEFAULTS[eventName]?.slack) {
      const webhook = Deno.env.get("SLACK_WEBHOOK_URL");
      if (!webhook) ch.slack = { sent: false, reason: "no_webhook" };
      else {
        try {
          const r = await fetch(webhook, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: t.slackText }),
          });
          ch.slack = { sent: r.ok, status: r.status };
        } catch (e) {
          ch.slack = { sent: false, error: String((e as Error)?.message ?? e) };
        }
      }
    }

    return json({ ok: true, ...results });
  } catch (e) {
    console.error("notify-staff error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
