import { reportEdgeError } from "../_shared/report-error.ts";
// ============================================================================
// check-unrecorded-streak - internal product-adoption alert.
//
// Runs on a schedule (pg_cron, see supabase/apply_cron.sql). For every active
// practice it counts how many of the most-recent PAST implant consults passed
// WITHOUT being recorded, in an unbroken run. When that run reaches the
// practice's threshold (per-practice unrecorded_streak_threshold, else the
// global default), it notifies US internally - the super admin + the practice's
// reseller owner - via email, Slack and (optionally) SMS, so someone can reach
// out personally and re-engage the customer.
//
// Audience is INTERNAL only (unlike notify-staff, which messages the practice).
//
// Debounce: unrecorded_streak_alerted_at is stamped on send and only re-fires
// after the cooldown; once the streak drops below the threshold it's cleared so
// the next fresh streak alerts again.
//
// Called server-to-server by cron with a service-role bearer.
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MAILGUN_API_KEY,
//          MAILGUN_DOMAIN. Optional: SLACK_WEBHOOK_URL (Slack alert),
//          STAFF_ALERT_SMS (internal phone for SMS) + Twilio creds,
//          UNRECORDED_STREAK_THRESHOLD (global default, else 5),
//          APP_URL (defaults to https://app.caselift.io).
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { CASELIFT_BRAND, escapeHtml, renderBrandedEmail } from "../_shared/brand.ts";
import { sendMailgunToMany } from "../_shared/mailgun.ts";
import { getTwilioConfig, sendSms } from "../_shared/twilio.ts";

const SUPER_ADMIN_EMAIL = "devyntgrillo@gmail.com";
const DEFAULT_THRESHOLD = 5;
// Only look back this far, so an old run of no-shows from before the customer
// went live doesn't trip the alert forever.
const LOOKBACK_DAYS = 120;
// Don't re-alert the same ongoing streak more than once per cooldown window.
const COOLDOWN_DAYS = 7;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Post to the dedicated adoption-alert Slack channel when configured, otherwise
// fall back to the shared SLACK_WEBHOOK_URL. Keeping a separate var lets these
// internal alerts land in their own channel without re-routing the other Slack
// notifications. (Inlined rather than importing notify-slack, whose top-level
// Deno.serve() would otherwise hijack this function's requests.)
async function postAdoptionSlack(text: string): Promise<{ sent: boolean; reason?: string }> {
  const url = Deno.env.get("ADOPTION_SLACK_WEBHOOK_URL") || Deno.env.get("SLACK_WEBHOOK_URL");
  if (!url) return { sent: false, reason: "not_configured" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return res.ok ? { sent: true } : { sent: false, reason: `slack_${res.status}` };
  } catch (e) {
    return { sent: false, reason: String((e as Error)?.message ?? e) };
  }
}

// Most-recent-first list of "was it recorded?" → leading run of unrecorded ones.
function leadingUnrecorded(appts: { consult_id: string | null }[]): number {
  let n = 0;
  for (const a of appts) {
    if (a.consult_id) break;
    n++;
  }
  return n;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const body = await req.json().catch(() => ({}));
    const appUrlBase = Deno.env.get("APP_URL") || "https://app.caselift.io";

    // Delivery smoke-test: send one sample alert through every channel to the
    // internal recipients (super admin + optional reseller email / SMS) without
    // touching any practice data. Trigger with { "test": true }.
    if (body.test) {
      const sampleName = "Sample Dental (TEST)";
      const internal = [...new Set([body.email, SUPER_ADMIN_EMAIL].filter(Boolean))] as string[];
      const line =
        `[TEST] ${sampleName} has let 5 implant consults pass without recording any of them ` +
        `(alert threshold: 5). This is a delivery test of the adoption alert - no real practice is affected.`;
      const htmlBody = renderBrandedEmail(CASELIFT_BRAND, {
        heading: `${escapeHtml(sampleName)} may be churning`,
        bodyHtml:
          `<p style="margin:0"><strong style="color:#e2e8f0">This is a delivery test</strong> of the consecutive-unrecorded adoption alert - no real practice is affected.</p>` +
          `<p style="margin:12px 0 0">A live alert looks like this: ${escapeHtml(sampleName)} has let <strong style="color:#e2e8f0">5 implant consults</strong> pass in a row without recording any of them (threshold 5).</p>`,
        button: { label: "Open CaseLift Admin", url: `${appUrlBase}/admin` },
        footerNote: "Internal adoption alert - the practice is not notified.",
      });
      const email = await sendMailgunToMany({
        to: internal,
        subject: "[Internal][TEST] Adoption alert delivery check",
        text: line,
        html: htmlBody,
        fromName: CASELIFT_BRAND.fromName,
        replyTo: CASELIFT_BRAND.supportEmail,
      });
      const slack = await postAdoptionSlack(
        `:test_tube: *Adoption alert delivery test* - this is what a live alert looks like:\n` +
        `:warning: *Adoption risk* - *${sampleName}* has skipped *5 consults in a row* (threshold 5). ` +
        `Reach out to re-engage. <${appUrlBase}/admin|Open Admin>`,
      );
      let sms: unknown = { sent: false, reason: "not_configured" };
      const tw = getTwilioConfig();
      const smsTo = Deno.env.get("STAFF_ALERT_SMS") || null;
      if (tw && smsTo) {
        try {
          const r = await sendSms(tw, { to: smsTo, from: tw.callerIdFallback || undefined, body: `CaseLift [TEST]: ${line}` });
          sms = { sent: true, sid: r.sid };
        } catch (e) {
          sms = { sent: false, reason: String((e as Error)?.message ?? e) };
        }
      }
      return json({ ok: true, test: true, recipients: internal, email, slack, sms });
    }

    const globalDefault = Number(Deno.env.get("UNRECORDED_STREAK_THRESHOLD")) || DEFAULT_THRESHOLD;
    const nowISO = new Date().toISOString();
    const sinceISO = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();
    const cooldownAgo = Date.now() - COOLDOWN_DAYS * 86400000;

    // Active, non-archived practices. A single practice_id can be passed for a
    // manual/test run.
    let pq = admin
      .from("practices")
      .select("id, name, email, agency_id, subscription_status, archived_at, unrecorded_streak_threshold, unrecorded_streak_alerted_at");
    if (body.practice_id) pq = pq.eq("id", body.practice_id);
    const { data: practices, error: pErr } = await pq;
    if (pErr) throw pErr;

    // All recent past implant consults, newest first, for the relevant practices.
    let aq = admin
      .from("pms_appointments")
      .select("practice_id, appointment_time, consult_id")
      .eq("is_implant_consult", true)
      .lte("appointment_time", nowISO)
      .gte("appointment_time", sinceISO)
      .order("appointment_time", { ascending: false });
    if (body.practice_id) aq = aq.eq("practice_id", body.practice_id);
    const { data: appts, error: aErr } = await aq;
    if (aErr) throw aErr;

    // Group appointments per practice, preserving the newest-first order.
    const byPractice = new Map<string, { consult_id: string | null }[]>();
    for (const a of appts || []) {
      const list = byPractice.get(a.practice_id) || [];
      list.push({ consult_id: a.consult_id });
      byPractice.set(a.practice_id, list);
    }

    // Cache reseller owner emails so we don't re-query per practice.
    const resellerEmailCache = new Map<string, string | null>();
    async function resellerEmail(agencyId: string | null): Promise<string | null> {
      if (!agencyId) return null;
      if (resellerEmailCache.has(agencyId)) return resellerEmailCache.get(agencyId)!;
      const { data } = await admin
        .from("agency_accounts")
        .select("owner_email")
        .eq("id", agencyId)
        .maybeSingle();
      const email = data?.owner_email ?? null;
      resellerEmailCache.set(agencyId, email);
      return email;
    }

    const appUrl = Deno.env.get("APP_URL") || "https://app.caselift.io";
    const twilio = getTwilioConfig();
    const staffSms = Deno.env.get("STAFF_ALERT_SMS") || null;

    const results: unknown[] = [];

    for (const p of practices || []) {
      if (p.archived_at) continue;
      if (!body.practice_id && (p.subscription_status === "cancelled" || p.subscription_status === "canceled")) continue;

      const threshold = Number(p.unrecorded_streak_threshold) || globalDefault;
      const streak = leadingUnrecorded(byPractice.get(p.id) || []);

      if (streak < threshold) {
        // Streak broken / below threshold → clear the debounce so a future run alerts.
        if (p.unrecorded_streak_alerted_at) {
          await admin.from("practices").update({ unrecorded_streak_alerted_at: null }).eq("id", p.id);
        }
        continue;
      }

      // At/above threshold - respect the cooldown (unless this is a manual run).
      const alertedAt = p.unrecorded_streak_alerted_at ? new Date(p.unrecorded_streak_alerted_at).getTime() : 0;
      if (!body.practice_id && alertedAt > cooldownAgo) {
        results.push({ practice_id: p.id, streak, threshold, skipped: "cooldown" });
        continue;
      }

      const name = p.name || "A practice";
      const internal = [...new Set([await resellerEmail(p.agency_id), SUPER_ADMIN_EMAIL].filter(Boolean))] as string[];

      // Email (internal, CaseLift-branded).
      const subject = `${name} has skipped ${streak} consults in a row`;
      const line =
        `${name} has let ${streak} implant consults pass without recording any of them ` +
        `(alert threshold: ${threshold}). This usually means they've stopped using CaseLift - ` +
        `reach out personally to re-engage them.`;
      const htmlBody = renderBrandedEmail(CASELIFT_BRAND, {
        heading: `${escapeHtml(name)} may be churning`,
        bodyHtml:
          `<p style="margin:0">${escapeHtml(name)} has let <strong style="color:#e2e8f0">${streak} implant consults</strong> ` +
          `pass in a row without recording any of them (alert threshold: ${threshold}).</p>` +
          `<p style="margin:12px 0 0">This is a strong adoption-risk signal. Reach out personally to re-engage them.</p>`,
        button: { label: "Open CaseLift Admin", url: `${appUrl}/admin` },
        footerNote: "Internal adoption alert - the practice is not notified.",
      });
      const email = internal.length
        ? await sendMailgunToMany({
            to: internal,
            subject: `[Internal] ${subject}`,
            text: line,
            html: htmlBody,
            fromName: CASELIFT_BRAND.fromName,
            replyTo: CASELIFT_BRAND.supportEmail,
          })
        : { sent: false, reason: "no_recipient" };

      // Slack (internal channel).
      const slack = await postAdoptionSlack(
        `:warning: *Adoption risk* - *${name}* has skipped *${streak} consults in a row* ` +
        `(threshold ${threshold}). Reach out to re-engage. <${appUrl}/admin|Open Admin>`,
      );

      // SMS (optional internal number).
      let sms: unknown = { sent: false, reason: "not_configured" };
      if (twilio && staffSms) {
        try {
          const r = await sendSms(twilio, {
            to: staffSms,
            from: twilio.callerIdFallback || undefined,
            body: `CaseLift: ${name} skipped ${streak} consults in a row (threshold ${threshold}). Reach out to re-engage.`,
          });
          sms = { sent: true, sid: r.sid };
        } catch (e) {
          sms = { sent: false, reason: String((e as Error)?.message ?? e) };
        }
      }

      await admin.from("practices").update({ unrecorded_streak_alerted_at: nowISO }).eq("id", p.id);
      results.push({ practice_id: p.id, name, streak, threshold, alerted: true, email, slack, sms });
    }

    return json({ ok: true, checked: (practices || []).length, alerts: results.filter((r) => (r as { alerted?: boolean }).alerted).length, results });
  } catch (e) {
    await reportEdgeError("check-unrecorded-streak", e);
    console.error("check-unrecorded-streak error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
