import { reportEdgeError } from "../_shared/report-error.ts";
// ============================================================================
// sync-appointments - pull upcoming consult/implant appointments from Sikka
// (the universal PMS middleware) into pms_appointments.
//
// Auth (OAuth 2.0, per-practice): each practice completes the Sikka OAuth flow
// (see sikka-oauth-callback) and stores its own request_key / refresh_token /
// expiry. Before each call we refresh the request_key if it's expired
// (ensureFreshToken). The platform only holds the app credentials SIKKA_APP_ID /
// SIKKA_APP_SECRET - there is no longer a platform-wide SIKKA_API_KEY.
//
// Callers:
//   • pg_cron / admin: Authorization: Bearer <service_role_key>, body
//     { sync_all: true } or { practice_id }.
//   • practice "Sync Now": user JWT (resolves to their own practice).
//
// Appointments endpoint (v4, confirmed): GET {SIKKA_BASE}/appointments with the
//   request_key in a Request-Key header, office_id + startdate/enddate range.
//   Base/paths are env-overridable in _shared/sikka.ts.
// Everything degrades gracefully if Sikka isn't configured or errors.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import {
  ensureFreshToken,
  getAppCreds,
  normalizeTreatment,
  pickTxValue,
  SIKKA_APPOINTMENTS_PATH,
  sikkaGet,
  type SikkaPracticeRow,
  unwrapList,
} from "../_shared/sikka.ts";

const TYPE_RE = /(consult|implant|new patient implant)/i;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const ymd = (d: Date) => d.toISOString().slice(0, 10);

// Best-effort Slack ping (Incoming Webhook). No-op when unconfigured.
async function postSlackInline(text: string) {
  const url = Deno.env.get("SLACK_WEBHOOK_URL");
  if (!url) return;
  try {
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  } catch (e) {
    console.error("Slack post failed:", e);
  }
}

// ---- Sikka adapter ---------------------------------------------------------
// v4 GET /v4/appointments takes a date range (startdate/enddate) and the
// request_key in a Request-Key header (handled in sikkaGet). One ranged call
// covers the whole window. Window is env-configurable (SIKKA_SYNC_DAYS, default 30).
const SYNC_DAYS = Math.max(1, Math.min(60, Number(Deno.env.get("SIKKA_SYNC_DAYS")) || 30));

async function fetchSikkaAppointments(requestKey: string, officeId: string, days: number) {
  const startdate = ymd(new Date());
  const enddate = ymd(new Date(Date.now() + (days - 1) * 86400000));
  const data = await sikkaGet(SIKKA_APPOINTMENTS_PATH, requestKey, { office_id: officeId, startdate, enddate });
  return unwrapList(data, "appointments");
}

// deno-lint-ignore no-explicit-any
function combineDateTime(a: any): string | null {
  if (a.appointment_datetime) return a.appointment_datetime;
  const date = a.appointment_date ?? a.date;
  const time = a.appointment_time ?? a.start_time;
  if (date && typeof time === "string" && /^\d{1,2}:\d{2}/.test(time)) return `${date}T${time.length === 5 ? time : time.slice(0, 5)}:00`;
  if (date) return `${date}T00:00:00`;
  return typeof time === "string" ? time : null;
}

// deno-lint-ignore no-explicit-any
function mapAppt(a: any, practiceId: string) {
  const p = a.patient || {};
  return {
    practice_id: practiceId,
    pms_appointment_id: String(a.sikka_appointment_id ?? a.appointment_sr_no ?? a.id ?? a.appointment_id ?? ""),
    patient_first: p.first_name ?? a.patient_first_name ?? a.firstname ?? null,
    patient_last: p.last_name ?? a.patient_last_name ?? a.lastname ?? null,
    patient_phone: p.mobile_phone ?? p.phone ?? a.patient_phone ?? a.cell ?? null,
    patient_email: p.email ?? a.patient_email ?? a.email ?? null,
    appointment_time: combineDateTime(a),
    appointment_type: a.appointment_type ?? a.type ?? a.description ?? null,
    provider: a.provider?.name ?? a.provider_name ?? a.provider ?? null,
    duration_minutes: a.duration_minutes ?? a.length ?? null,
    is_implant_consult: true,
    // Treatment type + plan value pulled straight from the PMS appointment.
    treatment_type: normalizeTreatment(a.treatment_type ?? a.appointment_type ?? a.type ?? a.description),
    tx_plan_value: pickTxValue(a),
  };
}

// Upsert appointments, retrying without the treatment columns if they don't
// exist yet (so sync keeps working even if this is deployed before the
// treatment-type migration is applied).
// deno-lint-ignore no-explicit-any
async function upsertAppointments(admin: any, rows: any[]) {
  let res = await admin.from("pms_appointments").upsert(rows, { onConflict: "practice_id,pms_appointment_id" });
  if (res.error && /treatment_type|tx_plan_value|column/i.test(res.error.message || "")) {
    // deno-lint-ignore no-explicit-any
    const stripped = rows.map(({ treatment_type, tx_plan_value, ...r }: any) => r);
    res = await admin.from("pms_appointments").upsert(stripped, { onConflict: "practice_id,pms_appointment_id" });
  }
  return res;
}

// deno-lint-ignore no-explicit-any
async function syncOnePractice(admin: any, practice: SikkaPracticeRow) {
  if (!practice.sikka_practice_id) throw new Error("missing_office_id");
  const requestKey = await ensureFreshToken(admin, practice);

  const raw = await fetchSikkaAppointments(requestKey, practice.sikka_practice_id, SYNC_DAYS);
  const rows = (raw as unknown[])
    .map((a) => mapAppt(a, practice.id))
    .filter((r) => r.pms_appointment_id && TYPE_RE.test(r.appointment_type || ""));

  if (rows.length) {
    const { error } = await upsertAppointments(admin, rows);
    if (error) throw error;
  }
  await admin.from("practices").update({ pms_last_synced_at: new Date().toISOString(), sikka_connected: true }).eq("id", practice.id);

  // PMS close-guard + attribution: a treatment/procedure (or completed)
  // appointment means the patient booked/started. Auto-close the matching
  // consult, stop its sequence, determine CaseLift attribution, store the
  // treatment value, log the auditable event, and ping Slack.
  try {
    // deno-lint-ignore no-explicit-any
    const treat = (raw as any[]).filter((a) => /treatment|procedure/i.test(a.appointment_type || a.type || "") || /complete/i.test(a.status || ""));
    if (treat.length) {
      const { data: openConsults } = await admin
        .from("consults")
        .select("id, patient_phone, patient_name")
        .eq("practice_id", practice.id)
        .not("outcome", "in", "(accepted,not_converting,closed_won)");
      const last10 = (s: string) => (s || "").replace(/\D/g, "").slice(-10);
      for (const a of treat) {
        const phone = last10(a.patient?.mobile_phone || a.patient?.phone || a.patient_phone || "");
        if (phone.length < 10) continue;
        // deno-lint-ignore no-explicit-any
        const match = (openConsults || []).find((c: any) => last10(c.patient_phone || "") === phone);
        if (!match) continue;

        // Treatment value from the PMS payload (best-effort across shapes).
        const value = Number(
          a.treatment_value ?? a.production ?? a.amount ?? a.case_value ?? a.treatment_amount ?? 0,
        ) || null;

        // Attribution: did we send a message / did the patient reply before close?
        const { count: sentCount } = await admin
          .from("messages").select("id", { count: "exact", head: true })
          .eq("consult_id", match.id).eq("status", "sent");
        const { data: convs } = await admin.from("conversations").select("id").eq("consult_id", match.id);
        // deno-lint-ignore no-explicit-any
        const convIds = (convs || []).map((c: any) => c.id);
        let replied = false;
        if (convIds.length) {
          const { count: inCount } = await admin
            .from("conversation_messages").select("id", { count: "exact", head: true })
            .eq("direction", "inbound").in("conversation_id", convIds);
          replied = (inCount || 0) > 0;
        }
        const status = replied ? "caselift_recovered" : (sentCount || 0) > 0 ? "caselift_assisted" : "practice_direct";

        // deno-lint-ignore no-explicit-any
        const patch: Record<string, any> = {
          outcome: "closed_won",
          sequence_cancelled_at: new Date().toISOString(),
          sequence_cancelled_reason: "Auto-closed by PMS sync",
          attribution_status: status,
          attribution_confirmed_at: new Date().toISOString(),
          attribution_source: "pms_sync",
          attribution_model: status === "practice_direct" ? "practice_recovered" : "caselift_recovered",
        };
        if (value != null) {
          patch.case_value = value;
          // PMS is authoritative for the treatment-plan value.
          patch.tx_plan_value = value;
          patch.tx_plan_value_source = "pms";
        }
        const tt = normalizeTreatment(a.appointment_type ?? a.type ?? a.description ?? a.treatment_type);
        if (tt) patch.treatment_type = tt;

        const upd = await admin.from("consults").update(patch).eq("id", match.id);
        if (upd.error) {
          // Older schema without the v2 attribution columns: close + value only.
          await admin.from("consults").update({
            outcome: "closed_won",
            sequence_cancelled_at: patch.sequence_cancelled_at,
            sequence_cancelled_reason: patch.sequence_cancelled_reason,
            ...(value != null ? { case_value: value } : {}),
          }).eq("id", match.id);
        }
        await admin.from("messages").update({ status: "cancelled" })
          .eq("consult_id", match.id).in("status", ["draft", "scheduled", "pending"]);

        // Auditable attribution event (no-op if the table isn't present yet).
        await admin.from("attribution_events").insert({
          consult_id: match.id, practice_id: practice.id,
          event_type: "treatment_accepted", source: "pms",
        }).then(() => {}, () => {});

        // HIPAA audit trail.
        await admin.from("audit_logs").insert({
          practice_id: practice.id, action: "consult.treatment_accepted",
          resource_type: "consult", resource_id: match.id,
        }).then(() => {}, () => {});

        // Record an assisted win + Slack win alert (no-op unless a sequence message was sent).
        admin.functions.invoke("record-win", { body: { consult_id: match.id, practice_id: practice.id, source: "pms_webhook" } })
          .then(() => {}, (e: unknown) => console.error("record-win invoke failed:", e));

        // Slack: high-signal "we just closed a case" ping (only when attributed).
        if (status !== "practice_direct") {
          const name = [a.patient?.first_name, a.patient?.last_name].filter(Boolean).join(" ")
            || match.patient_name || "A patient";
          const valStr = value != null ? `$${value.toLocaleString()}` : "value pending";
          await postSlackInline(
            `🟢 Treatment accepted - ${name} - ${valStr} - Attributed to CaseLift (${status === "caselift_recovered" ? "Recovered" : "Assisted"})`,
          );
        }
      }
    }
  } catch (e) {
    console.error("PMS close-guard failed:", e);
  }

  return rows.length;
}

const PRACTICE_COLS = "id, sikka_practice_id, sikka_request_key, sikka_refresh_token, sikka_token_expires_at";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // App credentials must be configured for any OAuth refresh to work.
  try {
    getAppCreds();
  } catch {
    return json({ error: "PMS sync unavailable - Sikka app credentials are not set.", code: "sikka_not_configured" }, 503);
  }

  try {
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json().catch(() => ({}));
    const isService = token && token === SERVICE_KEY;

    // Resolve which practices to sync. Only those that completed OAuth (have a
    // refresh_token) are eligible.
    let practices: SikkaPracticeRow[] = [];
    if (isService && body.sync_all) {
      const { data } = await admin
        .from("practices")
        .select(PRACTICE_COLS)
        .eq("sikka_connected", true)
        .not("sikka_refresh_token", "is", null);
      practices = (data || []) as SikkaPracticeRow[];
    } else {
      let practiceId: string | null = body.practice_id ?? null;
      if (!isService) {
        // Practice-facing "Sync Now": resolve the caller's own practice.
        const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
          global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
        });
        const { data: { user } } = await userClient.auth.getUser();
        if (!user) return json({ error: "Unauthorized" }, 401);
        const { data: prof } = await userClient.from("users").select("practice_id").eq("id", user.id).maybeSingle();
        practiceId = prof?.practice_id ?? null;
      }
      if (!practiceId) return json({ error: "No practice in context." }, 400);
      const { data: pr } = await admin.from("practices").select(PRACTICE_COLS).eq("id", practiceId).maybeSingle();
      if (!pr) return json({ error: "Practice not found." }, 404);
      if (!pr.sikka_refresh_token) return json({ error: "This practice hasn't connected to Sikka yet.", code: "not_linked" }, 409);
      practices = [pr as SikkaPracticeRow];
    }

    let synced = 0;
    const errors: { practice_id: string; error: string }[] = [];
    for (const p of practices) {
      try {
        synced += await syncOnePractice(admin, p);
      } catch (e) {
        const msg = (e as Error)?.message ?? String(e);
        console.error(`sync-appointments: practice ${p.id} failed:`, msg);
        errors.push({ practice_id: p.id, error: msg });
      }
    }

    // Single-practice call that failed → surface a clean error (no crash).
    if (practices.length === 1 && errors.length === 1) {
      const detail = errors[0].error;
      const code = detail === "sikka_not_connected" ? "not_linked" : "sikka_error";
      return json({ error: "PMS sync unavailable - check your Sikka connection.", code, detail }, 502);
    }
    return json({ synced, practices: practices.length, errors });
  } catch (e) {
    await reportEdgeError("sync-appointments", e);
    console.error("sync-appointments error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
