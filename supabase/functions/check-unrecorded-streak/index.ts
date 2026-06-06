import { reportEdgeError } from "../_shared/report-error.ts";
// ============================================================================
// check-unrecorded-streak - low-recording / product-adoption alert.
//
// Runs on a schedule (pg_cron, see supabase/apply_cron.sql). For every active
// practice it counts how many of the most-recent PAST implant consults passed
// WITHOUT being recorded, in an unbroken run. When that run reaches the
// practice's threshold (per-practice unrecorded_streak_threshold, else the
// global default) it:
//
//   1. INTERNAL: always posts a Slack alert to our adoption channel, so we can
//      reach out personally and re-engage the customer. (No internal email.)
//   2. CLIENT: emails the PRACTICE a recording reminder, but only when that
//      practice has the "low_recording_rate" notification's email channel
//      enabled in their settings. White-labeled to the practice's reseller brand.
//
// Debounce: unrecorded_streak_alerted_at is stamped on send and only re-fires
// after the cooldown; once the streak drops below the threshold it's cleared so
// the next fresh streak alerts again.
//
// Called server-to-server by cron with a service-role bearer.
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MAILGUN_API_KEY,
//          MAILGUN_DOMAIN. Optional: ADOPTION_SLACK_WEBHOOK_URL (else falls back
//          to SLACK_WEBHOOK_URL), UNRECORDED_STREAK_THRESHOLD (global default,
//          else 5), APP_URL (defaults to https://app.caselift.io).
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { type Brand, CASELIFT_BRAND, escapeHtml, renderBrandedEmail, resolveBrand } from "../_shared/brand.ts";
import { sendMailgunMessage } from "../_shared/mailgun.ts";

const DEFAULT_THRESHOLD = 5;
// Only look back this far, so an old run of no-shows from before the customer
// went live doesn't trip the alert forever.
const LOOKBACK_DAYS = 120;
// Don't re-alert the same ongoing streak more than once per cooldown window.
const COOLDOWN_DAYS = 7;
// The client-facing notification this maps to (ties into the Settings toggle).
const EVENT_KEY = "low_recording_rate";
// Default channel state before a practice ever touches their settings: the
// recording reminder email is ON by default; the practice never gets Slack/SMS
// for this event (Slack is our internal channel).
const DEFAULT_PREF = { email: true };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Post the INTERNAL adoption alert to our Slack channel. Prefers the dedicated
// ADOPTION_SLACK_WEBHOOK_URL, falling back to the shared SLACK_WEBHOOK_URL.
// (Inlined rather than importing notify-slack, whose top-level Deno.serve()
// would otherwise hijack this function's requests.)
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

// The white-labeled recording-reminder email sent to the practice itself.
function buildClientEmail(brand: Brand, streak: number, appUrl: string) {
  const subject = `Reminder: your last ${streak} consults weren't recorded`;
  const heading = "Are you still recording your consults?";
  const bodyHtml =
    `<p style="margin:0">Our records show your last <strong style="color:#e2e8f0">${streak} implant consults</strong> ` +
    `weren't recorded in ${escapeHtml(brand.companyName)}.</p>` +
    `<p style="margin:12px 0 0">Recording every consultation is how you capture follow-ups and recover production - ` +
    `make sure your treatment coordinator hits record on the next one.</p>`;
  const html = renderBrandedEmail(brand, {
    heading,
    bodyHtml,
    button: { label: "Record your next consult", url: `${appUrl}/consults` },
  });
  return {
    subject,
    text: `${heading}\n\nYour last ${streak} implant consults weren't recorded. Record your next consult: ${appUrl}/consults`,
    html,
  };
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
    const appUrl = Deno.env.get("APP_URL") || "https://app.caselift.io";

    // Delivery smoke-test. Always posts the internal Slack alert. If a `email`
    // is supplied, also sends a sample CLIENT reminder email to it (simulating a
    // practice that has the notification enabled). No super-admin email.
    // Trigger with { "test": true } or { "test": true, "email": "x@y.com" }.
    if (body.test) {
      const slack = await postAdoptionSlack(
        `:test_tube: *Adoption alert delivery test* - this is what a live alert looks like:\n` +
        `:warning: *Adoption risk* - *Sample Dental (TEST)* has skipped *5 consults in a row* (threshold 5). ` +
        `Reach out to re-engage. <${appUrl}/admin|Open Admin>`,
      );
      let email: unknown = { sent: false, reason: "no_test_recipient" };
      if (body.email) {
        const { subject, text, html } = buildClientEmail(CASELIFT_BRAND, 5, appUrl);
        email = await sendMailgunMessage({ to: body.email, subject: `[TEST] ${subject}`, text, html, fromName: CASELIFT_BRAND.fromName });
      }
      return json({ ok: true, test: true, slack, email });
    }

    const globalDefault = Number(Deno.env.get("UNRECORDED_STREAK_THRESHOLD")) || DEFAULT_THRESHOLD;
    const nowISO = new Date().toISOString();
    const sinceISO = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();
    const cooldownAgo = Date.now() - COOLDOWN_DAYS * 86400000;

    // Active, non-archived practices. A single practice_id can be passed for a
    // manual/test run.
    let pq = admin
      .from("practices")
      .select(
        "id, name, email, notify_email_address, notification_prefs, agency_id, subscription_status, archived_at, " +
          "unrecorded_streak_threshold, unrecorded_streak_alerted_at",
      );
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

      // 1) INTERNAL Slack alert - always (independent of the practice's settings).
      const slack = await postAdoptionSlack(
        `:warning: *Adoption risk* - *${name}* has skipped *${streak} consults in a row* ` +
        `(threshold ${threshold}). Reach out to re-engage. <${appUrl}/admin|Open Admin>`,
      );

      // 2) CLIENT recording-reminder email - only if the practice has the
      //    low_recording_rate email notification enabled.
      const prefs = { ...DEFAULT_PREF, ...((p.notification_prefs || {})[EVENT_KEY] || {}) };
      let email: unknown = { sent: false, reason: "notification_off" };
      if (prefs.email) {
        const to = p.notify_email_address || p.email;
        if (to) {
          // deno-lint-ignore no-explicit-any
          const brand: Brand = await resolveBrand(admin, p as any);
          const { subject, text, html } = buildClientEmail(brand, streak, appUrl);
          email = await sendMailgunMessage({ to, subject, text, html, fromName: brand.fromName, replyTo: brand.supportEmail });
        } else {
          email = { sent: false, reason: "no_email_address" };
        }
      }

      await admin.from("practices").update({ unrecorded_streak_alerted_at: nowISO }).eq("id", p.id);
      results.push({ practice_id: p.id, name, streak, threshold, alerted: true, slack, email });
    }

    return json({
      ok: true,
      checked: (practices || []).length,
      alerts: results.filter((r) => (r as { alerted?: boolean }).alerted).length,
      results,
    });
  } catch (e) {
    await reportEdgeError("check-unrecorded-streak", e);
    console.error("check-unrecorded-streak error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
