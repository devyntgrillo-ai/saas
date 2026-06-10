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
const DEMO_PRACTICE_NAME = "Demo Dental";
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
// Future business timestamp (weekends shifted forward to Monday) for upcoming
// appointments that still need recording.
function bizTsFuture(inDays: number, hourMst = 10, minute = 0): string {
  const d = new Date(Date.now() + inDays * 86400000);
  const dow = d.getUTCDay();
  if (dow === 6) d.setUTCDate(d.getUTCDate() + 2);
  else if (dow === 0) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(hourMst + 7, minute, 0, 0);
  return d.toISOString();
}
// Today at a Mountain-Standard business hour (no weekend shift, these demo
// appointments must always read as "today"). A daily cron keeps them current.
function bizTsToday(hourMst = 10, minute = 0): string {
  const d = new Date();
  d.setUTCHours(hourMst + 7, minute, 0, 0);
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
    exitIntent: "Warm, requested time to discuss with wife", exitLevel: "warm",
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
    exitIntent: "Warm, very interested", exitLevel: "hot", seqStartDaysAgo: 7,
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
    exitIntent: "Very warm, asked about surgery date", exitLevel: "hot", seqStartDaysAgo: 2,
    coaching: "Jennifer is ready. She asked about surgery dates unprompted, that is a buying signal. The follow-up sequence should reference her specific timeline concern about healing before her son's graduation in May.",
  },
];

// 7-touch sequence template. send_day drives the schedule from activation.
const SEQ_TEMPLATE = [
  { day: 1, channel: "sms", subject: null as string | null, body: (n: string) => `Hi ${n}, this is the team following up after your consult. We really enjoyed meeting you, any questions we can help with as you think it over?` },
  { day: 3, channel: "email", subject: "Your financing options + a patient story", body: (n: string) => `Hi ${n},\n\nI put together a quick breakdown of the financing options we discussed, most patients are surprised how manageable the monthly number is. I also wanted to share a short story from a patient who was in your exact position last year and is thrilled with the result.\n\nHappy to walk through any of it whenever works for you.` },
  { day: 5, channel: "sms", subject: null, body: (n: string) => `Hi ${n}, just checking in, did the financing breakdown make sense? Glad to answer anything.` },
  { day: 7, channel: "email", subject: "Still here whenever you're ready", body: (n: string) => `Hi ${n},\n\nNo pressure at all, just wanted you to know we're here when you're ready to move forward. Here's a testimonial from a patient who had the same hesitation and is so glad they did it.` },
  { day: 14, channel: "sms", subject: null, body: (n: string) => `Hi ${n}, hope you're doing well! Wanted to check in and see if now is a better time to talk through next steps.` },
  { day: 21, channel: "email", subject: "Holding your treatment plan pricing", body: (n: string) => `Hi ${n},\n\nWe're able to hold your current treatment-plan pricing for a little longer, and our surgical calendar is filling up for the season. If you'd like, I can pencil you in tentatively, no commitment.` },
  { day: 30, channel: "sms", subject: null, body: (n: string) => `Hi ${n}, last check-in from me for now, we'd love to help you get this done. Reply anytime and we'll pick right back up.` },
];

// Human-readable treatment labels + appointment types.
const TREATMENT_LABEL: Record<string, string> = {
  full_arch: "full-arch restoration",
  single_implant: "single implant",
  dental_implants: "dental implants",
  invisalign: "Invisalign",
  cosmetic: "cosmetic veneers",
};
const APPT_TYPE: Record<string, string> = {
  full_arch: "Full Arch Consult",
  single_implant: "Implant Consult",
  dental_implants: "Implant Consult",
  invisalign: "Invisalign Consult",
  cosmetic: "Cosmetic Consult",
};

// Objection-specific analysis copy so every consult detail page is fully filled.
const OBJECTION_PACK: Record<string, { secondary: string; downsell: string; tc: string }> = {
  price: {
    secondary: "Wanted to compare against another office's quote",
    downsell: "Phased treatment, start with the arch causing the most pain, finance the rest",
    tc: "Re-send the Sunbit pre-approval and the monthly breakdown; lead with the per-day cost framing.",
  },
  fear: {
    secondary: "Concerned about recovery time and pain",
    downsell: "IV sedation add-on and a single-visit option to reduce chair time",
    tc: "Send the sedation explainer video and 2 testimonials from anxious patients. Offer a no-pressure call with the doctor.",
  },
  spouse: {
    secondary: "Needs to align on budget at home",
    downsell: "Offer a joint call with both spouses and a printable one-pager",
    tc: "Schedule a 10-minute call with both spouses present; send the one-pager they can review together.",
  },
  timing: {
    secondary: "Checking schedule around work and travel",
    downsell: "Reserve a tentative surgical date to anchor the decision",
    tc: "Hold a tentative date and frame the healing timeline around their personal milestone.",
  },
};
const DEFAULT_PACK = { secondary: "No major secondary objection", downsell: "Offer a phased plan to fit their budget", tc: "Follow up within 48 hours with the requested details." };

const PERSONAL_DETAIL: Record<string, string> = {
  robert: "Daughter's wedding in June, wants to feel confident smiling in photos.",
  sandra: "Recently retired; finally prioritizing herself.",
  james: "Avid golfer; lost the tooth in a weekend accident.",
  patricia: "Comparing two offices; very detail-oriented.",
  david: "Wedding photos coming up; wants a straighter smile.",
  karen: "Decision-maker is her husband of 30 years.",
  michael: "Business owner; values efficiency and one-visit options.",
  lisa: "Budget-conscious single mom; researched extensively.",
  thomas: "Has wanted this for 3 years; high dental anxiety.",
  nancy: "Big family reunion this fall she wants to look great for.",
  christopher: "New to the area; financing is the main hurdle.",
  jennifer: "Son's graduation in May, wants to be healed in time.",
};

// A realistic TC↔patient transcript so the detail page reads as a real consult.
function genTranscript(c: Consult): string {
  const tx = TREATMENT_LABEL[c.treatment] || "treatment";
  const obj = (c.objection || "the investment").toLowerCase();
  return [
    `TC: Thanks for coming in today, ${c.first}. Dr. Torres walked you through the ${tx} plan, how are you feeling about everything?`,
    `${c.first}: Honestly, really good. I've been thinking about this for a while. My main hesitation is ${obj}.`,
    `TC: Totally understandable, and you're not alone there. A lot of our patients feel the same before they see the full picture. Can I show you how the numbers actually break down month to month?`,
    `${c.first}: Yeah, that would help.`,
    `TC: Your plan comes to ${"$" + c.caseValue.toLocaleString()}. With Sunbit financing, most patients in your range land around a comfortable monthly payment with no big upfront cost. We can also phase the treatment if that's easier.`,
    `${c.first}: Okay, that's more manageable than I expected. I do want to talk it over before I commit.`,
    `TC: Of course, this is a big decision and I want you to feel 100% confident. How about I send you the full breakdown and a couple of stories from patients who were right where you are? Then we can pick a date whenever you're ready.`,
    `${c.first}: That sounds great, thank you.`,
    `TC: My pleasure, ${c.first}. You're going to love the result.`,
  ].join("\n\n");
}

function analysisFor(c: Consult) {
  const pack = (c.objectionType && OBJECTION_PACK[c.objectionType]) || DEFAULT_PACK;
  const tx = TREATMENT_LABEL[c.treatment] || "treatment";
  return {
    transcript: genTranscript(c),
    what_happened:
      c.summary ||
      `Strong ${tx} consult with ${c.first}. Engaged throughout and asked buying-signal questions. Main hesitation was ${(c.objection || "the investment").toLowerCase()}; otherwise a great fit. Recommended a prompt, value-led follow-up.`,
    secondary_objection: pack.secondary,
    personal_detail: PERSONAL_DETAIL[c.key] || null,
    downsell_opportunity: pack.downsell,
    tc_action: pack.tc,
    coaching_insight:
      c.coaching ||
      `${c.first} is a realistic close. Reinforce the value of ${tx}, address the ${(c.objectionType || "main")} concern head-on, and make the next step easy with a tentative date.`,
  };
}

// Knowledge base shown in Settings → Knowledge Base (accordion sections + stories).
const KB_SECTIONS: Record<string, string> = {
  practice_overview:
    "Demo Dental is a Scottsdale, AZ implant and cosmetic practice led by Dr. Michael Torres. We focus on full-arch restoration (All-on-4/All-on-X), single implants, and smile makeovers. Our differentiator is a same-week surgical timeline, in-house CBCT, and IV sedation for anxious patients. The treatment coordinator owns every consult follow-up.",
  pricing:
    "Full arch (per arch): $38,000–$47,000. Single implant + crown: $4,500–$5,200. Dental implants (multiple): $11,000–$15,000. Invisalign: $5,500–$6,500. Cosmetic veneers: $8,000–$12,000. Financing through Sunbit and Cherry, most full-arch patients land $550–$620/mo with $0 down. We can phase treatment arch-by-arch.",
  what_works:
    "Reframing total cost as a per-day number over the life of the implants. Showing before/after photos of patients the same age. Bringing the doctor in for 2 minutes on fear objections. Holding a tentative surgical date to create gentle momentum. Pre-approving financing during the consult, not after.",
  what_not:
    "Leading with the full price before establishing value. Pushing for a same-day decision on full-arch cases. Emailing a generic quote with no context. Saying 'let me know if you have questions' and waiting, always set the next step.",
  coaching_notes:
    "TC reminders: every consult gets a personal SMS within 24 hours. Reference one specific personal detail from the visit. Send financing breakdown as an image, not a wall of text. Call (don't just text) any warm full-arch lead that goes quiet for 5 days.",
  doctor_style:
    "Dr. Torres prefers a calm, education-first tone. He likes patients to understand the 'why' behind the bone graft and healing timeline. Avoid hard-sell language; he wants patients to feel in control of the decision.",
  scheduling:
    "Surgical days: Tuesday and Thursday. Typical wait from yes to surgery: 1–2 weeks. Consults available Mon–Fri. Healing/integration window communicated up front so patients can plan around events.",
};
const KB_STORIES = [
  { category: "price_overcome", title: "Robert, $42k full arch", text: "Hesitant on the monthly payment. Pre-approved at $580/mo through Sunbit during the consult; reframed as less than his daily coffee + lunch. Moved forward within a week." },
  { category: "fear_overcome", title: "Thomas, surgery fear", text: "Wanted implants for 3 years but terrified of surgery. Doctor spent 2 minutes on IV sedation + showed an anxious-patient testimonial. Booked once fear was addressed." },
  { category: "spouse_converted", title: "Karen, needed spouse buy-in", text: "Decision hinged on her husband. Did a 10-minute joint call with a one-page summary they could review together. Converted after the spouse felt included." },
  { category: "other", title: "Jennifer, timeline-driven", text: "Wanted to heal before her son's May graduation. Anchored a tentative surgical date around the milestone, the deadline made the decision easy." },
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

    if (body.debug === "name" && sql) {
      const rows = await sql`select id, name, email from public.practices where email = ${DEMO_PRACTICE_EMAIL}`;
      return json({ demoPractices: rows });
    }

    if (body.action === "cleanuptest" && sql) {
      const delP = await sql`delete from public.practices where email like 'signuptest+%@example.com' returning id`;
      const delU = await sql`delete from auth.users where email like 'signuptest+%@example.com' returning id`;
      return json({ deleted_practices: delP.length, deleted_users: delU.length });
    }

    if (body.action === "fixrls" && sql) {
      // Drop the self-referential rate-limit on practices_insert that caused
      // 42P17 infinite recursion and blocked signup.
      await sql.unsafe(`
        drop policy if exists "practices_insert" on public.practices;
        create policy "practices_insert" on public.practices
          for insert to authenticated
          with check (auth.uid() is not null);
      `);
      const [check] = await sql`select pg_get_expr(polwithcheck, polrelid) as check from pg_policy where polrelid='public.practices'::regclass and polname='practices_insert'`;
      return json({ ok: true, new_check: check?.check });
    }

    if (body.debug === "pol" && sql) {
      const practicesPolicies = await sql`select polname, polcmd, pg_get_expr(polqual, polrelid) as qual, pg_get_expr(polwithcheck, polrelid) as check from pg_policy where polrelid = 'public.practices'::regclass`;
      const usersPolicies = await sql`select polname, polcmd, pg_get_expr(polqual, polrelid) as qual from pg_policy where polrelid = 'public.users'::regclass`;
      const fns = await sql`select proname, pg_get_functiondef(oid) as def from pg_proc where pronamespace = 'public'::regnamespace and proname in ('is_super_admin','current_practice_id','user_practice_ids','is_agency_admin','is_platform_super_admin')`;
      return json({ practicesPolicies, usersPolicies, fns });
    }

    if (body.debug === "find" && sql) {
      const q = `%${body.q || ""}%`;
      const [p] = await sql`select id from public.practices where email = ${DEMO_PRACTICE_EMAIL}`;
      const consults = await sql`select id, patient_name, status, outcome, recording_date, appointment_id, created_at from public.consults where practice_id = ${p.id} and patient_name ilike ${q}`;
      const appts = await sql`select id, patient_first, patient_last, appointment_time, consult_id, pms_appointment_id, appointment_type from public.pms_appointments where practice_id = ${p.id} and (coalesce(patient_first,'') || ' ' || coalesce(patient_last,'')) ilike ${q}`;
      return json({ consults, appts });
    }

    // Re-date a demo consult (by patient name) to N days ago so it rolls off the
    // "today" Schedule into the Recordings archive. Also backfills recording_date.
    if (body.action === "redate" && sql) {
      const daysAgo = Number(body.daysAgo) || 1;
      const iso = bizTs(daysAgo, 10, 0);
      const [p] = await sql`select id from public.practices where email = ${DEMO_PRACTICE_EMAIL}`;
      const r = await sql`update public.consults set created_at = ${iso}, recording_date = ${iso.slice(0, 10)}
        where practice_id = ${p.id} and patient_name ilike ${`%${body.name || ""}%`}
        returning id, patient_name, recording_date, created_at`;
      return json({ redated: r });
    }

    // Apply the new demo name (and matching KB overview) to the live record
    // without a full reseed, so existing demo data is preserved.
    if (body.action === "fixname") {
      const { data, error } = await admin
        .from("practices")
        .update({ name: DEMO_PRACTICE_NAME, knowledge_base_sections: KB_SECTIONS })
        .eq("email", DEMO_PRACTICE_EMAIL)
        .select("id, name");
      return json({ ok: !error, updated: data, error: error?.message });
    }

    if (body.debug === "rlstest" && sql) {
      // Simulate the super admin updating the demo practice name under RLS,
      // then roll back. Tells us whether a real client edit would persist.
      const [pr] = await sql`select id from public.practices where email = ${DEMO_PRACTICE_EMAIL}`;
      const [au] = await sql`select id from public.users where lower(email) = ${SUPER_ADMIN_EMAIL}`;
      let updated: unknown = "n/a";
      try {
        await sql.begin(async (tx) => {
          await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: au.id, role: "authenticated" })}, true)`;
          await tx`set local role authenticated`;
          const r = await tx`update public.practices set name = 'RLS Probe' where id = ${pr.id} returning id`;
          updated = r.length;
          throw new Error("__rollback__");
        });
      } catch (e) {
        if ((e as Error).message !== "__rollback__") updated = `error: ${(e as Error).message}`;
      }
      return json({ rlstest: { rows_super_admin_can_update: updated } });
    }

    if (body.debug === "rls" && sql) {
      const adminUser = await sql`select id, email, role, access_level, practice_id from public.users where lower(email) = ${SUPER_ADMIN_EMAIL}`;
      const updatePolicies = await sql`select polname, pg_get_expr(polqual, polrelid) as using_expr from pg_policy where polrelid = 'public.practices'::regclass and polcmd in ('w','*')`;
      const hasFn = await sql`select count(*)::int as n from pg_proc where proname = 'is_platform_super_admin'`;
      return json({ rls: { adminUser, updatePolicies, has_is_platform_super_admin: hasFn[0]?.n } });
    }

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
          (select count(*) from public.consults where practice_id = (select id from p limit 1) and status='active') as status_active,
          (select count(*) from public.consults where practice_id = (select id from p limit 1) and appointment_id is not null) as consults_pms_linked,
          (select count(*) from public.consults where practice_id = (select id from p limit 1) and transcript is not null) as consults_with_transcript,
          (select count(*) from public.pms_appointments where practice_id = (select id from p limit 1) and consult_id is null and appointment_time > now()) as upcoming_to_record,
          (select count(*) from public.pms_appointments where practice_id = (select id from p limit 1) and appointment_time::date = current_date) as appointments_today,
          (select count(*) from public.call_logs where practice_id = (select id from p limit 1) and conversation_id is not null) as calls_in_threads,
          (select count(*) from public.messages where practice_id = (select id from p limit 1) and (type='call' or channel='call') and status='scheduled') as power_dialer_queue,
          (select count(*) from public.pms_appointments where practice_id = (select id from p limit 1) and patient_email is null) as appts_missing_email,
          (select a2p_brand_status || '/' || a2p_campaign_status from public.practices where id = (select id from p limit 1)) as a2p_status,
          (select (knowledge_base_sections is not null) from public.practices where id = (select id from p limit 1)) as has_knowledge_base,
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
      await admin.from("pms_patients").delete().eq("practice_id", prior.id);
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
        name: DEMO_PRACTICE_NAME,
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
        twilio_phone_e164: "+14805550199",
        notify_email_address: DEMO_PRACTICE_EMAIL,
        notify_sms_number: "(480) 555-0199",
        weekly_digest_enabled: true,
        weekly_digest_day: "monday",
        weekly_digest_time: "9am",
        digest_owner_email: DEMO_PRACTICE_EMAIL,
        notification_prefs: notificationPrefs,
        // A2P 10DLC fully approved so the messaging status reads "Active".
        a2p_brand_status: "approved",
        a2p_campaign_status: "approved",
        twilio_brand_sid: "BN0000000000000000000000000demo01",
        twilio_campaign_sid: "QE0000000000000000000000000demo01",
        twilio_messaging_service_sid: "MG0000000000000000000000000demo01",
        twilio_phone_sid: "PN0000000000000000000000000demo01",
        a2p_submitted_at: bizTs(80, 10, 0),
        // Knowledge base (Settings → Knowledge Base).
        knowledge_base_sections: KB_SECTIONS,
        knowledge_base_stories: KB_STORIES,
        knowledge_base_updated_at: bizTs(6, 11, 0),
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
      const a = analysisFor(c);
      const base: Record<string, unknown> = {
        practice_id: practiceId,
        patient_name: `${c.first} ${c.last}`,
        patient_first: c.first,
        patient_last: c.last,
        patient_phone: c.phone,
        patient_email: `${c.first.toLowerCase()}.${c.last.toLowerCase()}@example.com`,
        treatment_type: c.treatment,
        case_value: c.caseValue,
        tx_plan_value: c.caseValue,
        // App-level status vocabulary (drives the Pipeline Value card, status
        // pills, and activation rate). NOT the base-schema 'analyzed'.
        status: "active",
        primary_objection: c.objection ?? null,
        objection_type: c.objectionType ?? null,
        secondary_objection: a.secondary_objection,
        exit_intent: c.exitIntent ?? null,
        exit_intent_level: c.exitLevel ?? null,
        coaching_insight: a.coaching_insight,
        what_happened: a.what_happened,
        transcript: a.transcript,
        personal_detail: a.personal_detail,
        downsell_opportunity: a.downsell_opportunity,
        tc_action: a.tc_action,
        recording_date: ymd(createdIso),
        recording_time: hms(createdIso),
        recording_source: "plaud_device",
        duration: 1400 + ((c.caseValue / 50) % 1500 | 0),
        pms_synced: true,
        created_at: createdIso,
      };
      if (c.kind === "won") {
        const wonIso = bizTs(c.wonDaysAgo!, 14, 30);
        Object.assign(base, {
          status: "closed_won",
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
          status: "closed_lost",
          outcome: "not_converting",
          outcome_set_at: bizTs(c.daysAgo - 1, 11, 0),
          attribution_status: null,
          tx_plan_value_source: "estimate",
          sequence_status: "cancelled",
          sequence_cancelled_reason: "not_a_fit",
        });
      } else {
        Object.assign(base, {
          status: c.key === "robert" ? "replied" : "active",
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
          body: `Hi ${c.first}, just following up on your treatment plan, let us know if any questions came up. We're excited to help you move forward!`,
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

    // ----- 6c. Power Dialer queue: call tasks due today ----------------------
    // The Power Dialer reads messages with type/channel 'call' that are due by
    // end of today and whose consult has a phone number. Seed a few warm leads
    // so the dialer opens with a live call list.
    const callTaskSpecs = [
      { key: "thomas", note: "Call Thomas, address surgery fear, lead with sedation options. Very warm." },
      { key: "lisa", note: "Call Lisa, re-frame cost as monthly; she said too expensive but is engaged." },
      { key: "christopher", note: "Call Christopher, walk through financing options. Warm." },
      { key: "karen", note: "Call Karen, offer a joint call with her husband to align on the decision." },
      { key: "robert", note: "Call Robert back, ready to schedule, confirm surgical date." },
    ];
    const callTaskRows = callTaskSpecs.map((t, i) => {
      const c = CONSULTS.find((x) => x.key === t.key)!;
      return {
        consult_id: consultIdByName.get(`${c.first} ${c.last}`)!,
        practice_id: practiceId,
        type: "call",
        channel: "call",
        subject: null,
        body: t.note,
        send_day: null,
        status: "scheduled",
        scheduled_for: bizTsToday(8 + i, (i * 15) % 60),
        sent_at: null,
        created_at: bizTs(1, 9, 0),
      };
    });
    const { error: ctErr } = await admin.from("messages").insert(callTaskRows);
    if (ctErr) throw new Error(`call tasks insert: ${ctErr.message}`);
    summary.power_dialer_queue = callTaskRows.length;

    // ----- 6b. PMS appointments ---------------------------------------------
    // Everything looks synced from Dentrix: one linked appointment per consult
    // (so detail pages show as PMS-linked), 4 weeks of trend appts for the
    // Recording Rate card, and 3 upcoming appts that still need recording.
    const isImplant = (t: string) => ["full_arch", "single_implant", "dental_implants"].includes(t);

    // 1) One appointment per consult, linked both ways (recorded).
    const perConsultAppts = CONSULTS.map((c, idx) => {
      const apptIso = bizTs(c.daysAgo, 8 + (idx % 6), (idx * 5) % 60);
      return {
        practice_id: practiceId,
        pms_appointment_id: `demo-appt-c-${idx}`,
        patient_first: c.first,
        patient_last: c.last,
        patient_phone: c.phone,
        patient_email: `${c.first.toLowerCase()}.${c.last.toLowerCase()}@example.com`,
        appointment_time: apptIso,
        appointment_type: APPT_TYPE[c.treatment] || "Implant Consult",
        provider: "Dr. Torres",
        is_implant_consult: isImplant(c.treatment),
        consult_id: consultIdByName.get(`${c.first} ${c.last}`)!,
        created_at: apptIso,
      };
    });
    const { data: insAppts, error: apErr } = await admin.from("pms_appointments").insert(perConsultAppts).select("id, consult_id");
    if (apErr) throw new Error(`pms_appointments insert: ${apErr.message}`);
    // Forward-link each consult to its appointment + mark synced (no "not in PMS").
    for (const a of insAppts || []) {
      await admin.from("consults").update({ appointment_id: a.id, pms_synced: true }).eq("id", a.consult_id);
    }

    // 2) Trend filler: a couple recorded + one unrecorded implant appt per week.
    const implantConsultIds = CONSULTS.filter((c) => isImplant(c.treatment)).map((c) => consultIdByName.get(`${c.first} ${c.last}`)!);
    const NAME_POOL = [["Olivia", "Bennett"], ["Marcus", "Reed"], ["Diana", "Foster"], ["Henry", "Park"], ["Sofia", "Nguyen"], ["Walter", "Hayes"], ["Grace", "Coleman"], ["Victor", "Ramirez"], ["Eleanor", "Brooks"], ["Felix", "Morgan"], ["Ruth", "Sanders"], ["Leo", "Dawson"]];
    const fillerRows: Record<string, unknown>[] = [];
    let fi = 0;
    for (let w = 0; w < 4; w++) {
      for (let j = 0; j < 5; j++) {
        const daysAgo = w * 7 + j + 1;
        const nm = NAME_POOL[fi % NAME_POOL.length];
        const iso = bizTs(daysAgo, 9 + j, (j * 12) % 60);
        fillerRows.push({
          practice_id: practiceId,
          pms_appointment_id: `demo-appt-f-${w}-${j}`,
          patient_first: nm[0],
          patient_last: nm[1],
          patient_phone: `(480) 555-01${10 + (fi % 80)}`,
          patient_email: `${nm[0].toLowerCase()}.${nm[1].toLowerCase()}@example.com`,
          appointment_time: iso,
          appointment_type: "Implant Consult",
          provider: "Dr. Torres",
          is_implant_consult: true,
          consult_id: implantConsultIds[fi % implantConsultIds.length],
          created_at: iso,
        });
        fi++;
      }
    }

    // 3) Upcoming, still-to-record (synced from PMS): 1 Invisalign + 2 implants.
    const upcomingSpecs = [
      { first: "Amanda", last: "Reyes", type: "Invisalign Consult", implant: false, inDays: 1, hour: 9 },
      { first: "Gregory", last: "Hill", type: "Implant Consult", implant: true, inDays: 2, hour: 11 },
      { first: "Teresa", last: "Vaughn", type: "Implant Consult", implant: true, inDays: 4, hour: 14 },
    ];
    const upcomingRows = upcomingSpecs.map((u, idx) => ({
      practice_id: practiceId,
      pms_appointment_id: `demo-appt-up-${idx}`,
      patient_first: u.first,
      patient_last: u.last,
      patient_phone: `(480) 555-02${10 + idx}`,
      patient_email: `${u.first.toLowerCase()}.${u.last.toLowerCase()}@example.com`,
      appointment_time: bizTsFuture(u.inDays, u.hour),
      appointment_type: u.type,
      provider: "Dr. Torres",
      is_implant_consult: u.implant,
      consult_id: null,
      created_at: bizTs(0, 8, 0),
    }));

    // 4) Three appointments dated TODAY (the demo "day view" / today's worklist).
    // A daily cron (apply_cron.sql: demo-today-refresh) rolls these to the
    // current date so they always read as today without re-seeding.
    const todaySpecs = [
      { first: "Brian", last: "Foster", type: "Implant Consult", implant: true, hour: 9, min: 0 },
      { first: "Michelle", last: "Carter", type: "Full Arch Consult", implant: true, hour: 11, min: 30 },
      { first: "Daniel", last: "Wong", type: "Invisalign Consult", implant: false, hour: 14, min: 0 },
    ];
    const todayRows = todaySpecs.map((u, idx) => ({
      practice_id: practiceId,
      pms_appointment_id: `demo-today-${idx}`,
      patient_first: u.first,
      patient_last: u.last,
      patient_phone: `(480) 555-03${10 + idx}`,
      patient_email: `${u.first.toLowerCase()}.${u.last.toLowerCase()}@example.com`,
      appointment_time: bizTsToday(u.hour, u.min),
      appointment_type: u.type,
      provider: "Dr. Torres",
      is_implant_consult: u.implant,
      consult_id: null,
      created_at: bizTs(0, 8, 0),
    }));

    const { error: apErr2 } = await admin.from("pms_appointments").insert([...fillerRows, ...upcomingRows, ...todayRows]);
    if (apErr2) throw new Error(`pms_appointments filler insert: ${apErr2.message}`);
    summary.pms_appointments_created = perConsultAppts.length + fillerRows.length + upcomingRows.length + todayRows.length;
    summary.upcoming_to_record = upcomingRows.length;
    summary.today_appointments = todayRows.length;

    // ----- 6b. PMS patient roster (as if a PMS sync populated it) -------------
    // 36 patients so the "Select Patient" picker in the recording flow has a full,
    // searchable roster for demos.
    const PATIENT_ROSTER: [string, string][] = [
      ["Olivia", "Bennett"], ["Marcus", "Reed"], ["Diana", "Foster"], ["Henry", "Park"],
      ["Sofia", "Nguyen"], ["Walter", "Hayes"], ["Grace", "Coleman"], ["Victor", "Ramirez"],
      ["Eleanor", "Brooks"], ["Felix", "Morgan"], ["Ruth", "Sanders"], ["Leo", "Dawson"],
      ["Amelia", "Cole"], ["Nathan", "Boyd"], ["Camila", "Ortiz"], ["Owen", "Fleming"],
      ["Hazel", "Stein"], ["Julian", "Vance"], ["Maya", "Patel"], ["Caleb", "Frost"],
      ["Nora", "Lindqvist"], ["Elijah", "Barrett"], ["Layla", "Haddad"], ["Sebastian", "Cho"],
      ["Aria", "Donovan"], ["Miles", "Hoffman"], ["Stella", "Maddox"], ["Adrian", "Quinn"],
      ["Violet", "Acosta"], ["Theo", "Whitfield"], ["Iris", "Calloway"], ["Roman", "Esparza"],
      ["Daphne", "Mercer"], ["Oscar", "Trent"], ["Lucia", "Romano"], ["Beatrice", "Holloway"],
    ];
    const patientRows = PATIENT_ROSTER.map(([first, last], i) => ({
      practice_id: practiceId,
      external_id: `demo-pat-${i + 1}`,
      first_name: first,
      last_name: last,
      phone: `(480) 555-${String(1001 + i).padStart(4, "0")}`,
      email: `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
    }));
    const { error: ppErr } = await admin.from("pms_patients").insert(patientRows);
    if (ppErr) throw new Error(`pms_patients insert: ${ppErr.message}`);
    summary.pms_patients_created = patientRows.length;

    // ----- 7. Conversations --------------------------------------------------
    async function makeConversation(c: Consult, msgs: { dir: "inbound" | "outbound"; channel: string; body: string; daysAgo: number; hour: number; subject?: string }[], unread: number) {
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
          patient_email: `${c.first.toLowerCase()}.${c.last.toLowerCase()}@example.com`,
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
        return { conversation_id: conv.id, direction: m.dir, channel: m.channel, body: m.body, meta: m.subject ? { subject: m.subject } : null, sent_at: iso, created_at: iso };
      });
      const { error: cmErr } = await admin.from("conversation_messages").insert(cmRows);
      if (cmErr) throw new Error(`conversation_messages insert (${c.key}): ${cmErr.message}`);
      return { id: conv.id as string, count: cmRows.length };
    }

    // A placeholder, publicly-playable recording so the in-thread player works.
    const PLACEHOLDER_RECORDING = "https://demo.twilio.com/docs/classic.mp3";
    let callCount = 0;
    async function addCall(
      convId: string,
      consultId: string,
      o: { inbound: boolean; daysAgo: number; hour: number; duration: number; disposition: string; outcome: string; note: string; transcript: string; phone: string },
    ) {
      const startedIso = bizTs(o.daysAgo, o.hour, 0);
      const { data: cl, error: clErr } = await admin
        .from("call_logs")
        .insert({
          practice_id: practiceId,
          consult_id: consultId,
          conversation_id: convId,
          user_id: userId,
          direction: o.inbound ? "inbound" : "outbound",
          to_number: o.inbound ? "(480) 555-0199" : o.phone,
          from_number: o.inbound ? o.phone : "(480) 555-0199",
          status: "completed",
          disposition: o.disposition,
          duration_seconds: o.duration,
          recording_url: PLACEHOLDER_RECORDING,
          recording_duration: o.duration,
          transcript_deidentified: o.transcript,
          transcript_status: "completed",
          started_at: startedIso,
          ended_at: new Date(new Date(startedIso).getTime() + o.duration * 1000).toISOString(),
          created_at: startedIso,
        })
        .select("id")
        .single();
      if (clErr) throw new Error(`call_logs insert: ${clErr.message}`);
      const { error: cmErr } = await admin.from("conversation_messages").insert({
        conversation_id: convId,
        direction: o.inbound ? "inbound" : "outbound",
        channel: "call",
        call_log_id: cl.id,
        body: o.note,
        meta: { duration_sec: o.duration, outcome: o.outcome, note: o.note },
        sent_at: startedIso,
        created_at: startedIso,
      });
      if (cmErr) throw new Error(`call conversation_message insert: ${cmErr.message}`);
      callCount++;
    }

    let convMsgCount = 0;
    const robert = CONSULTS.find((c) => c.key === "robert")!;
    const robertConv = await makeConversation(
      robert,
      [
        { dir: "outbound", channel: "sms", body: "Hi Robert, this is the team following up after your consult, any questions as you and your wife think it over?", daysAgo: 5, hour: 10 },
        { dir: "inbound", channel: "sms", body: "Hi, yes we are still interested. Can you send me the financing details again?", daysAgo: 3, hour: 13 },
        { dir: "outbound", channel: "sms", body: "Absolutely! Just emailed you the full financing breakdown, you're pre-approved at $580/mo through Sunbit. Want me to hold a surgical date?", daysAgo: 3, hour: 14 },
        { dir: "inbound", channel: "sms", body: "Perfect, thank you. Let me talk to my wife tonight and I'll call you tomorrow.", daysAgo: 2, hour: 17 },
      ],
      1,
    );
    convMsgCount += robertConv.count;
    await addCall(robertConv.id, consultIdByName.get(`${robert.first} ${robert.last}`)!, {
      inbound: false, daysAgo: 4, hour: 11, duration: 372, disposition: "Connected", outcome: "Connected", phone: robert.phone,
      note: "Walked through the financing breakdown; sending Sunbit pre-approval.",
      transcript: "TC: Hi Robert, it's the team from Pinnacle Dental, is now a good time?\nRobert: Sure, go ahead.\nTC: Great. I wanted to walk you through the financing so the number feels real. You're pre-approved at $580 a month with nothing down.\nRobert: That's better than I thought. Let me talk it over with my wife.\nTC: Of course, I'll send the breakdown by text. Want me to pencil in a tentative surgery date?\nRobert: Yeah, let's do that.\nTC: Perfect, I'll text you the options. Thanks Robert!",
    });
    await addCall(robertConv.id, consultIdByName.get(`${robert.first} ${robert.last}`)!, {
      inbound: true, daysAgo: 2, hour: 16, duration: 144, disposition: "Connected", outcome: "Inbound, ready to schedule", phone: robert.phone,
      note: "Robert called back ready to move forward.",
      transcript: "Robert: Hi, it's Robert Martinez, my wife and I talked it over and we want to move forward.\nTC: That's wonderful, Robert! I'm so glad. Let's get your surgical date locked in.\nRobert: Sounds good. The earlier the better before our daughter's wedding.\nTC: Absolutely, I'll get you scheduled this week.",
    });

    const karen = CONSULTS.find((c) => c.key === "karen")!;
    const karenConv = await makeConversation(
      karen,
      [
        { dir: "outbound", channel: "sms", body: "Hi Karen, following up on your full-arch consult, happy to answer anything you and your husband are weighing.", daysAgo: 10, hour: 11 },
        { dir: "outbound", channel: "email", subject: "Your full arch treatment plan and financing options", body: "Hi Karen,\n\nGreat meeting you and your husband today. As promised, here is the full breakdown of your full arch treatment plan along with the financing options we discussed. Most patients are surprised how manageable the monthly number ends up being, and I included a couple of before and after results from patients who were in a similar spot.\n\nWhenever you two are ready, I can hold a surgical date for you. No pressure at all.\n\nWarmly,\nThe Pinnacle Dental team", daysAgo: 6, hour: 9 },
        { dir: "inbound", channel: "email", subject: "Re: Your full arch treatment plan and financing options", body: "Thank you so much for sending this over. The monthly option actually looks doable. I am going to talk it through with my husband this weekend and should have an answer for you Monday. Really appreciate how patient you have been with us.", daysAgo: 1, hour: 15 },
      ],
      1,
    );
    convMsgCount += karenConv.count;
    await addCall(karenConv.id, consultIdByName.get(`${karen.first} ${karen.last}`)!, {
      inbound: false, daysAgo: 5, hour: 13, duration: 41, disposition: "Left voicemail", outcome: "Voicemail", phone: karen.phone,
      note: "Left a warm voicemail offering a joint call with her husband.",
      transcript: "TC: Hi Karen, it's the team at Pinnacle Dental Implants. No rush at all, I just wanted to offer a quick call with you and your husband together so you can both ask questions. Give me a ring back whenever works. Thanks Karen!",
    });

    const jennifer = CONSULTS.find((c) => c.key === "jennifer")!;
    const jenniferConv = await makeConversation(
      jennifer,
      [
        { dir: "outbound", channel: "sms", body: "Hi Jennifer! Great meeting you today. You mentioned wanting to heal before your son's graduation in May, I can walk you through surgical dates whenever you're ready.", daysAgo: 2, hour: 16 },
        { dir: "outbound", channel: "email", subject: "Your timeline to be ready by graduation", body: "Hi Jennifer,\n\nYou mentioned wanting to feel confident for your son's graduation in May, so I wanted to put the timeline in writing. If we start within the next two weeks, you will be fully healed and smiling for the photos. I attached a simple month by month schedule and the financing summary.\n\nWant me to pencil in a tentative surgery date this week?\n\nTalk soon,\nThe Pinnacle Dental team", daysAgo: 1, hour: 10 },
      ],
      0,
    );
    convMsgCount += jenniferConv.count;
    summary.conversations_created = 3;
    summary.conversation_messages_created = convMsgCount;
    summary.calls_in_threads = callCount;

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
      { key: "robert", status: "completed", disposition: "Connected, sending financing", dur: 372, daysAgo: 5 },
      { key: "karen", status: "completed", disposition: "Left voicemail", dur: 38, daysAgo: 6 },
      { key: "thomas", status: "completed", disposition: "Connected, discussed sedation", dur: 511, daysAgo: 9 },
      { key: "jennifer", status: "completed", disposition: "Connected, booking surgery date", dur: 248, daysAgo: 1 },
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
    // their user too, that's what makes the TC Certification page show as
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
