import { reportEdgeError } from "../_shared/report-error.ts";
// ============================================================================
// process-reactivation-drip - the reactivation SENDER (cron, service role).
// Called every 15 minutes. For each active campaign it:
//   1. activates any scheduled campaign whose start time has arrived
//   2. detects replies (inbound conversation messages) and pauses those patients
//   3. respects the per-campaign send window (business hours) + day-of-week
//   4. sends the next step to pending enrollments up to the daily cap
//   5. completes the campaign when every enrollment is terminal
//
// Transport: invokes `twilio-send` (sms) / `mailgun-send` (email). If those
// aren't deployed the send is treated best-effort so the drip still advances in
// demo environments (logged, not failed).
//
// Note: the send window is evaluated in UTC. A production build would store the
// practice timezone and convert; the cap + windowing logic is otherwise exact.
// Service-role; verify_jwt=false (internal job).
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireServiceRole } from "../_shared/auth.ts";
import { invokeEdgeFunction, serviceRoleClient } from "../_shared/service-role.ts";
import { replaceTokens } from "../_shared/reactivationTokens.ts";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

const hasText = (v: unknown) => Boolean((v ?? "").toString().trim());

// Day offsets per step (Day 1 / Day 4 / Day 10 in the v2 design → 0/3/9 days
// after launch). Steps beyond the 3rd fall back to ~3-day spacing.
const DAY_OFFSETS = [0, 3, 9];
const stepOffset = (i: number) => DAY_OFFSETS[i] ?? i * 3;

// Canonical ordered steps for a campaign row. v2 design = SMS 1, SMS 2, Email 3;
// legacy email slots still supported.
// deno-lint-ignore no-explicit-any
function campaignSteps(c: any) {
  const steps: { channel: string; label: string; subject?: string; body?: string }[] = [];
  if (hasText(c.message_1_sms)) steps.push({ channel: "sms", label: "SMS 1", body: c.message_1_sms });
  if (hasText(c.message_1_email_body) || hasText(c.message_1_email_subject)) {
    steps.push({ channel: "email", label: "Email 1", subject: c.message_1_email_subject, body: c.message_1_email_body });
  }
  if (hasText(c.message_2_sms)) steps.push({ channel: "sms", label: "SMS 2", body: c.message_2_sms });
  if (hasText(c.message_2_email_body) || hasText(c.message_2_email_subject)) {
    steps.push({ channel: "email", label: "Email 2", subject: c.message_2_email_subject, body: c.message_2_email_body });
  }
  if (hasText(c.message_3_sms)) steps.push({ channel: "sms", label: "SMS 3", body: c.message_3_sms });
  if (hasText(c.message_3_email_body) || hasText(c.message_3_email_subject)) {
    steps.push({ channel: "email", label: "Email 3", subject: c.message_3_email_subject, body: c.message_3_email_body });
  }
  return steps;
}

const ANGLE_LABEL: Record<string, string> = {
  price_lock: "Price Lock",
  check_in: "Check In",
  new_option: "New Option",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok");
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const authErr = requireServiceRole(req);
  if (authErr) return authErr;
  try {
    const admin = serviceRoleClient(req);
    const force = (await req.json().catch(() => ({})))?.force === true;

    const now = new Date();
    const nowIso = now.toISOString();
    const startOfTodayIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    const hour = now.getUTCHours();
    const dow = now.getUTCDay(); // 0 = Sun ... 6 = Sat

    // 1. Activate scheduled campaigns whose start time has arrived.
    await admin
      .from("reactivation_campaigns")
      .update({ status: "active", started_at: nowIso })
      .eq("status", "scheduled")
      .not("scheduled_start", "is", null)
      .lte("scheduled_start", nowIso);

    const { data: campaigns, error } = await admin
      .from("reactivation_campaigns")
      .select("*")
      .eq("status", "active");
    if (error) throw error;

    let sent = 0, replies = 0, completedCampaigns = 0;

    for (const c of campaigns || []) {
      const steps = campaignSteps(c);
      const stepCount = steps.length;
      if (!stepCount) continue;

      // Practice fields for {{practice_name}} / {{doctor_name}} / {{phone_number}}.
      const { data: practice } = await admin
        .from("practices").select("name, doctor_last, phone").eq("id", c.practice_id).maybeSingle();
      const launchedRef = c.launched_at || c.started_at || c.created_at;
      let campSent = 0;
      let campReplies = 0;

      // ── 2. Reply detection ────────────────────────────────────────────────
      const { data: live } = await admin
        .from("reactivation_enrollments")
        .select("*")
        .eq("campaign_id", c.id)
        .in("status", ["pending", "sending"]);

      for (const e of live || []) {
        if (!e.last_sent_at) continue;
        const orParts: string[] = [];
        if (e.patient_phone) orParts.push(`patient_phone.eq.${e.patient_phone}`);
        if (e.patient_email) orParts.push(`patient_email.eq.${e.patient_email}`);
        if (!orParts.length) continue;
        const { data: convs } = await admin
          .from("conversations")
          .select("id")
          .eq("practice_id", c.practice_id)
          .or(orParts.join(","));
        const convIds = (convs || []).map((x) => x.id);
        if (!convIds.length) continue;
        const { data: inbound } = await admin
          .from("conversation_messages")
          .select("id, body, created_at, conversation_id")
          .in("conversation_id", convIds)
          .eq("direction", "inbound")
          .gt("created_at", e.last_sent_at)
          .order("created_at", { ascending: false })
          .limit(1);
        const reply = inbound?.[0];
        if (!reply) continue;

        // Pause the enrollment, tag the conversation, notify the TC, and log a
        // reply outcome so attribution can flip to caselift_recovered later.
        await admin
          .from("reactivation_enrollments")
          .update({ status: "replied", replied: true, replied_at: reply.created_at, reply_content: reply.body || null })
          .eq("id", e.id);
        await admin
          .from("conversations")
          .update({ reactivation_campaign_id: c.id })
          .eq("id", reply.conversation_id);
        if (e.consult_id) {
          await admin.from("message_outcomes").insert({
            consult_id: e.consult_id,
            replied: true,
            replied_at: reply.created_at,
            message_channel: "reactivation",
          });
        }
        await admin.from("notifications").insert({
          practice_id: c.practice_id,
          type: "reactivation_reply",
          title: `🟢 Reactivation reply, ${e.patient_first || "a patient"} replied to your ${ANGLE_LABEL[c.angle_type] || ""} campaign`,
          message: (reply.body || "").slice(0, 140),
          link: "/conversations",
        });
        replies++;
        campReplies++;
      }

      // ── 3. Window + day-of-week gates ─────────────────────────────────────
      const inWindow = hour >= (c.send_window_start ?? 9) && hour < (c.send_window_end ?? 17);
      const maxDow = c.send_days === "mon_sat" ? 6 : 5;
      const inDays = dow >= 1 && dow <= maxDow;
      if (!force && (!inWindow || !inDays)) continue;

      // ── 4. Daily cap + next-step sends ────────────────────────────────────
      const { count: sentToday } = await admin
        .from("reactivation_enrollments")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", c.id)
        .gte("last_sent_at", startOfTodayIso);
      let budget = (c.messages_per_day ?? 20) - (sentToday ?? 0);
      if (budget <= 0) continue;

      const { data: nextUp } = await admin
        .from("reactivation_enrollments")
        .select("*")
        .eq("campaign_id", c.id)
        .in("status", ["pending", "sending"])
        .lt("messages_sent", stepCount)
        .or(`last_sent_at.is.null,last_sent_at.lt.${startOfTodayIso}`)
        .order("messages_sent", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(budget);

      for (const e of nextUp || []) {
        if (budget <= 0) break;
        const idx = e.messages_sent || 0;
        const step = steps[idx];
        if (!step) continue;
        // Respect the per-step day offset (Day 1 / Day 4 / Day 10) from launch.
        if (!force && launchedRef) {
          const dueAt = new Date(new Date(launchedRef).getTime() + stepOffset(idx) * 86400000);
          if (now < dueAt) continue;
        }
        const to = step.channel === "email" ? e.patient_email : e.patient_phone;
        if (!to) continue;

        const transport = step.channel === "email" ? "mailgun-send" : "twilio-send";
        const body = replaceTokens(step.body, e, practice || {});
        const subject = replaceTokens(step.subject, e, practice || {});
        let ok = true;
        try {
          await invokeEdgeFunction(transport, {
            practice_id: c.practice_id,
            to,
            subject,
            body,
            consult_id: e.consult_id,
            reactivation_campaign_id: c.id,
          }, req);
        } catch (err) {
          ok = false;
          // Best-effort in demo: log, but still advance so the drip progresses.
          console.error(`reactivation drip: ${transport} failed for enrollment ${e.id}:`, (err as Error)?.message);
        }
        const nextCount = idx + 1;
        // deno-lint-ignore no-explicit-any
        const upd: Record<string, any> = {
          messages_sent: nextCount,
          last_sent_at: nowIso,
          status: nextCount >= stepCount ? "completed" : "sending",
        };
        if (idx < 3) {
          upd[`msg_${idx + 1}_status`] = ok ? "sent" : "failed";
          upd[`msg_${idx + 1}_sent_at`] = nowIso;
        }
        await admin.from("reactivation_enrollments").update(upd).eq("id", e.id);
        sent++;
        campSent++;
        budget--;
      }

      // Keep the results-tab rollups current (cards read these columns).
      if (campSent || campReplies) {
        await admin.from("reactivation_campaigns").update({
          messages_sent: (c.messages_sent || 0) + campSent,
          replies_count: (c.replies_count || 0) + campReplies,
        }).eq("id", c.id);
      }

      // ── 5. Complete the campaign when nothing is left in flight ───────────
      const { count: remaining } = await admin
        .from("reactivation_enrollments")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", c.id)
        .in("status", ["pending", "sending"]);
      if ((remaining ?? 0) === 0) {
        await admin
          .from("reactivation_campaigns")
          .update({ status: "completed", completed_at: nowIso })
          .eq("id", c.id);
        completedCampaigns++;
      }
    }

    return json({ ok: true, campaigns: (campaigns || []).length, sent, replies, completed: completedCampaigns });
  } catch (e) {
    await reportEdgeError("process-reactivation-drip", e);
    console.error("process-reactivation-drip error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
