// ============================================================================
// sikka-connect-webhook - the single Sikka webhook receiver. Routes every event
// Sikka sends for a connected office:
//   Data_Refresh                  → trigger sync-appointments for that office
//   appointment(s) [details]      → upsert pms_appointments
//   patient(s) [details]          → upsert pms_patients
//   treatment_plan(s) [details]   → close the matching open consult (closed_won)
//   transaction(s) [details]      → store pms_transactions (reporting)
//   provider(s) [details]         → upsert pms_providers
//   practice(s) [details]         → update the practice record with PMS info
// Falls back to the legacy registration auto-link when the payload looks like a
// practice registration with no recognized event type.
//
// Office linkage: payload office_id (e.g. "D24710") → practices.sikka_practice_id.
// Idempotency: every upsert keys on (practice_id, external_id).
//
// Deploy with verify_jwt = false (Sikka calls this, not a user). Optional
// SIKKA_WEBHOOK_SECRET → required in the X-Sikka-Secret header when set.
// Secret: SUPABASE_SERVICE_ROLE_KEY.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { normalizeTreatment, pickTxValue } from "../_shared/sikka.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const TYPE_RE = /(consult|implant|new patient implant)/i;
const last10 = (s: unknown) => (s ?? "").toString().replace(/\D/g, "").slice(-10);
const str = (v: unknown) => (v == null ? null : String(v).trim() || null);
// First defined value across several candidate keys.
// deno-lint-ignore no-explicit-any
const pick = (o: any, ...keys: string[]) => { for (const k of keys) if (o?.[k] != null && o[k] !== "") return o[k]; return null; };

// Normalize Sikka's event label to a base resource. Handles "appointments
// details", "treatment_plans details", "Data_Refresh", etc.
function normalizeEvent(raw: unknown): string {
  let e = String(raw ?? "").trim().toLowerCase().replace(/\s+/g, "_").replace(/_?details$/, "").replace(/_+$/, "");
  const map: Record<string, string> = {
    appointments: "appointment", patients: "patient", treatment_plans: "treatment_plan",
    transactions: "transaction", providers: "provider", practices: "practice",
  };
  return map[e] ?? e;
}

// deno-lint-ignore no-explicit-any
function recordsFrom(payload: any): any[] {
  const d = payload?.data ?? payload?.records ?? payload?.items ?? payload?.record ?? payload?.payload;
  if (Array.isArray(d)) return d;
  if (Array.isArray(d?.items)) return d.items;
  if (d && typeof d === "object") return [d];
  return [payload]; // flat payload (record fields at top level)
}

// deno-lint-ignore no-explicit-any
async function resolvePractice(admin: any, officeId: string | null) {
  if (!officeId) return null;
  const { data } = await admin.from("practices").select("id, sikka_practice_id").eq("sikka_practice_id", officeId).maybeSingle();
  return data ?? null;
}

// deno-lint-ignore no-explicit-any
function appointmentTime(rec: any): string | null {
  if (rec.appointment_datetime) return rec.appointment_datetime;
  const date = pick(rec, "appointment_date", "date");
  const time = pick(rec, "appointment_time", "start_time", "time");
  if (date && typeof time === "string" && /^\d{1,2}:\d{2}/.test(time)) return `${date}T${time.length === 5 ? time : time.slice(0, 5)}:00`;
  if (date) return `${date}T00:00:00`;
  return typeof time === "string" ? time : null;
}

// ---- per-resource handlers -------------------------------------------------

// deno-lint-ignore no-explicit-any
async function upsertAppointments(admin: any, practiceId: string, recs: any[]) {
  const rows = recs.map((r) => {
    const type = str(pick(r, "appointment_type", "type", "description"));
    return {
      practice_id: practiceId,
      pms_appointment_id: str(pick(r, "appointment_sr_no", "sikka_appointment_id", "appointment_id", "id")),
      patient_first: str(pick(r, "patient_first_name", "firstname", "first_name")),
      patient_last: str(pick(r, "patient_last_name", "lastname", "last_name")),
      patient_phone: str(pick(r, "cell", "mobile_phone", "phone", "patient_phone")),
      patient_email: str(pick(r, "email", "patient_email")),
      appointment_time: appointmentTime(r),
      appointment_type: type,
      provider: str(pick(r, "provider_name", "provider")),
      duration_minutes: pick(r, "duration_minutes", "length") ? Number(pick(r, "duration_minutes", "length")) : null,
      is_implant_consult: TYPE_RE.test(type || ""),
      // Treatment type + plan value pulled straight from the PMS appointment.
      treatment_type: normalizeTreatment(pick(r, "treatment_type", "appointment_type", "type", "description")),
      tx_plan_value: pickTxValue(r),
    };
  }).filter((row) => row.pms_appointment_id);
  if (!rows.length) return 0;
  // Retry without the treatment columns if they don't exist yet (pre-migration).
  let res = await admin.from("pms_appointments").upsert(rows, { onConflict: "practice_id,pms_appointment_id" });
  if (res.error && /treatment_type|tx_plan_value|column/i.test(res.error.message || "")) {
    // deno-lint-ignore no-explicit-any
    const stripped = rows.map(({ treatment_type, tx_plan_value, ...row }: any) => row);
    res = await admin.from("pms_appointments").upsert(stripped, { onConflict: "practice_id,pms_appointment_id" });
  }
  if (res.error) throw res.error;
  return rows.length;
}

// deno-lint-ignore no-explicit-any
async function upsertPatients(admin: any, practiceId: string, officeId: string, recs: any[]) {
  const rows = recs.map((r) => ({
    practice_id: practiceId,
    office_id: officeId,
    external_id: str(pick(r, "patient_id", "patient_sr_no", "external_id", "id")),
    first_name: str(pick(r, "firstname", "first_name")),
    last_name: str(pick(r, "lastname", "last_name")),
    phone: str(pick(r, "cell", "mobile_phone", "phone", "home_phone")),
    email: str(pick(r, "email")),
    date_of_birth: str(pick(r, "date_of_birth", "dob", "birthdate")),
    raw: r,
    updated_at: new Date().toISOString(),
  })).filter((row) => row.external_id);
  if (!rows.length) return 0;
  const { error } = await admin.from("pms_patients").upsert(rows, { onConflict: "practice_id,external_id" });
  if (error) throw error;
  return rows.length;
}

// deno-lint-ignore no-explicit-any
async function upsertProviders(admin: any, practiceId: string, officeId: string, recs: any[]) {
  const rows = recs.map((r) => {
    const first = str(pick(r, "firstname", "first_name"));
    const last = str(pick(r, "lastname", "last_name"));
    return {
      practice_id: practiceId,
      office_id: officeId,
      external_id: str(pick(r, "provider_id", "provider_sr_no", "external_id", "id")),
      name: str(pick(r, "provider_name", "name")) ?? ([first, last].filter(Boolean).join(" ") || null),
      first_name: first,
      last_name: last,
      specialty: str(pick(r, "specialty", "provider_specialty")),
      raw: r,
      updated_at: new Date().toISOString(),
    };
  }).filter((row) => row.external_id);
  if (!rows.length) return 0;
  const { error } = await admin.from("pms_providers").upsert(rows, { onConflict: "practice_id,external_id" });
  if (error) throw error;
  return rows.length;
}

// deno-lint-ignore no-explicit-any
async function storeTransactions(admin: any, practiceId: string, officeId: string, recs: any[]) {
  const rows = recs.map((r) => ({
    practice_id: practiceId,
    office_id: officeId,
    external_id: str(pick(r, "transaction_id", "transaction_sr_no", "external_id", "id")),
    patient_external_id: str(pick(r, "patient_id", "patient_sr_no")),
    amount: pick(r, "amount", "transaction_amount", "production", "charge") != null
      ? Number(pick(r, "amount", "transaction_amount", "production", "charge")) : null,
    transaction_date: str(pick(r, "transaction_date", "date")),
    transaction_type: str(pick(r, "transaction_type", "type", "code")),
    description: str(pick(r, "description", "procedure_description")),
    raw: r,
  })).filter((row) => row.external_id);
  if (!rows.length) return 0;
  const { error } = await admin.from("pms_transactions").upsert(rows, { onConflict: "practice_id,external_id" });
  if (error) throw error;
  return rows.length;
}

// Treatment plan accepted → close the matching open consult and stop its sequence.
// deno-lint-ignore no-explicit-any
async function closeConsultsForTreatmentPlans(admin: any, practiceId: string, recs: any[]) {
  // Pull open consults once.
  const { data: open } = await admin.from("consults")
    .select("id, patient_phone, patient_name")
    .eq("practice_id", practiceId)
    .not("outcome", "in", "(accepted,not_converting,closed_won)");
  if (!open?.length) return 0;

  let closed = 0;
  for (const r of recs) {
    // Find the patient's phone: from the record, else via the synced pms_patients row.
    let phone = last10(pick(r, "cell", "mobile_phone", "phone", "patient_phone"));
    const patientExt = str(pick(r, "patient_id", "patient_sr_no"));
    if (phone.length < 10 && patientExt) {
      const { data: pat } = await admin.from("pms_patients").select("phone")
        .eq("practice_id", practiceId).eq("external_id", patientExt).maybeSingle();
      phone = last10(pat?.phone);
    }
    if (phone.length < 10) continue;
    // deno-lint-ignore no-explicit-any
    const match = (open as any[]).find((c) => last10(c.patient_phone) === phone);
    if (!match) continue;

    const value = pickTxValue(r);
    const treatment = normalizeTreatment(pick(r, "treatment_type", "procedure_description", "description", "type"));

    // Attribution (mirrors the PMS close-guard in sync-appointments).
    const { count: sentCount } = await admin.from("messages")
      .select("id", { count: "exact", head: true }).eq("consult_id", match.id).eq("status", "sent");
    const { data: convs } = await admin.from("conversations").select("id").eq("consult_id", match.id);
    // deno-lint-ignore no-explicit-any
    const convIds = (convs || []).map((c: any) => c.id);
    let replied = false;
    if (convIds.length) {
      const { count: inCount } = await admin.from("conversation_messages")
        .select("id", { count: "exact", head: true }).eq("direction", "inbound").in("conversation_id", convIds);
      replied = (inCount || 0) > 0;
    }
    const status = replied ? "consultiq_recovered" : (sentCount || 0) > 0 ? "consultiq_assisted" : "practice_direct";

    // deno-lint-ignore no-explicit-any
    const patch: Record<string, any> = {
      outcome: "closed_won",
      sequence_cancelled_at: new Date().toISOString(),
      sequence_cancelled_reason: "Treatment plan accepted (PMS webhook)",
      attribution_status: status,
      attribution_confirmed_at: new Date().toISOString(),
      attribution_source: "pms_webhook",
      attribution_model: status === "practice_direct" ? "practice_recovered" : "consultiq_recovered",
    };
    if (value != null) {
      patch.case_value = value;
      // PMS treatment plan is authoritative for the treatment-plan value.
      patch.tx_plan_value = value;
      patch.tx_plan_value_source = "pms";
    }
    if (treatment) patch.treatment_type = treatment;

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
    await admin.from("audit_logs").insert({
      practice_id: practiceId, action: "consult.treatment_accepted",
      resource_type: "consult", resource_id: match.id,
    }).then(() => {}, () => {});
    closed++;
  }
  return closed;
}

// deno-lint-ignore no-explicit-any
async function updatePracticeInfo(admin: any, practiceId: string, recs: any[]) {
  const r = recs[0] || {};
  // deno-lint-ignore no-explicit-any
  const patch: Record<string, any> = { sikka_connected: true, pms_last_synced_at: new Date().toISOString() };
  const pmsType = str(pick(r, "pms_type", "practice_management_system", "software", "pms", "pms_name"));
  if (pmsType) patch.pms_type = pmsType;
  await admin.from("practices").update(patch).eq("id", practiceId);
  return 1;
}

// Legacy: practice registration auto-link (no recognized data event).
// deno-lint-ignore no-explicit-any
async function legacyRegister(admin: any, payload: any) {
  const sikkaPracticeId = str(pick(payload, "sikka_practice_id", "practice_id", "office_id", "id"));
  const practiceName = str(pick(payload, "practice_name", "name")) ?? "";
  const npi = str(payload.npi) ?? "";
  if (!sikkaPracticeId) return json({ error: "Missing sikka_practice_id" }, 400);

  const { data: existing } = await admin.from("practices").select("id").eq("sikka_practice_id", sikkaPracticeId).maybeSingle();
  if (existing) {
    await admin.from("practices").update({ sikka_connected: true }).eq("id", existing.id);
    return json({ ok: true, linked: true, practice_id: existing.id, already_linked: true });
  }
  let match: { id: string } | null = null;
  if (npi) { const { data } = await admin.from("practices").select("id").eq("npi", npi).maybeSingle(); match = data ?? null; }
  if (!match && practiceName) {
    const { data } = await admin.from("practices").select("id, name").ilike("name", `%${practiceName}%`).limit(2);
    if (data && data.length === 1) match = { id: data[0].id };
  }
  if (match) {
    await admin.from("practices").update({ sikka_practice_id: sikkaPracticeId, sikka_connected: true }).eq("id", match.id);
    await admin.from("sikka_registrations").insert({ sikka_practice_id: sikkaPracticeId, practice_name: practiceName, npi: npi || null, raw: payload, matched_practice_id: match.id, status: "linked" });
    return json({ ok: true, linked: true, practice_id: match.id });
  }
  await admin.from("sikka_registrations").insert({ sikka_practice_id: sikkaPracticeId, practice_name: practiceName, npi: npi || null, raw: payload, status: "unlinked" });
  return json({ ok: true, linked: false, reason: "no confident match - logged for admin review" });
}

const KNOWN = new Set(["data_refresh", "appointment", "patient", "treatment_plan", "transaction", "provider", "practice"]);

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const secret = Deno.env.get("SIKKA_WEBHOOK_SECRET");
  if (secret && req.headers.get("X-Sikka-Secret") !== secret) return json({ error: "Invalid secret" }, 401);

  try {
    const payload = await req.json().catch(() => ({}));
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const event = normalizeEvent(
      pick(payload, "event_type", "event", "type", "action", "resource") ?? req.headers.get("X-Sikka-Event"),
    );

    // Not a recognized data event → treat as a registration payload (legacy).
    if (!KNOWN.has(event)) return await legacyRegister(admin, payload);

    const officeId = str(pick(payload, "office_id", "officeid", "office") ?? pick(payload.data || {}, "office_id"))
      ?? str(pick(recordsFrom(payload)[0] || {}, "office_id"));
    const practice = await resolvePractice(admin, officeId);
    if (!practice) {
      // Unknown office → ack so Sikka doesn't retry; log for visibility.
      console.warn(`sikka webhook: no practice for office_id=${officeId} event=${event}`);
      return json({ ok: true, event, handled: false, reason: "office_id not linked to a practice" });
    }

    const recs = recordsFrom(payload);
    let result: Record<string, unknown> = { ok: true, event, practice_id: practice.id };

    switch (event) {
      case "data_refresh":
        // Fire the full sync for this office (service-role invoke → isService path).
        admin.functions.invoke("sync-appointments", { body: { practice_id: practice.id } }).then(() => {}, (e: unknown) => console.error("data_refresh sync invoke failed:", e));
        result.triggered = "sync-appointments";
        break;
      case "appointment":
        result.upserted = await upsertAppointments(admin, practice.id, recs);
        break;
      case "patient":
        result.upserted = await upsertPatients(admin, practice.id, officeId!, recs);
        break;
      case "provider":
        result.upserted = await upsertProviders(admin, practice.id, officeId!, recs);
        break;
      case "transaction":
        result.stored = await storeTransactions(admin, practice.id, officeId!, recs);
        break;
      case "treatment_plan":
        result.closed = await closeConsultsForTreatmentPlans(admin, practice.id, recs);
        break;
      case "practice":
        await updatePracticeInfo(admin, practice.id, recs);
        result.updated = true;
        break;
    }
    return json(result);
  } catch (e) {
    console.error("sikka-connect-webhook error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
