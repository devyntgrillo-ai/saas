// ============================================================================
// seed-demo-practice - one-shot seeder for the "Pinnacle Dental Implants" demo
// account used on sales calls. Creates the auth user, the practice (under the
// Striker Ads reseller), 12 consults, 7 active follow-up sequences with sent +
// pending messages, conversation threads, assisted wins, training progress, and
// a fully-configured practice profile.
//
// Idempotent: re-running wipes the prior demo practice's data and reseeds. The
// auth user is reused (not recreated) so the login stays stable.
//
// Service-role only. Invoke with POST (verify_jwt=false). Optional body:
//   { "reset": true }  - also delete the auth user before reseeding (rare).
//
// All timestamps are placed in Arizona business hours (Mon-Fri, 8am-6pm MST).
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 2), { status: s, headers: { "Content-Type": "application/json" } });

const DEMO_PRACTICE_EMAIL = "demo@pinnacledental.com";
const DEMO_LOGIN_EMAIL = "demo@caselift.io";
const DEMO_LOGIN_PASSWORD = "CaseLift2026!";
const SUPER_ADMIN_EMAIL = "devyntgrillo@gmail.com";
const AVG_CASE_VALUE = 38000;

// Arizona is UTC-7 year-round (no DST). Build a UTC ISO string for a given
// number of days ago at a Mountain-Standard business hour, shifting weekends
// back to Friday so nothing lands on Sat/Sun.
function bizTs(daysAgo: number, hourMst = 10, minute = 0): string {
  const d = new Date(Date.now() - daysAgo * 86400000);
  const dow = d.getUTCDay(); // 0 Sun .. 6 Sat
  if (dow === 6) d.setUTCDate(d.getUTCDate() - 1);
  else if (dow === 0) d.setUTCDate(d.getUTCDate() - 2);
  d.setUTCHours(hourMst + 7, minute, 0, 0); // MST -> UTC
  return d.toISOString();
}
function ymd(iso: string): string {
  return iso.slice(0, 10);
}
function hms(iso: string): string {
  return iso.slice(11, 19);
}

// ---------------------------------------------------------------------------
// Demo dataset
// ---------------------------------------------------------------------------
type Consult = {
  key: string;
  first: string;
  last: string;
  phone: string;
  treatment: string;
  caseValue: number;
  daysAgo: number;
  kind: "won" | "active" | "not_fit";
  objection?: string;
  objectionType?: string;
  exitIntent?: string;
  exitLevel?: string;
  coaching?: string;
  summary?: string;
  wonDaysAgo?: number;
  seqStartDaysAgo?: number; // for active sequences
  messagesSent?: number; // for assisted wins
};

// Dates are re-timed so the current month has real activity (consults this
// month, a couple of wins this month) while still spanning ~6 weeks of history.
// Totals are preserved: 12 consults, 4 wins, $93,100 recovered.
const CONSULTS: Consult[] = [
  {
    key: "robert", first: "Robert", last: "Martinez", phone: "(480) 555-0110",
    treatment: "full_arch", caseValue: 42000, daysAgo: 35, kind: "active",
    objection: "Monthly payment amount", objectionType: "price",
    exitIntent: "Warm — requested time to discuss with wife", exitLevel: "warm",
    seqStartDaysAgo: 6,
    summary: "Patient expressed strong interest in full arch restoration. Primary concern was financing. Wife present, supportive. Pre-approved at $580/month through Sunbit. Close probability high.",
    coaching: "Robert is ready to move forward. Follow up within 48 hours with the financing breakdown you promised. Reference the conversation about his daughter's wedding in June.",
  },
  {
    key: "sandra", first: "Sandra", last: "Williams", phone: "(480) 555-0111",
    treatment: "full_arch", caseValue: 38500, daysAgo: 40, kind: "won", wonDaysAgo: 32, messagesSent: 4,
  },
  {
    key: "james", first: "James", last: "Chen", phone: "(480) 555-0112",
    treatment: "single_implant", caseValue: 4800, daysAgo: 28, kind: "active",
    objectionType: "timing", exitLevel: "warm", seqStartDaysAgo: 10,
  },
  {
    key: "patricia", first: "Patricia", last: "Lopez", phone: "(480) 555-0113",
    treatment: "full_arch", caseValue: 44000, daysAgo: 17, kind: "not_fit",
  },
  {
    key: "david", first: "David", last: "Thompson", phone: "(480) 555-0114",
    treatment: "invisalign", caseValue: 6200, daysAgo: 22, kind: "won", wonDaysAgo: 15, messagesSent: 3,
  },
  {
    key: "karen", first: "Karen", last: "Anderson", phone: "(480) 555-0115",
    treatment: "full_arch", caseValue: 41000, daysAgo: 20, kind: "active",
    objection: "Needs to talk to spouse", objectionType: "spouse",
    exitIntent: "Warm", exitLevel: "warm", seqStartDaysAgo: 14,
  },
  {
    key: "michael", first: "Michael", last: "Brown", phone: "(480) 555-0116",
    treatment: "full_arch", caseValue: 39500, daysAgo: 4, kind: "won", wonDaysAgo: 1, messagesSent: 5,
  },
  {
    key: "lisa", first: "Lisa", last: "Garcia", phone: "(480) 555-0117",
    treatment: "dental_implants", caseValue: 12400, daysAgo: 13, kind: "active",
    objection: "Too expensive", objectionType: "price",
    exitIntent: "Uncertain", exitLevel: "long_term", seqStartDaysAgo: 9,
  },
  {
    key: "thomas", first: "Thomas", last: "Wilson", phone: "(480) 555-0118",
    treatment: "full_arch", caseValue: 46000, daysAgo: 9, kind: "active",
    objection: "Fear of surgery", objectionType: "fear",
    exitIntent: "Warm — very interested", exitLevel: "hot", seqStartDaysAgo: 7,
    coaching: "Thomas has been wanting this for 3 years. His fear is valid but addressable. Lead with sedation options and patient testimonials from anxious patients who had great experiences.",
  },
  {
    key: "nancy", first: "Nancy", last: "Davis", phone: "(480) 555-0119",
    treatment: "cosmetic", caseValue: 8900, daysAgo: 3, kind: "won", wonDaysAgo: 0, messagesSent: 2,
  },
  {
    key: "christopher", first: "Christopher", last: "Martinez", phone: "(480) 555-0120",
    treatment: "full_arch", caseValue: 43500, daysAgo: 4, kind: "active",
    objection: "Financing concern", objectionType: "price",
    exitIntent: "Warm", exitLevel: "warm", seqStartDaysAgo: 4,
  },
  {
    key: "jennifer", first: "Jennifer", last: "Taylor", phone: "(480) 555-0121",
    treatment: "full_arch", caseValue: 47000, daysAgo: 2, kind: "active",
    objection: "Needs to think about it", objectionType: "timing",
    exitIntent: "Very warm — asked about surgery date", exitLevel: "hot", seqStartDaysAgo: 2,
    coaching: "Jennifer is ready. She asked about surgery dates unprompted — that is a buying signal. The follow-up sequence should reference her specific timeline concern about healing before her son's graduation in May.",
  },
];

// 7-touch sequence template. send_day drives the schedule from activation.
const SEQ_TEMPLATE = [
  { day: 1, channel: "sms", subject: null as string | null, body: (n: string) => `Hi ${n}, this is the team following up after your consult. We really enjoyed meeting you — any questions we can help with as you think it over?` },
  { day: 3, channel: "email", subject: "Your financing options + a patient story", body: (n: string) => `Hi ${n},\n\nI put together a quick breakdown of the financing options we discussed — most patients are surprised how manageable the monthly number is. I also wanted to share a short story from a patient who was in your exact position last year and is thrilled with the result.\n\nHappy to walk through any of it whenever works for you.` },
  { day: 5, channel: "sms", subject: null, body: (n: string) => `Hi ${n}, just checking in — did the financing breakdown make sense? Glad to answer anything.` },
  { day: 7, channel: "email", subject: "Still here whenever you're ready", body: (n: string) => `Hi ${n},\n\nNo pressure at all — just wanted you to know we're here when you're ready to move forward. Here's a testimonial from a patient who had the same hesitation and is so glad they did it.` },
  { day: 14, channel: "sms", subject: null, body: (n: string) => `Hi ${n}, hope you're doing well! Wanted to check in and see if now is a better time to talk through next steps.` },
  { day: 21, channel: "email", subject: "Holding your treatment plan pricing", body: (n: string) => `Hi ${n},\n\nWe're able to hold your current treatment-plan pricing for a little longer, and our surgical calendar is filling up for the season. If you'd like, I can pencil you in tentatively — no commitment.` },
  { day: 30, channel: "sms", subject: null, body: (n: string) => `Hi ${n}, last check-in from me for now — we'd love to help you get this done. Reply anytime and we'll pick right back up.` },
];

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const summary: Record<string, unknown> = {};
  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  let sql: ReturnType<typeof postgres> | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    if (dbUrl) sql = postgres(dbUrl, { prepare: false, max: 2 });

    if (body.debug === "constraints" && sql) {
      const defs = await sql`
        select conname, pg_get_constraintdef(oid) as def
        from pg_constraint
        where conrelid = 'public.consults'::regclass and contype = 'c'`;
      return json({ debug: defs });
    }
    if (body.debug === "verify" && sql) {
      const [v] = await sql`
        with p as (select id from public.practices where email = ${DEMO_PRACTICE_EMAIL})
        select
          (select count(*) from public.practices where email = ${DEMO_PRACTICE_EMAIL}) as practices_with_email,
          (select id from p limit 1) as practice_id,
          (select count(*) from public.consults where practice_id = (select id from p limit 1)) as consults,
          (select count(*) from public.consults where practice_id = (select id from p limit 1) and sequence_status='active') as active_sequences,
          (select count(*) from public.messages where practice_id = (select id from p limit 1)) as messages,
          (select count(*) from public.messages where practice_id = (select id from p limit 1) and status='sent') as messages_sent,
          (select count(*) from public.conversations where practice_id = (select id from p limit 1)) as conversations,
          (select coalesce(sum(case_value),0) from public.assisted_wins where practice_id = (select id from p limit 1)) as recovered,
          (select count(*) from public.assisted_wins where practice_id = (select id from p limit 1)) as wins,
          (select count(*) from public.pms_appointments where practice_id = (select id from p limit 1)) as appointments,
          (select count(*) from public.message_outcomes where practice_id = (select id from p limit 1)) as message_outcomes,
          (select count(*) from public.call_logs where practice_id = (select id from p limit 1)) as call_logs,
          (select count(*) from public.consults where practice_id = (select id from p limit 1) and recording_date >= date_trunc('month', now())::date) as consults_this_month,
          (select count(*) from public.consults where practice_id = (select id from p limit 1) and recording_date >= date_trunc('month', now())::date and outcome in ('accepted','closed_won')) as closed_this_month,
          (select agency_id from public.practices where id = (select id from p limit 1)) as agency_id,
          (select practice_id from public.users where email = ${DEMO_LOGIN_EMAIL}) as user_practice_link,
          (select count(*) from public.training_progress tp where tp.user_id = (select id from auth.users where lower(email)=${SUPER_ADMIN_EMAIL})) as super_admin_lessons`;
      return json({ verify: v });
    }

    // ----- 1. Auth user (reuse if it exists) ---------------------------------
    let userId: string | null = null;
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email: DEMO_LOGIN_EMAIL,
      password: DEMO_LOGIN_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: "Pinnacle Demo" },
    });
    if (created?.user) {
      userId = created.user.id;
    } else {
      // Already registered (e.g. a prior run) → look the id up directly in
      // auth.users via the PG connection (GoTrue's admin listUsers is flaky).
      if (!sql) throw new Error(`user exists (${cErr?.message}) but SUPABASE_DB_URL unavailable to resolve it`);
      const rows = await sql`select id from auth.users where lower(email) = ${DEMO_LOGIN_EMAIL} limit 1`;
      if (!rows.length) throw new Error(`createUser said exists (${cErr?.message}) but auth.users has no match`);
      userId = rows[0].id as string;
      // Best-effort password reset so the documented credential always works.
      await admin.auth.admin.updateUserById(userId, { password: DEMO_LOGIN_PASSWORD, email_confirm: true }).catch(() => {});
    }
    summary.auth_user_id = userId;

    // ----- 2. No reseller → CaseLift branding (direct subaccount) ------------
    // The demo is a direct CaseLift client (agency_id null) so that clicking
    // into it from the super-admin Subaccounts list shows CaseLift branding,
    // never a reseller's white-label.
    const agencyId: string | null = null;
    summary.reseller_id = null;
    summary.branding = "CaseLift (direct subaccount, no reseller)";

    // ----- 3. Idempotency: wipe prior demo practice data ---------------------
    const { data: prior } = await admin.from("practices").select("id").eq("email", DEMO_PRACTICE_EMAIL).maybeSingle();
    if (prior?.id) {
      await admin.from("call_logs").delete().eq("practice_id", prior.id);
      await admin.from("message_outcomes").delete().eq("practice_id", prior.id);
      await admin.from("pms_appointments").delete().eq("practice_id", prior.id);
      await admin.from("assisted_wins").delete().eq("practice_id", prior.id);
      await admin.from("conversations").delete().eq("practice_id", prior.id); // cascades conversation_messages
      await admin.from("consults").delete().eq("practice_id", prior.id); // cascades messages
      await admin.from("practice_members").delete().eq("practice_id", prior.id);
      await admin.from("practices").delete().eq("id", prior.id);
    }

    // ----- 4. Practice -------------------------------------------------------
    const allOn = { email: true, sms: true, slack: true };
    const notificationPrefs = {
      patient_replied: allOn,
      case_converted: allOn,
      daily_calls_due: { email: true, sms: true, slack: true },
      low_recording_rate: { email: true, sms: true, slack: true },
    };
    const { data: practice, error: pErr } = await admin
      .from("practices")
      .insert({
        name: "Pinnacle Dental Implants",
        doctor_first: "Michael",
        doctor_last: "Torres",
        email: DEMO_PRACTICE_EMAIL,
        phone: "(480) 555-0192",
        address: "8200 E Camelback Rd, Suite 300, Scottsdale, AZ 85251",
        agency_id: agencyId,
        pms_type: "Dentrix",
        pms_connected: true,
        pms_status: "connected",
        pms_sync_enabled: true,
        pms_last_synced_at: bizTs(0, 8, 15),
        subscription_status: "active",
        plan_amount: 997,
        avg_case_value: AVG_CASE_VALUE,
        onboarding_completed: true,
        sms_enabled: true,
        email_enabled: true,
        twilio_phone_number: "(480) 555-0199",
        notify_email_address: DEMO_PRACTICE_EMAIL,
        notify_sms_number: "(480) 555-0199",
        weekly_digest_enabled: true,
        weekly_digest_day: "monday",
        weekly_digest_time: "9am",
        digest_owner_email: DEMO_PRACTICE_EMAIL,
        notification_prefs: notificationPrefs,
        created_by: userId,
        created_at: bizTs(90, 9, 0),
      })
      .select("id")
      .single();
    if (pErr) throw new Error(`practice insert: ${pErr.message}`);
    const practiceId = practice.id;
    summary.practice_id = practiceId;

    // Link the demo user to the practice (handle_new_user already made the row).
    await admin.from("users").upsert({ id: userId, email: DEMO_LOGIN_EMAIL, practice_id: practiceId, role: "owner" }, { onConflict: "id" });
    await admin.from("practice_members").upsert({ practice_id: practiceId, user_id: userId, role: "owner" }, { onConflict: "practice_id,user_id" });

    // ----- 5. Consults -------------------------------------------------------
    const consultRows = CONSULTS.map((c) => {
      const createdIso = bizTs(c.daysAgo, 9 + (c.daysAgo % 7), (c.daysAgo * 7) % 60);
      const base: Record<string, unknown> = {
        practice_id: practiceId,
        patient_name: `${c.first} ${c.last}`,
        patient_first: c.first,
        patient_last: c.last,
        patient_phone: c.phone,
        treatment_type: c.treatment,
        case_value: c.caseValue,
        tx_plan_value: c.caseValue,
        status: "analyzed",
        primary_objection: c.objection ?? null,
        objection_type: c.objectionType ?? null,
        exit_intent: c.exitIntent ?? null,
        exit_intent_level: c.exitLevel ?? null,
        coaching_insight: c.coaching ?? null,
        what_happened: c.summary ?? null,
        recording_date: ymd(createdIso),
        recording_time: hms(createdIso),
        duration: 1100 + ((c.caseValue / 100) % 1500 | 0),
        created_at: createdIso,
      };
      if (c.kind === "won") {
        const wonIso = bizTs(c.wonDaysAgo!, 14, 30);
        Object.assign(base, {
          outcome: "accepted",
          outcome_set_at: wonIso,
          closed_at: wonIso,
          attribution_status: "consultiq_assisted",
          tx_plan_value_source: "manual",
          sequence_status: "cancelled",
          sequence_cancelled_at: wonIso,
          sequence_cancelled_reason: "won",
        });
      } else if (c.kind === "not_fit") {
        Object.assign(base, {
          outcome: "not_converting",
          outcome_set_at: bizTs(c.daysAgo - 1, 11, 0),
          attribution_status: null,
          tx_plan_value_source: "estimate",
          sequence_status: "cancelled",
          sequence_cancelled_reason: "not_a_fit",
        });
      } else {
        Object.assign(base, {
          outcome: "pending",
          attribution_status: "consultiq_assisted",
          tx_plan_value_source: "estimate",
          sequence_status: "active",
          sequence_activated_at: bizTs(c.seqStartDaysAgo!, 10, 0),
        });
      }
      return base;
    });
    const { data: insertedConsults, error: scErr } = await admin.from("consults").insert(consultRows).select("id, patient_name");
    if (scErr) throw new Error(`consults insert: ${scErr.message}`);
    const consultIdByName = new Map<string, string>();
    for (const r of insertedConsults || []) consultIdByName.set(r.patient_name as string, r.id as string);
    summary.consults_created = insertedConsults?.length ?? 0;

    // ----- 6. Sequences (messages) for active consults -----------------------
    const now = Date.now();
    const messageRows: Record<string, unknown>[] = [];
    let pipelineValue = 0;
    for (const c of CONSULTS) {
      if (c.kind !== "active") continue;
      pipelineValue += c.caseValue;
      const consultId = consultIdByName.get(`${c.first} ${c.last}`)!;
      const startDaysAgo = c.seqStartDaysAgo!;
      for (let i = 0; i < SEQ_TEMPLATE.length; i++) {
        const t = SEQ_TEMPLATE[i];
        const sendDaysAgo = startDaysAgo - t.day; // positive = past
        const sendIso = bizTs(Math.abs(sendDaysAgo), 10 + (i % 6), (i * 11) % 60);
        // Recompute exact instant to compare with now (bizTs already shifts weekends).
        const sent = new Date(sendIso).getTime() <= now && sendDaysAgo >= 0;
        messageRows.push({
          consult_id: consultId,
          practice_id: practiceId,
          type: "followup",
          channel: t.channel,
          subject: t.subject,
          body: t.body(c.first),
          send_day: t.day,
          status: sent ? "sent" : "scheduled",
          sent_at: sent ? sendIso : null,
          scheduled_for: sent ? null : sendIso,
          // Distinct created_at per touch so the track_message_sent trigger
          // derives the correct sequence position (1..6) for each outcome.
          created_at: sent ? sendIso : bizTs(startDaysAgo, 9, i),
        });
      }
    }
    // Won consults: a short run of already-sent follow-ups before the win. This
    // is what makes them count as CaseLift-attributed production (the dashboard
    // attributes any accepted consult that has a sent message).
    for (const c of CONSULTS) {
      if (c.kind !== "won") continue;
      const consultId = consultIdByName.get(`${c.first} ${c.last}`)!;
      const n = c.messagesSent ?? 3;
      for (let k = 0; k < n; k++) {
        // Space the pre-win touches strictly between the consult and the win.
        const frac = (k + 1) / (n + 1);
        const daysAgo = c.daysAgo - frac * (c.daysAgo - c.wonDaysAgo!);
        const channel = k % 2 === 0 ? "sms" : "email";
        const iso = bizTs(daysAgo, 10 + k, (k * 13) % 60);
        messageRows.push({
          consult_id: consultId,
          practice_id: practiceId,
          type: "followup",
          channel,
          subject: channel === "email" ? "Following up on your treatment plan" : null,
          body: `Hi ${c.first}, just following up on your treatment plan — let us know if any questions came up. We're excited to help you move forward!`,
          send_day: k + 1,
          status: "sent",
          sent_at: iso,
          scheduled_for: null,
          created_at: iso,
        });
      }
    }
    const { data: insertedMsgs, error: mErr } = await admin.from("messages").insert(messageRows).select("id, status");
    if (mErr) throw new Error(`messages insert: ${mErr.message}`);
    summary.sequences_created = CONSULTS.filter((c) => c.kind === "active").length;
    summary.sequence_messages_created = insertedMsgs?.length ?? 0;
    summary.messages_sent = (insertedMsgs || []).filter((m) => m.status === "sent").length;
    summary.messages_pending = (insertedMsgs || []).filter((m) => m.status === "scheduled").length;
    summary.pipeline_value = pipelineValue;

    // message_outcomes are auto-created by the track_message_sent trigger (one
    // per sent message, with the sequence position). Enrich them so the
    // Analytics "reply rate by position" chart shows a realistic declining curve
    // (opens on all, replies weighted to the earlier touches).
    const { data: outs } = await admin.from("message_outcomes").select("id, message_position").eq("practice_id", practiceId);
    const repliedIds: string[] = [];
    (outs || []).forEach((o, i) => {
      const p = (o.message_position as number) || 1;
      const reply = (p <= 2 && i % 2 === 0) || (p === 3 && i % 3 === 0) || (p === 4 && i % 5 === 0);
      if (reply) repliedIds.push(o.id as string);
    });
    await admin.from("message_outcomes").update({ opened: true, opened_at: bizTs(2, 12, 0) }).eq("practice_id", practiceId);
    if (repliedIds.length) {
      await admin.from("message_outcomes").update({ replied: true, replied_at: bizTs(1, 13, 0) }).in("id", repliedIds);
    }
    summary.message_outcomes_total = (outs || []).length;
    summary.message_outcomes_replied = repliedIds.length;

    // ----- 6b. PMS appointments (drives the Recording Rate card + 4-wk trend) -
    // ~6 implant consults/week for the last 4 weeks, ~83% recorded (linked to a
    // consult) so the ring reads "On track" with a healthy green trend.
    const allConsultIds = [...consultIdByName.values()];
    const apptRows: Record<string, unknown>[] = [];
    let apptIdx = 0;
    for (let w = 0; w < 4; w++) {
      for (let j = 0; j < 6; j++) {
        const daysAgo = w * 7 + (j % 5) + 1;
        const recorded = j < 5; // 5 of 6 recorded
        const iso = bizTs(daysAgo, 8 + j, (j * 10) % 60);
        apptRows.push({
          practice_id: practiceId,
          pms_appointment_id: `demo-appt-${w}-${j}`,
          patient_first: "Implant",
          patient_last: `Consult ${apptIdx + 1}`,
          appointment_time: iso,
          appointment_type: "Implant Consult",
          provider: "Dr. Torres",
          is_implant_consult: true,
          consult_id: recorded ? allConsultIds[apptIdx % allConsultIds.length] : null,
          created_at: iso,
        });
        apptIdx++;
      }
    }
    const { error: apErr } = await admin.from("pms_appointments").insert(apptRows);
    if (apErr) throw new Error(`pms_appointments insert: ${apErr.message}`);
    summary.pms_appointments_created = apptRows.length;

    // ----- 7. Conversations --------------------------------------------------
    async function makeConversation(c: Consult, msgs: { dir: "inbound" | "outbound"; channel: string; body: string; daysAgo: number; hour: number }[], unread: number) {
      const consultId = consultIdByName.get(`${c.first} ${c.last}`)!;
      const last = msgs[msgs.length - 1];
      const lastIso = bizTs(last.daysAgo, last.hour, 5);
      const { data: conv, error: convErr } = await admin
        .from("conversations")
        .insert({
          practice_id: practiceId,
          consult_id: consultId,
          patient_first: c.first,
          patient_last: c.last,
          patient_phone: c.phone,
          last_message_at: lastIso,
          last_message_preview: last.body.slice(0, 120),
          unread_count: unread,
          created_at: bizTs(msgs[0].daysAgo, msgs[0].hour, 0),
        })
        .select("id")
        .single();
      if (convErr) throw new Error(`conversation insert (${c.key}): ${convErr.message}`);
      const cmRows = msgs.map((m) => {
        const iso = bizTs(m.daysAgo, m.hour, (m.hour * 3) % 60);
        return { conversation_id: conv.id, direction: m.dir, channel: m.channel, body: m.body, sent_at: iso, created_at: iso };
      });
      const { error: cmErr } = await admin.from("conversation_messages").insert(cmRows);
      if (cmErr) throw new Error(`conversation_messages insert (${c.key}): ${cmErr.message}`);
      return cmRows.length;
    }

    let convMsgCount = 0;
    convMsgCount += await makeConversation(
      CONSULTS.find((c) => c.key === "robert")!,
      [
        { dir: "outbound", channel: "sms", body: "Hi Robert, this is the team following up after your consult — any questions as you and your wife think it over?", daysAgo: 5, hour: 10 },
        { dir: "inbound", channel: "sms", body: "Hi, yes we are still interested. Can you send me the financing details again?", daysAgo: 3, hour: 13 },
        { dir: "outbound", channel: "sms", body: "Absolutely! Just emailed you the full financing breakdown — you're pre-approved at $580/mo through Sunbit. Want me to hold a surgical date?", daysAgo: 3, hour: 14 },
        { dir: "inbound", channel: "sms", body: "Perfect, thank you. Let me talk to my wife tonight and I'll call you tomorrow.", daysAgo: 2, hour: 17 },
      ],
      1,
    );
    convMsgCount += await makeConversation(
      CONSULTS.find((c) => c.key === "karen")!,
      [
        { dir: "outbound", channel: "sms", body: "Hi Karen, following up on your full-arch consult — happy to answer anything you and your husband are weighing.", daysAgo: 10, hour: 11 },
        { dir: "outbound", channel: "email", body: "Hi Karen, sending over the treatment summary and a couple of patient stories in case they're helpful as you decide. We're here whenever you're ready.", daysAgo: 6, hour: 9 },
      ],
      0,
    );
    convMsgCount += await makeConversation(
      CONSULTS.find((c) => c.key === "jennifer")!,
      [
        { dir: "outbound", channel: "sms", body: "Hi Jennifer! Great meeting you today. You mentioned wanting to heal before your son's graduation in May — I can walk you through surgical dates whenever you're ready.", daysAgo: 2, hour: 16 },
      ],
      0,
    );
    summary.conversations_created = 3;
    summary.conversation_messages_created = convMsgCount;

    // ----- 8. Assisted wins --------------------------------------------------
    const winRows = CONSULTS.filter((c) => c.kind === "won").map((c) => {
      const wonIso = bizTs(c.wonDaysAgo!, 15, 0);
      return {
        practice_id: practiceId,
        consult_id: consultIdByName.get(`${c.first} ${c.last}`)!,
        patient_name: `${c.first} ${c.last}`,
        treatment_type: c.treatment,
        case_value: c.caseValue,
        messages_sent: c.messagesSent,
        first_message_sent_at: bizTs(c.daysAgo - 1, 10, 0),
        won_at: wonIso,
        won_by: "manual",
        created_at: wonIso,
      };
    });
    const { data: insertedWins, error: wErr } = await admin.from("assisted_wins").insert(winRows).select("id, case_value");
    if (wErr) throw new Error(`assisted_wins insert: ${wErr.message}`);
    summary.wins_created = insertedWins?.length ?? 0;
    summary.recovered_production = (insertedWins || []).reduce((s, w) => s + Number(w.case_value || 0), 0);

    // ----- 8b. Call logs (Power Dialer / call history) -----------------------
    const callSpecs = [
      { key: "robert", status: "completed", disposition: "Connected — sending financing", dur: 372, daysAgo: 5 },
      { key: "karen", status: "completed", disposition: "Left voicemail", dur: 38, daysAgo: 6 },
      { key: "thomas", status: "completed", disposition: "Connected — discussed sedation", dur: 511, daysAgo: 9 },
      { key: "jennifer", status: "completed", disposition: "Connected — booking surgery date", dur: 248, daysAgo: 1 },
      { key: "lisa", status: "no_answer", disposition: "No answer", dur: 0, daysAgo: 7 },
    ];
    const callRows = callSpecs.map((cs) => {
      const c = CONSULTS.find((x) => x.key === cs.key)!;
      const startedIso = bizTs(cs.daysAgo, 11, (cs.dur % 50));
      return {
        practice_id: practiceId,
        consult_id: consultIdByName.get(`${c.first} ${c.last}`)!,
        user_id: userId,
        direction: "outbound",
        to_number: c.phone,
        from_number: "(480) 555-0199",
        status: cs.status,
        disposition: cs.disposition,
        duration_seconds: cs.dur,
        started_at: startedIso,
        ended_at: new Date(new Date(startedIso).getTime() + cs.dur * 1000).toISOString(),
        created_at: startedIso,
      };
    });
    const { error: clErr } = await admin.from("call_logs").insert(callRows);
    if (clErr) throw new Error(`call_logs insert: ${clErr.message}`);
    summary.call_logs_created = callRows.length;

    // ----- 9. Training progress ----------------------------------------------
    // Module 1 (all 14 lessons) + first 4 of Module 2, completed for the demo user.
    const { data: mods } = await admin
      .from("training_modules")
      .select("id, module_group, order_index")
      .in("module_group", ["Module 1: Foundation", "Module 2: The Consult"])
      .order("order_index", { ascending: true });
    const mod1 = (mods || []).filter((m) => m.module_group === "Module 1: Foundation");
    const mod2 = (mods || []).filter((m) => m.module_group === "Module 2: The Consult").slice(0, 4);
    const completeModules = [...mod1, ...mod2];
    const mkRows = (uid: string) =>
      completeModules.map((m, i) => ({ user_id: uid, module_id: m.id, progress: 100, completed_at: bizTs(40 - i, 13, (i * 9) % 60) }));
    const progressRows = mkRows(userId);

    // Training progress is per-USER, not per-practice. When the super admin
    // clicks into the demo via impersonation they're still themselves, so seed
    // their user too — that's what makes the TC Certification page show as
    // completed inside the demo. (Also seeded on the demo user.)
    let superAdminId: string | null = null;
    if (sql) {
      const sa = await sql`select id from auth.users where lower(email) = ${SUPER_ADMIN_EMAIL} limit 1`;
      superAdminId = sa.length ? (sa[0].id as string) : null;
    }

    let trainingResult: unknown = { lessons_completed: 0, note: "no modules found" };
    if (progressRows.length) {
      // Probe: does training_progress exist & is it in the PostgREST cache?
      const probe = await admin.from("training_progress").select("user_id").limit(1);
      if (!probe.error) {
        await admin.from("training_progress").delete().eq("user_id", userId);
        const { error: tpErr } = await admin.from("training_progress").insert(progressRows);
        if (tpErr) throw new Error(`training_progress insert: ${tpErr.message}`);
        if (superAdminId) {
          await admin.from("training_progress").upsert(mkRows(superAdminId), { onConflict: "user_id,module_id" });
        }
        trainingResult = { lessons_completed: progressRows.length, module1: mod1.length, module2: mod2.length, via: "postgrest", super_admin_seeded: Boolean(superAdminId) };
      } else {
        // Table missing → create it + insert over the direct PG connection.
        if (!sql) {
          trainingResult = { lessons_completed: 0, error: "training_progress missing and SUPABASE_DB_URL unavailable", probe_error: probe.error.message };
        } else {
          {
            await sql.unsafe(`
              create table if not exists public.training_progress (
                user_id uuid not null references auth.users(id) on delete cascade,
                module_id uuid not null references public.training_modules(id) on delete cascade,
                progress int not null default 0,
                completed_at timestamptz,
                created_at timestamptz not null default now(),
                primary key (user_id, module_id)
              );
              alter table public.training_progress enable row level security;
              drop policy if exists "training_progress_own" on public.training_progress;
              create policy "training_progress_own" on public.training_progress
                for all using (user_id = auth.uid()) with check (user_id = auth.uid());
              grant select, insert, update, delete on public.training_progress to authenticated;
            `);
            await sql`delete from public.training_progress where user_id = ${userId}`;
            for (const r of progressRows) {
              await sql`insert into public.training_progress (user_id, module_id, progress, completed_at)
                        values (${r.user_id}, ${r.module_id}, ${r.progress}, ${r.completed_at})
                        on conflict (user_id, module_id) do update set progress = excluded.progress, completed_at = excluded.completed_at`;
            }
            // Ask PostgREST to reload its schema cache so the app sees the table.
            await sql.unsafe(`notify pgrst, 'reload schema';`);
            trainingResult = { lessons_completed: progressRows.length, module1: mod1.length, module2: mod2.length, via: "pg_direct", created_table: true };
          }
        }
      }
    }
    summary.training = trainingResult;

    summary.login = { email: DEMO_LOGIN_EMAIL, password: DEMO_LOGIN_PASSWORD };
    summary.ok = true;
    return json(summary);
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e), partial: summary }, 500);
  } finally {
    if (sql) await sql.end({ timeout: 5 });
  }
});
