import { reportEdgeError } from "../_shared/report-error.ts";
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
import {
  isSyncApproved,
  jitUpsertPatientsFromAppointments,
  mapAppointmentRow,
  matchesSyncRules,
  upsertAppointments,
  enrichAppointmentBatch,
  PRACTICE_SYNC_COLS,
  type PmsSyncRules,
} from "../_shared/pms-sync.ts";
import { ensureFreshToken } from "../_shared/sikka.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

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
  const { data } = await admin.from("practices").select(
    "id, sikka_practice_id, sikka_request_key, sikka_refresh_token, sikka_token_expires_at, pms_sync_approved_at, pms_sync_rules, pms_sync_status",
  ).eq("sikka_practice_id", officeId).maybeSingle();
  return data ?? null;
}

// deno-lint-ignore no-explicit-any
function appointmentTime(rec: any): string | null {
  if (rec.appointment_datetime) {
    const dt = String(rec.appointment_datetime).trim();
    if (/^\d{4}-\d{2}-\d{2}T/.test(dt)) return dt.slice(0, 19);
  }
  const dateRaw = pick(rec, "appointment_date", "date");
  const dateOnly = String(dateRaw ?? "").trim().match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  const time = pick(rec, "appointment_time", "start_time", "time");
  if (dateOnly && typeof time === "string" && /^\d{1,2}:\d{2}/.test(time.trim())) {
    const t = time.trim();
    const hhmm = t.length === 5 ? t : t.slice(0, 5);
    return `${dateOnly}T${hhmm}:00`;
  }
  if (dateOnly) return `${dateOnly}T00:00:00`;
  if (dateRaw && /T/.test(String(dateRaw))) return String(dateRaw).trim().slice(0, 19);
  return typeof time === "string" ? time : null;
}

// ---- per-resource handlers -------------------------------------------------

// deno-lint-ignore no-explicit-any
async function upsertAppointmentsFiltered(
  admin: any,
  practice: { id: string; sikka_practice_id?: string | null; pms_sync_approved_at?: string | null; pms_sync_rules?: PmsSyncRules | null; pms_sync_status?: string | null },
  recs: any[],
) {
  if (!isSyncApproved(practice)) return 0;
  const rules = practice.pms_sync_rules;
  if (!rules?.clusters?.length) return 0;

  const matched: any[] = [];
  const rows = [];
  for (const r of recs) {
    const { match, ruleId } = matchesSyncRules(rules, r);
    if (!match) continue;
    const row = mapAppointmentRow(r, practice.id, ruleId, rules);
    if (!row.pms_appointment_id) continue;
    rows.push(row);
    matched.push(r);
  }
  if (!rows.length) return 0;
  if (practice.sikka_practice_id) {
    try {
      const requestKey = await ensureFreshToken(admin, practice);
      const { patientMap } = await enrichAppointmentBatch(requestKey, practice.sikka_practice_id, rows, matched);
      await upsertAppointments(admin, rows);
      await jitUpsertPatientsFromAppointments(admin, practice.id, practice.sikka_practice_id, matched, patientMap);
      return rows.length;
    } catch (e) {
      console.warn("webhook appointment enrich failed, storing basic rows:", (e as Error)?.message);
    }
  }
  await upsertAppointments(admin, rows);
  if (practice.sikka_practice_id) {
    await jitUpsertPatientsFromAppointments(admin, practice.id, practice.sikka_practice_id, matched);
  }
  return rows.length;
}

// deno-lint-ignore no-explicit-any
async function upsertPatients(admin: any, practiceId: string, officeId: string, recs: any[]) {
  const rows = recs.map((r) => {
    const fromParts = {
      first: str(pick(r, "firstname", "first_name")),
      last: str(pick(r, "lastname", "last_name")),
    };
    const split = !fromParts.first && !fromParts.last
      ? (() => {
          const s = String(pick(r, "patient_name", "name") ?? "").trim();
          if (!s) return { first: null, last: null };
          const parts = s.split(/\s+/);
          return parts.length === 1
            ? { first: parts[0], last: null }
            : { first: parts[0], last: parts.slice(1).join(" ") };
        })()
      : fromParts;
    return {
      practice_id: practiceId,
      office_id: officeId,
      external_id: str(pick(r, "patient_id", "patient_sr_no", "external_id", "id")),
      first_name: split.first,
      last_name: split.last,
      phone: str(pick(r, "cell", "mobile_phone", "phone", "home_phone")),
      email: str(pick(r, "email")),
      date_of_birth: str(pick(r, "birthdate", "date_of_birth", "dob")),
      raw: r,
      updated_at: new Date().toISOString(),
    };
  }).filter((row) => row.external_id);
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
    const status = replied ? "caselift_recovered" : (sentCount || 0) > 0 ? "caselift_assisted" : "practice_direct";

    // deno-lint-ignore no-explicit-any
    const patch: Record<string, any> = {
      outcome: "closed_won",
      sequence_cancelled_at: new Date().toISOString(),
      sequence_cancelled_reason: "Treatment plan accepted (PMS webhook)",
      attribution_status: status,
      attribution_confirmed_at: new Date().toISOString(),
      attribution_source: "pms_webhook",
      attribution_model: status === "practice_direct" ? "practice_recovered" : "caselift_recovered",
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
    // Record an assisted win + Slack alert (no-op unless a sequence message was sent).
    admin.functions.invoke("record-win", { body: { consult_id: match.id, practice_id: practiceId, source: "pms_webhook" } })
      .then(() => {}, (e: unknown) => console.error("record-win invoke failed:", e));
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

// Registration / connect payload from Sikka (SPU sync complete). Store only —
// the practice claims their office_id on Settings → PMS (link-sikka-practice).
// deno-lint-ignore no-explicit-any
async function legacyRegister(admin: any, payload: any) {
  const sikkaPracticeId = str(pick(payload, "sikka_practice_id", "practice_id", "office_id", "id"));
  const practiceName = str(pick(payload, "practice_name", "name")) ?? "";
  const npi = str(payload.npi) ?? "";
  if (!sikkaPracticeId) return json({ error: "Missing sikka_practice_id" }, 400);

  // Already claimed by a CaseLift practice — refresh connected flag only.
  const { data: existing } = await admin.from("practices").select("id").eq("sikka_practice_id", sikkaPracticeId).maybeSingle();
  if (existing) {
    await admin.from("practices").update({ sikka_connected: true }).eq("id", existing.id);
    return json({ ok: true, stored: true, sikka_practice_id: sikkaPracticeId, already_linked: true, practice_id: existing.id });
  }

  const row = {
    sikka_practice_id: sikkaPracticeId,
    practice_name: practiceName || null,
    npi: npi || null,
    raw: payload,
    status: "pending",
    matched_practice_id: null,
  };

  const { data: openReg } = await admin
    .from("sikka_registrations")
    .select("id")
    .eq("sikka_practice_id", sikkaPracticeId)
    .in("status", ["pending", "unlinked"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (openReg?.id) {
    await admin.from("sikka_registrations").update(row).eq("id", openReg.id);
    return json({ ok: true, stored: true, sikka_practice_id: sikkaPracticeId, updated: true });
  }

  await admin.from("sikka_registrations").insert(row);
  return json({ ok: true, stored: true, sikka_practice_id: sikkaPracticeId });
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
        result.upserted = await upsertAppointmentsFiltered(admin, practice, recs);
        break;
      case "patient":
        // Patients are JIT-synced from matched consult appointments only.
        result.upserted = 0;
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
    await reportEdgeError("sikka-connect-webhook", e);
    console.error("sikka-connect-webhook error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
