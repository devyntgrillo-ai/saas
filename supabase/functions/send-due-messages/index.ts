import { reportEdgeError } from "../_shared/report-error.ts";
// ============================================================================
// send-due-messages - the scheduled SENDER (cron, service role). Finds messages
// whose scheduled_for has arrived and whose consult still allows sending, then
// dispatches each via the channel transport and marks it sent/failed.
//
// Retry: transient errors keep the message in 'scheduled' so the next cron tick
// retries it. Messages more than 24h past their scheduled_for that still fail
// are permanently marked 'failed' (stale cutoff).
//
// Eligibility (defense-in-depth with process-sequences):
//   • message.status in (draft, scheduled, failed) and scheduled_for <= now
//   • consult.sequence_cancelled_at is null
//   • consult.outcome == 'pending', OR 'rescheduled' with send_day >= 30
//
// Transport: invokes `mailgun-send` (email) / `twilio-send` (sms).
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

const BATCH = 100;
const STALE_HOURS = 24;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();

    // HIPAA audit: record each successful send as a PHI transmission. IDs +
    // metadata only — NEVER the subject/body content. Best-effort (service role
    // bypasses RLS); a logging failure must not stop the sender.
    // deno-lint-ignore no-explicit-any
    const auditSent = async (mm: any, cc: any) => {
      await admin.from("audit_logs").insert({
        user_id: null,
        user_role: "service_role",
        practice_id: cc?.practice_id ?? null,
        action: "message.sent",
        resource_type: "message",
        resource_id: String(mm.id),
        phi_accessed: true,
        details: { channel: mm.channel, sequence_id: mm.consult_id, practice_id: cc?.practice_id ?? null },
      }).then(() => {}, () => {});
    };

    // Due, not-yet-sent messages + their consult guard fields. Includes failed
    // messages that are still within the stale window for retry.
    const { data: due, error } = await admin
      .from("messages")
      .select("id, consult_id, channel, subject, body, send_day, scheduled_for, call_script, purpose, sequence_position, consult:consults(practice_id, outcome, sequence_status, sequence_cancelled_at, sequence_activated_at, followup_approved_at, patient_phone, patient_email, patient_first, patient_name, created_at)")
      .in("status", ["draft", "scheduled", "failed"])
      .not("scheduled_for", "is", null)
      .lte("scheduled_for", nowIso)
      .order("scheduled_for", { ascending: true })
      .limit(BATCH);
    if (error) throw error;

    const practiceIds = [...new Set((due || []).map((m) => m.consult?.practice_id).filter(Boolean))] as string[];
    const autoStartByPractice: Record<string, boolean> = {};
    if (practiceIds.length) {
      const { data: prs } = await admin.from("practices").select("id, auto_start_followup").in("id", practiceIds);
      (prs || []).forEach((p) => { autoStartByPractice[p.id] = p.auto_start_followup === true; });
    }

    let sent = 0, failed = 0, skipped = 0;

    for (const m of due || []) {
      const c: any = m.consult;
      const seqStatus = c?.sequence_status || "active";
      const outcome = c?.outcome || "pending";

      // Manual-start practices: TC must approve before any message sends.
      const autoStart = c?.practice_id ? autoStartByPractice[c.practice_id] === true : false;
      if (!autoStart && !c?.followup_approved_at) {
        skipped++;
        continue;
      }

      // Activation hold: process-sequences sets sequence_activated_at after hold.
      if (outcome === "pending" && !c?.sequence_activated_at) {
        skipped++;
        continue;
      }

      // Paused: leave the message in place but don't send.
      if (seqStatus === "paused") { skipped++; continue; }

      const eligible =
        c && seqStatus !== "cancelled" && !c.sequence_cancelled_at &&
        (outcome === "pending" || (outcome === "rescheduled" && (m.send_day ?? 0) >= 30));

      if (!eligible) {
        await admin.from("messages").update({ status: "cancelled" }).eq("id", m.id);
        skipped++;
        continue;
      }

      // 12-month stop: sequences end a year after the consult (Part 8).
      if (c.created_at && nowMs - new Date(c.created_at).getTime() > 365 * 86400000) {
        await admin.from("messages").update({ status: "cancelled" }).eq("id", m.id);
        await admin.from("consults").update({ sequence_status: "cancelled", sequence_cancelled_at: nowIso, sequence_cancelled_reason: "12_months" }).eq("id", m.consult_id).then(() => {}, () => {});
        skipped++;
        continue;
      }

      const logPerf = async () => {
        await admin.from("message_performance").insert({
          message_id: m.id, practice_id: c.practice_id, channel: m.channel,
          sequence_position: m.sequence_position ?? null, sent_at: new Date().toISOString(),
        }).then(() => {}, () => {});
      };

      // Call reminders are NOT outbound sends — they notify the TC with a script (Part 3).
      if (m.channel === "call") {
        const who = c.patient_first || c.patient_name || "the patient";
        const bullets = Array.isArray(m.call_script) ? m.call_script : [];
        await admin.from("notifications").insert({
          practice_id: c.practice_id, type: "call_reminder", event: "call_reminder",
          title: `Call reminder: ${who}`,
          message: [m.purpose, ...bullets].filter(Boolean).join(" • ").slice(0, 500) || undefined,
          link: `/consults/${m.consult_id}`,
        }).then(() => {}, () => {});
        await admin.from("messages").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", m.id);
        await logPerf();
        await auditSent(m, c);
        sent++;
        continue;
      }

      const to = m.channel === "email" ? c.patient_email : c.patient_phone;
      if (!to) {
        // Missing contact info is permanent - don't retry.
        await admin.from("messages").update({ status: "failed" }).eq("id", m.id);
        failed++;
        continue;
      }

      // Stale check: if scheduled_for is far in the past, mark as failed permanently.
      const schedMs = new Date(m.scheduled_for!).getTime();
      if (nowMs - schedMs > STALE_HOURS * 3600 * 1000) {
        await admin.from("messages").update({ status: "failed" }).eq("id", m.id);
        failed++;
        continue;
      }

      const transport = m.channel === "email" ? "mailgun-send" : "twilio-send";
      try {
        const { error: tErr } = await admin.functions.invoke(transport, {
          body: {
            to,
            subject: m.subject,
            body: m.body,
            consult_id: m.consult_id,
            message_id: m.id,
            practice_id: c.practice_id,
          },
        });
        if (tErr) throw tErr;
        await admin.from("messages").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", m.id);
        await logPerf();
        await auditSent(m, c);
        sent++;
      } catch (e) {
        console.error(`send-due-messages: ${transport} failed for message ${m.id}:`, (e as Error)?.message);
        // Keep message in its current state so the next cron tick retries it.
        // The stale cutoff above prevents indefinite retries.
        failed++;
      }
    }

    return json({ ok: true, considered: (due || []).length, sent, failed, skipped });
  } catch (e) {
    await reportEdgeError("send-due-messages", e);
    console.error("send-due-messages error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
