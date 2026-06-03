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

    // Due, not-yet-sent messages + their consult guard fields. Includes failed
    // messages that are still within the stale window for retry.
    const { data: due, error } = await admin
      .from("messages")
      .select("id, consult_id, channel, subject, body, send_day, scheduled_for, consult:consults(practice_id, outcome, sequence_status, sequence_cancelled_at, sequence_activated_at, followup_approved_at, patient_phone, patient_email)")
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
    console.error("send-due-messages error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
