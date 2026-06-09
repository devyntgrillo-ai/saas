import { reportEdgeError } from "../_shared/report-error.ts";
// ============================================================================
// process-sequences - the sequence ACTIVATION engine (run by cron, service role).
//
// Enforces the outcome guards before any follow-up message is eligible to send:
//   1. outcome 'pending' AND activation hold elapsed → activate (sequence_activated_at).
//   2. outcome 'accepted'      → cancel all not-yet-sent messages.
//   3. outcome 'not_converting'→ cancel all not-yet-sent messages.
//   4. outcome 'closed_won'    → cancel all not-yet-sent messages.
//   5. outcome 'rescheduled'   → keep only Day 30+ messages eligible (cancel earlier ones).
//
// NOTE: actual SMS/email transmission is a SEPARATE sender (twilio-send /
// mailgun-send) and is intentionally not done here - this function only decides
// eligibility (activate vs cancel). The hold length is per-practice
// (sequence_config.rules.holdHours, default 24).
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { holdHoursFor, computeScheduledFor, rulesFrom } from "../_shared/sequence.ts";

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

async function cancelMessages(admin: ReturnType<typeof createClient>, consultId: string) {
  await admin.from("messages").update({ status: "cancelled" })
    .eq("consult_id", consultId).in("status", ["draft", "scheduled", "pending"]);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Per-practice activation hold.
    const { data: practices } = await admin.from("practices").select("id, sequence_config, auto_start_followup, timezone");
    const holdByPractice: Record<string, number> = {};
    const autoStartByPractice: Record<string, boolean> = {};
    const prById: Record<string, any> = {};
    (practices || []).forEach((p) => {
      holdByPractice[p.id] = holdHoursFor(p.sequence_config);
      autoStartByPractice[p.id] = p.auto_start_followup === true;
      prById[p.id] = p;
    });

    // Consults still "in flight" (sequence not yet cancelled).
    const { data: consults } = await admin
      .from("consults")
      .select("id, practice_id, outcome, created_at, sequence_activated_at, sequence_cancelled_at, sequence_status, followup_approved_at, consecutive_no_reply")
      .is("sequence_cancelled_at", null);

    let activated = 0, cancelled = 0, rescheduledTrimmed = 0, adapted = 0;
    const nowMs = Date.now();

    for (const c of consults || []) {
      const outcome = c.outcome || "pending";

      // Paused (manual or auto-paused on reply): leave pending messages intact so
      // the sequence can resume. Don't activate, cancel, or trim anything.
      if (c.sequence_status === "paused") continue;

      if (outcome === "accepted" || outcome === "not_converting" || outcome === "closed_won") {
        await cancelMessages(admin, c.id);
        await admin.from("consults").update({
          sequence_cancelled_at: new Date().toISOString(),
          sequence_cancelled_reason: outcome,
          sequence_status: "cancelled",
        }).eq("id", c.id);
        cancelled++;
        continue;
      }

      if (outcome === "rescheduled") {
        // Only Day 30+ messages remain eligible - cancel earlier touchpoints by send_day.
        const { data: msgs } = await admin.from("messages")
          .select("id").eq("consult_id", c.id).in("status", ["draft", "scheduled", "pending"])
          .lt("send_day", 30);
        if (msgs && msgs.length) {
          await admin.from("messages").update({ status: "cancelled" }).in("id", msgs.map((m) => m.id));
          rescheduledTrimmed++;
        }
        continue;
      }

      // pending → activate once hold elapsed and follow-up is approved (or auto-start on).
      if (outcome === "pending" && !c.sequence_activated_at) {
        const autoStart = autoStartByPractice[c.practice_id] ?? true;
        if (!autoStart && !c.followup_approved_at) continue;

        const hold = holdByPractice[c.practice_id] ?? 24;
        if (nowMs - new Date(c.created_at).getTime() >= hold * 3600 * 1000) {
          await admin.from("consults").update({ sequence_activated_at: new Date().toISOString() }).eq("id", c.id);
          activated++;
        }
        continue;
      }

      // No-response adaptation (Part 2): an active sequence is only un-paused while
      // the patient has NOT replied (a reply pauses it), so sent-count == consecutive
      // unanswered. On crossing 3 → stretch pending touches to weekly; crossing 6 →
      // monthly maintenance. Never tightens cadence. Idempotent via consecutive_no_reply.
      if (outcome === "pending" && c.sequence_activated_at) {
        const { count } = await admin.from("messages")
          .select("id", { count: "exact", head: true }).eq("consult_id", c.id).eq("status", "sent");
        const sc = count || 0;
        const prev = c.consecutive_no_reply || 0;
        if (sc !== prev) await admin.from("consults").update({ consecutive_no_reply: sc }).eq("id", c.id);
        const cross6 = prev < 6 && sc >= 6;
        const cross3 = prev < 3 && sc >= 3 && sc < 6;
        if (cross6 || cross3) {
          const { data: pend } = await admin.from("messages")
            .select("id").eq("consult_id", c.id).in("status", ["draft", "scheduled", "pending"])
            .order("scheduled_for", { ascending: true });
          if (pend && pend.length) {
            const rules = rulesFrom(prById[c.practice_id]?.sequence_config, prById[c.practice_id]?.timezone);
            const gap = cross6 ? 30 : 7;
            const startDay = cross6 ? 7 : 3;
            const nowIso = new Date().toISOString();
            for (let i = 0; i < pend.length; i++) {
              const day = startDay + i * gap;
              await admin.from("messages").update({
                scheduled_for: computeScheduledFor(nowIso, day, rules), send_day: Math.round(day),
              }).eq("id", pend[i].id);
            }
            adapted++;
          }
        }
      }
    }

    return json({ ok: true, activated, cancelled, rescheduled_trimmed: rescheduledTrimmed, adapted });
  } catch (e) {
    await reportEdgeError("process-sequences", e);
    console.error("process-sequences error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
