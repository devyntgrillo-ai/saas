// Shared PMS consult sync: date-range chunking, clustering, AI classification,
// rule matching, and appointment row mapping.
import {
  ensureFreshToken,
  normalizeTreatment,
  pickTxValue,
  SIKKA_APPOINTMENTS_PATH,
  sikkaGet,
  unwrapList,
  type SikkaPracticeRow,
} from "./sikka.ts";
import { isSuperAdminUser } from "./admin.ts";

export type AiClassification = "likely_consult" | "likely_routine" | "unknown";
export type PmsSyncStatus = "draft" | "pending_approval" | "approved" | "syncing" | "active";

export interface PmsSyncCluster {
  id: string;
  label: string;
  appointment_type: string;
  procedure_codes: string[];
  count: number;
  ai_classification: AiClassification;
  ai_reason: string;
  included: boolean;
  samples: { date: string | null; patient: string; description: string }[];
}

export interface PmsSyncRules {
  version: 1;
  discovered_at: string;
  history_years: number;
  forward_years: number;
  total_scanned: number;
  matched_count: number;
  excluded_count: number;
  clusters: PmsSyncCluster[];
  ai_used: boolean;
}

export interface PmsSyncPracticeRow extends SikkaPracticeRow {
  pms_history_years?: number | null;
  pms_forward_years?: number | null;
  pms_sync_approved_at?: string | null;
  pms_sync_rules?: PmsSyncRules | null;
  pms_sync_status?: PmsSyncStatus | null;
  sikka_connected?: boolean | null;
}

export const PRACTICE_SYNC_COLS =
  "id, sikka_practice_id, sikka_request_key, sikka_refresh_token, sikka_token_expires_at, sikka_connected, pms_history_years, pms_forward_years, pms_sync_approved_at, pms_sync_rules, pms_sync_status";

const ROUTINE_RE = /(prophy|cleaning|hygiene|recall|exam only|perio maintenance|blocked|lunch|admin|staff meeting|holiday|closed)/i;
const CONSULT_RE = /(consult|implant|new patient|case presentation|treatment presentation|comp exam|comprehensive exam)/i;
const ROUTINE_CODES = new Set(["D0120", "D0150", "D1110", "D1120", "D4910", "D1206", "D1208"]);

const CDT_LABELS: Record<string, string> = {
  D9310: "Consultation",
  D0140: "Limited Oral Evaluation",
  D0150: "Comprehensive Oral Evaluation",
  D0180: "Periodontal Evaluation",
  D1110: "Prophylaxis (Cleaning)",
  D1120: "Child Prophylaxis",
  D0210: "Full Mouth X-Rays",
  D0220: "Periapical X-Ray",
  D0274: "Bitewing X-Rays",
  D4910: "Periodontal Maintenance",
};

const CONSULT_LABEL_RULES: [RegExp, string][] = [
  [/implant/i, "Implant Consult"],
  [/invisalign|aligner|ortho/i, "Invisalign Consult"],
  [/veneer|cosmetic|smile/i, "Cosmetic Consult"],
  [/sleep|apnea|cpap/i, "Sleep Apnea Consult"],
  [/new patient/i, "New Patient Consult"],
  [/consult/i, "Consultation"],
];

function cdtLabel(code: string): string | null {
  return CDT_LABELS[code.toUpperCase().trim()] ?? null;
}

function isCodeOnlyLabel(s: string): boolean {
  const t = s.trim();
  return /^procedure\s+d\d{4}$/i.test(t) || /^d\d{4}$/i.test(t) ||
    /^[A-Z0-9]{3,8}(,\s*[A-Z0-9]{3,8})+$/i.test(t);
}

function inferConsultLabel(blob: string): string | null {
  for (const [re, label] of CONSULT_LABEL_RULES) {
    if (re.test(blob)) return label;
  }
  return null;
}

function clusterDisplayLabel(cluster: PmsSyncCluster | undefined): string | null {
  if (!cluster) return null;
  const label = (cluster.label || "").trim();
  if (label && !isCodeOnlyLabel(label) && /[a-z]/i.test(label)) return label;
  for (const code of cluster.procedure_codes || []) {
    const mapped = cdtLabel(code);
    if (mapped) return mapped;
  }
  return inferConsultLabel(`${label} ${cluster.ai_reason || ""}`);
}

/** Human-readable appointment type for schedule UI (not raw procedure codes). */
export function resolveAppointmentTypeLabel(
  a: Record<string, unknown>,
  matchRuleId?: string | null,
  rules?: PmsSyncRules | null,
): string {
  const textFields = [
    pick(a, "appointment_type", "type", "description", "reason", "note", "notes", "appointment_description"),
    pick(a, "procedure_description", "procedure_code1_description"),
  ].filter(Boolean).map(String);

  for (const t of textFields) {
    const s = t.trim();
    if (s.length > 3 && !isCodeOnlyLabel(s)) {
      return inferConsultLabel(s) || s;
    }
  }

  const fromCluster = clusterDisplayLabel(rules?.clusters?.find((c) => c.id === matchRuleId));
  if (fromCluster) return fromCluster;

  const codes = procedureCodes(a);
  for (const code of codes) {
    const mapped = cdtLabel(code);
    if (mapped) return mapped;
  }

  const blob = textFields.join(" ");
  const inferred = inferConsultLabel(blob);
  if (inferred) return inferred;

  if (codes[0]) return cdtLabel(codes[0]) || codes[0];
  return "Consult";
}

export const ymd = (d: Date) => d.toISOString().slice(0, 10);

export function clampYears(n: unknown, fallback = 1): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(1, Math.min(5, Math.round(v)));
}

export function syncWindow(historyYears: number, forwardYears: number): { start: Date; end: Date } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setFullYear(start.getFullYear() - clampYears(historyYears));
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  end.setFullYear(end.getFullYear() + clampYears(forwardYears));
  return { start, end };
}

/** Sikka allows ~1 year per appointments request, chunk the full window. */
export function dateRangeChunks(start: Date, end: Date): { startdate: string; enddate: string }[] {
  const chunks: { startdate: string; enddate: string }[] = [];
  let cur = new Date(start);
  while (cur <= end) {
    const chunkEnd = new Date(cur);
    chunkEnd.setFullYear(chunkEnd.getFullYear() + 1);
    chunkEnd.setDate(chunkEnd.getDate() - 1);
    const useEnd = chunkEnd > end ? end : chunkEnd;
    chunks.push({ startdate: ymd(cur), enddate: ymd(useEnd) });
    cur = new Date(useEnd);
    cur.setDate(cur.getDate() + 1);
  }
  return chunks;
}

// deno-lint-ignore no-explicit-any
const pick = (o: any, ...keys: string[]) => {
  for (const k of keys) if (o?.[k] != null && o[k] !== "") return o[k];
  return null;
};

/** Sikka OpenDental often sends a single `patient_name` string, not first/last. */
function splitPatientName(name: unknown): { first: string | null; last: string | null } {
  const s = String(name ?? "").trim();
  if (!s) return { first: null, last: null };
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function patientNamesFromAppt(a: Record<string, unknown>, p: Record<string, unknown>) {
  const fromParts = {
    first: pick(p, "first_name", "firstname") ?? pick(a, "patient_first_name", "firstname", "first_name"),
    last: pick(p, "last_name", "lastname") ?? pick(a, "patient_last_name", "lastname", "last_name"),
  };
  if (fromParts.first || fromParts.last) {
    return { first: fromParts.first ? String(fromParts.first) : null, last: fromParts.last ? String(fromParts.last) : null };
  }
  const split = splitPatientName(pick(a, "patient_name", "patient", "guarantor_name"));
  return { first: split.first, last: split.last };
}

/** OpenDental appointments omit phone/email; provider is usually provider_id only. */
function contactFromPatientRecord(p: Record<string, unknown>) {
  return {
    phone: pick(p, "cell", "mobile_phone", "phone", "home_phone"),
    email: pick(p, "email"),
  };
}

function providerLabelFromAppt(a: Record<string, unknown>, providerMap?: Map<string, string>): string | null {
  const provId = String(pick(a, "provider_id", "provider_sr_no") ?? "").trim();
  if (provId && providerMap?.has(provId)) return providerMap.get(provId) ?? null;
  const nested = (a.provider as Record<string, unknown>) || {};
  const name = pick(nested, "name") ?? pick(a, "provider_name", "provider");
  if (name) return String(name);
  return provId || null;
}

/** Load Sikka providers for office_id → display name. */
export async function fetchSikkaProviderMap(requestKey: string, officeId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const data = await sikkaGet("/providers", requestKey, { office_id: officeId, limit: "500" });
  for (const p of unwrapList(data, "providers")) {
    const id = String(pick(p, "provider_id", "provider_sr_no", "id") ?? "").trim();
    if (!id) continue;
    const name = [pick(p, "firstname", "first_name"), pick(p, "lastname", "last_name")]
      .filter(Boolean).join(" ").trim() || String(pick(p, "name", "provider_name") ?? "").trim();
    map.set(id, name || id);
  }
  return map;
}

/** Fetch patient contact/name fields for the given Sikka patient_ids (paginated list scan). */
export async function fetchSikkaPatientMap(
  requestKey: string,
  officeId: string,
  neededIds: Set<string>,
): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  if (!neededIds.size) return map;
  let offset = 0;
  const limit = 500;
  while (map.size < neededIds.size) {
    const data = await sikkaGet("/patients", requestKey, {
      office_id: officeId,
      offset: String(offset),
      limit: String(limit),
      fields: "patient_id,firstname,lastname,cell,email,phone,home_phone",
    });
    const items = unwrapList(data, "patients");
    if (!items.length) break;
    for (const p of items) {
      const id = String(pick(p, "patient_id", "patient_sr_no", "id") ?? "").trim();
      if (neededIds.has(id)) map.set(id, p as Record<string, unknown>);
    }
    if (items.length < limit) break;
    offset += 1;
  }
  return map;
}

/** Enrich mapped appointment rows with Sikka patients + providers APIs. */
// deno-lint-ignore no-explicit-any
export function applySikkaEnrichment(
  rows: Record<string, unknown>[],
  rawAppts: any[],
  providerMap: Map<string, string>,
  patientMap: Map<string, Record<string, unknown>>,
) {
  for (let i = 0; i < rows.length; i++) {
    const a = rawAppts[i] as Record<string, unknown>;
    const row = rows[i];
    const pid = String(pick(a, "patient_id", "patient_sr_no") ?? "").trim();
    const patient = pid ? patientMap.get(pid) : undefined;
    if (patient) {
      const names = patientNamesFromAppt(a, patient);
      if (names.first) row.patient_first = names.first;
      if (names.last) row.patient_last = names.last;
      const contact = contactFromPatientRecord(patient);
      if (contact.phone) row.patient_phone = contact.phone;
      if (contact.email) row.patient_email = contact.email;
    }
    row.provider = providerLabelFromAppt(a, providerMap);
  }
}

export async function enrichAppointmentBatch(
  requestKey: string,
  officeId: string,
  rows: Record<string, unknown>[],
  // deno-lint-ignore no-explicit-any
  rawAppts: any[],
) {
  const patientIds = new Set<string>();
  for (const a of rawAppts) {
    const id = String(pick(a, "patient_id", "patient_sr_no") ?? "").trim();
    if (id) patientIds.add(id);
  }
  const [providerMap, patientMap] = await Promise.all([
    fetchSikkaProviderMap(requestKey, officeId),
    fetchSikkaPatientMap(requestKey, officeId, patientIds),
  ]);
  applySikkaEnrichment(rows, rawAppts, providerMap, patientMap);
  return { providerMap, patientMap };
}

function normType(s: unknown): string {
  return String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function procedureCodes(a: Record<string, unknown>): string[] {
  const codes = [
    pick(a, "procedure_code1", "procedure_code_1", "proc_code1"),
    pick(a, "procedure_code2", "procedure_code_2", "proc_code2"),
    pick(a, "procedure_code3", "procedure_code_3", "proc_code3"),
    pick(a, "procedure_code", "code"),
  ].filter(Boolean).map((c) => String(c).toUpperCase().trim());
  return [...new Set(codes)];
}

export function extractApptFields(a: Record<string, unknown>) {
  const p = (a.patient as Record<string, unknown>) || {};
  const typeRaw = pick(a, "appointment_type", "type", "description") ?? "";
  const codes = procedureCodes(a);
  const type = normType(typeRaw) || (codes[0] ? `code:${codes[0].toLowerCase()}` : "unknown");
  const patientName = [
    pick(p, "first_name", "firstname") ?? pick(a, "patient_first_name", "firstname"),
    pick(p, "last_name", "lastname") ?? pick(a, "patient_last_name", "lastname"),
  ].filter(Boolean).join(" ").trim() || String(pick(a, "patient_name", "patient") ?? "").trim();
  return {
    appointment_type: type,
    type_label: String(typeRaw || codes.join(", ") || "Unknown").trim(),
    procedure_codes: codes,
    description: String(pick(a, "description", "note", "notes") ?? typeRaw ?? "").trim(),
    patient_name: patientName,
    appointment_date: String(pick(a, "appointment_date", "date") ?? "").slice(0, 10) || null,
  };
}

function clusterKey(fields: ReturnType<typeof extractApptFields>): string {
  const code = fields.procedure_codes[0] || "none";
  return `type:${fields.appointment_type}|code:${code}`;
}

function clusterLabel(fields: ReturnType<typeof extractApptFields>): string {
  if (fields.type_label && fields.type_label.toLowerCase() !== "unknown") return fields.type_label;
  if (fields.procedure_codes.length) return fields.procedure_codes.join(", ");
  return fields.appointment_type;
}

export function heuristicClassify(fields: ReturnType<typeof extractApptFields>): { classification: AiClassification; reason: string } {
  const blob = `${fields.appointment_type} ${fields.type_label} ${fields.description} ${fields.procedure_codes.join(" ")}`;
  if (ROUTINE_RE.test(blob) || fields.procedure_codes.some((c) => ROUTINE_CODES.has(c))) {
    return { classification: "likely_routine", reason: "Matches routine/hygiene/admin heuristics." };
  }
  if (CONSULT_RE.test(blob)) {
    return { classification: "likely_consult", reason: "Matches consult/implant heuristics." };
  }
  return { classification: "unknown", reason: "No strong heuristic match." };
}

// deno-lint-ignore no-explicit-any
export function clusterAppointments(raw: any[]): Map<string, PmsSyncCluster> {
  const map = new Map<string, PmsSyncCluster>();
  for (const a of raw) {
    const fields = extractApptFields(a as Record<string, unknown>);
    const key = clusterKey(fields);
    let c = map.get(key);
    if (!c) {
      const h = heuristicClassify(fields);
      c = {
        id: key,
        label: clusterLabel(fields),
        appointment_type: fields.appointment_type,
        procedure_codes: [...fields.procedure_codes],
        count: 0,
        ai_classification: h.classification,
        ai_reason: h.reason,
        included: h.classification === "likely_consult",
        samples: [],
      };
      map.set(key, c);
    }
    c.count++;
    for (const code of fields.procedure_codes) {
      if (!c.procedure_codes.includes(code)) c.procedure_codes.push(code);
    }
    if (c.samples.length < 3) {
      c.samples.push({
        date: fields.appointment_date,
        patient: fields.patient_name || ", ",
        description: fields.description || fields.type_label,
      });
    }
  }
  return map;
}

const AI_PROMPT = (clusters: PmsSyncCluster[]) => `You classify dental PMS appointment type clusters for a consult-recording platform.

For each cluster, decide:
- likely_consult: new patient exams, implant consults, case presentations, treatment consultations
- likely_routine: cleanings, prophies, perio maintenance, recall exams, blocked slots, admin time
- unknown: unclear

Return ONLY valid JSON (no markdown):
{"clusters":[{"id":"<cluster id>","classification":"likely_consult|likely_routine|unknown","reason":"<short reason>","included":true|false}]}

Default included=true only for likely_consult. Default included=false for likely_routine and unknown.

Clusters:
${JSON.stringify(clusters.map((c) => ({
  id: c.id,
  label: c.label,
  appointment_type: c.appointment_type,
  procedure_codes: c.procedure_codes,
  count: c.count,
  samples: c.samples,
})), null, 2)}`;

export async function classifyClustersWithAI(clusters: PmsSyncCluster[]): Promise<PmsSyncCluster[]> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const sorted = [...clusters].sort((a, b) => b.count - a.count).slice(0, 80);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      messages: [{ role: "user", content: AI_PROMPT(sorted) }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic_${res.status}: ${(await res.text()).slice(0, 300)}`);

  const data = await res.json();
  const text = (data.content || []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("AI response did not contain JSON");

  const parsed = JSON.parse(jsonMatch[0]) as { clusters?: { id: string; classification: AiClassification; reason: string; included?: boolean }[] };
  const byId = new Map((parsed.clusters || []).map((c) => [c.id, c]));

  return clusters.map((c) => {
    const ai = byId.get(c.id);
    if (!ai) return c;
    return {
      ...c,
      ai_classification: ai.classification,
      ai_reason: ai.reason,
      included: ai.included ?? ai.classification === "likely_consult",
    };
  });
}

export function buildRules(
  clusters: PmsSyncCluster[],
  totalScanned: number,
  historyYears: number,
  forwardYears: number,
  aiUsed: boolean,
): PmsSyncRules {
  const matched = clusters.filter((c) => c.included).reduce((s, c) => s + c.count, 0);
  return {
    version: 1,
    discovered_at: new Date().toISOString(),
    history_years: clampYears(historyYears),
    forward_years: clampYears(forwardYears),
    total_scanned: totalScanned,
    matched_count: matched,
    excluded_count: totalScanned - matched,
    clusters,
    ai_used: aiUsed,
  };
}

export function isSyncApproved(practice: PmsSyncPracticeRow): boolean {
  return Boolean(practice.pms_sync_approved_at) &&
    (practice.pms_sync_status === "active" || practice.pms_sync_status === "approved");
}

function clusterMatches(cluster: PmsSyncCluster, fields: ReturnType<typeof extractApptFields>): boolean {
  if (fields.appointment_type === cluster.appointment_type) return true;
  const primary = cluster.procedure_codes[0];
  if (primary && primary !== "none" && fields.procedure_codes.includes(primary)) return true;
  if (cluster.procedure_codes.some((c) => fields.procedure_codes.includes(c))) return true;
  return false;
}

// deno-lint-ignore no-explicit-any
export function matchesSyncRules(rules: PmsSyncRules | null | undefined, rawAppt: any): { match: boolean; ruleId: string | null } {
  if (!rules?.clusters?.length) return { match: false, ruleId: null };
  const fields = extractApptFields(rawAppt as Record<string, unknown>);
  for (const cluster of rules.clusters) {
    if (!cluster.included) continue;
    if (clusterMatches(cluster, fields)) return { match: true, ruleId: cluster.id };
  }
  return { match: false, ruleId: null };
}

function toIntOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(typeof v === "string" ? v.replace(/,/g, "") : v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Sikka may send `appointment_date` as full ISO ("2025-10-10T00:00:00") plus a separate time. */
function normalizeDateOnly(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  const m = String(raw).trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

// deno-lint-ignore no-explicit-any
export function combineAppointmentDateTime(a: any): string | null {
  if (a.appointment_datetime) {
    const dt = String(a.appointment_datetime).trim();
    if (/^\d{4}-\d{2}-\d{2}T/.test(dt)) return dt.slice(0, 19);
  }
  const dateRaw = a.appointment_date ?? a.date;
  const dateOnly = normalizeDateOnly(dateRaw);
  const time = pick(a, "appointment_time", "start_time", "time");
  if (dateOnly && typeof time === "string" && /^\d{1,2}:\d{2}/.test(time.trim())) {
    const t = time.trim();
    const hhmm = t.length === 5 ? t : t.slice(0, 5);
    return `${dateOnly}T${hhmm}:00`;
  }
  if (dateOnly) return `${dateOnly}T00:00:00`;
  if (dateRaw && /T/.test(String(dateRaw))) return String(dateRaw).trim().slice(0, 19);
  return typeof time === "string" ? time : null;
}

// deno-lint-ignore no-explicit-any
export function mapAppointmentRow(
  a: any,
  practiceId: string,
  matchRule: string | null = null,
  rules?: PmsSyncRules | null,
) {
  const p = a.patient || {};
  const names = patientNamesFromAppt(a as Record<string, unknown>, p as Record<string, unknown>);
  const appointmentType = resolveAppointmentTypeLabel(a as Record<string, unknown>, matchRule, rules);
  return {
    practice_id: practiceId,
    pms_appointment_id: String(a.sikka_appointment_id ?? a.appointment_sr_no ?? a.id ?? a.appointment_id ?? ""),
    patient_first: names.first,
    patient_last: names.last,
    patient_phone: pick(p, "cell", "mobile_phone", "phone", "home_phone") ?? pick(a, "cell", "patient_phone", "phone"),
    patient_email: pick(p, "email") ?? pick(a, "patient_email", "email"),
    appointment_time: combineAppointmentDateTime(a),
    appointment_type: appointmentType,
    provider: providerLabelFromAppt(a as Record<string, unknown>),
    duration_minutes: toIntOrNull(pick(a, "duration_minutes", "length", "appointment_length")),
    is_implant_consult: true,
    treatment_type: normalizeTreatment(a.treatment_type ?? appointmentType),
    tx_plan_value: pickTxValue(a),
    pms_match_rule: matchRule,
  };
}

export async function fetchAppointmentsInWindow(
  requestKey: string,
  officeId: string,
  historyYears: number,
  forwardYears: number,
  // deno-lint-ignore no-explicit-any
): Promise<any[]> {
  const { start, end } = syncWindow(historyYears, forwardYears);
  const chunks = dateRangeChunks(start, end);
  const all: unknown[] = [];
  for (const { startdate, enddate } of chunks) {
    const data = await sikkaGet(SIKKA_APPOINTMENTS_PATH, requestKey, { office_id: officeId, startdate, enddate });
    all.push(...unwrapList(data, "appointments"));
  }
  return all;
}

// deno-lint-ignore no-explicit-any
export async function upsertAppointments(admin: any, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  let res = await admin.from("pms_appointments").upsert(rows, { onConflict: "practice_id,pms_appointment_id" });
  if (res.error && /treatment_type|tx_plan_value|pms_match_rule|column/i.test(res.error.message || "")) {
    const stripped = rows.map(({ treatment_type, tx_plan_value, pms_match_rule, ...r }) => r);
    res = await admin.from("pms_appointments").upsert(stripped, { onConflict: "practice_id,pms_appointment_id" });
  }
  if (res.error) throw res.error;
}

// JIT patient upsert from matched appointment payloads only.
// deno-lint-ignore no-explicit-any
export async function jitUpsertPatientsFromAppointments(
  admin: any,
  practiceId: string,
  officeId: string,
  rawAppts: any[],
  patientMap?: Map<string, Record<string, unknown>>,
) {
  const seen = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  for (const a of rawAppts) {
    const extId = String(pick(a, "patient_id", "patient_sr_no", "external_id") ?? "").trim();
    if (!extId || seen.has(extId)) continue;
    seen.add(extId);
    const p = (patientMap?.get(extId) as Record<string, unknown>) || a.patient || {};
    const names = patientNamesFromAppt(a as Record<string, unknown>, p as Record<string, unknown>);
    const contact = contactFromPatientRecord(p as Record<string, unknown>);
    rows.push({
      practice_id: practiceId,
      office_id: officeId,
      external_id: extId,
      first_name: names.first,
      last_name: names.last,
      phone: contact.phone ?? pick(a, "cell", "patient_phone"),
      email: contact.email ?? pick(a, "patient_email", "email"),
      raw: a,
      updated_at: new Date().toISOString(),
    });
  }
  if (!rows.length) return 0;
  const res = await admin.from("pms_patients").upsert(rows, { onConflict: "practice_id,external_id" });
  if (res.error) throw res.error;
  return rows.length;
}

// deno-lint-ignore no-explicit-any
export async function syncMatchedAppointments(
  admin: any,
  practice: PmsSyncPracticeRow,
  rules: PmsSyncRules,
  // deno-lint-ignore no-explicit-any
): Promise<{ synced: number; patients: number; scanned: number }> {
  if (!practice.sikka_practice_id) throw new Error("missing_office_id");
  const requestKey = await ensureFreshToken(admin, practice);
  const raw = await fetchAppointmentsInWindow(
    requestKey,
    practice.sikka_practice_id,
    rules.history_years,
    rules.forward_years,
  );

  const matchedRaw: unknown[] = [];
  const rows: Record<string, unknown>[] = [];
  for (const a of raw) {
    const { match, ruleId } = matchesSyncRules(rules, a);
    if (!match) continue;
    const row = mapAppointmentRow(a, practice.id, ruleId, rules);
    if (!row.pms_appointment_id) continue;
    rows.push(row);
    matchedRaw.push(a);
  }

  if (!rows.length) return { synced: 0, patients: 0, scanned: raw.length };

  const { patientMap } = await enrichAppointmentBatch(requestKey, practice.sikka_practice_id, rows, matchedRaw);

  await upsertAppointments(admin, rows);
  const patients = await jitUpsertPatientsFromAppointments(
    admin,
    practice.id,
    practice.sikka_practice_id,
    matchedRaw,
    patientMap,
  );

  await admin.from("practices").update({
    pms_last_synced_at: new Date().toISOString(),
    sikka_connected: true,
  }).eq("id", practice.id);

  return { synced: rows.length, patients, scanned: raw.length };
}

// Access levels that may manage practice settings (mirrors src/lib/permissions.js).
const PRACTICE_ADMIN_LEVELS = new Set(["practice_owner", "agency_owner", "agency_admin"]);

// Practice admin gate for calibration endpoints. Mirrors AuthContext: role=owner
// counts as practice_owner when access_level is unset (legacy rows).
// deno-lint-ignore no-explicit-any
export async function assertPracticeAdmin(
  userClient: any,
  userId: string,
  practiceId: string,
  userEmail?: string | null,
  // deno-lint-ignore no-explicit-any
  adminClient?: any,
) {
  const { data: prof } = await userClient
    .from("users")
    .select("practice_id, access_level, role")
    .eq("id", userId)
    .maybeSingle();
  const isSuperAdmin = isSuperAdminUser({ email: userEmail }, prof?.access_level);
  if (!prof?.practice_id && !isSuperAdmin && !PRACTICE_ADMIN_LEVELS.has(prof?.access_level ?? "")) {
    return { ok: false as const, error: "No practice in context." };
  }

  let practiceOk = prof?.practice_id === practiceId || isSuperAdmin;
  if (!practiceOk && adminClient && PRACTICE_ADMIN_LEVELS.has(prof?.access_level ?? "")) {
    const { data: pr } = await adminClient
      .from("practices")
      .select("agency_id")
      .eq("id", practiceId)
      .maybeSingle();
    if (pr?.agency_id) {
      const { data: mem } = await adminClient
        .from("agency_members")
        .select("role")
        .eq("user_id", userId)
        .eq("agency_id", pr.agency_id)
        .maybeSingle();
      if (mem && ["owner", "admin"].includes(mem.role)) practiceOk = true;
    }
  }
  if (!practiceOk) return { ok: false as const, error: "Practice mismatch." };

  const isAdmin =
    PRACTICE_ADMIN_LEVELS.has(prof?.access_level ?? "") ||
    prof?.role === "owner" ||
    prof?.role === "admin" ||
    isSuperAdmin;
  if (!isAdmin) return { ok: false as const, error: "Only practice admins can manage PMS sync settings." };
  return { ok: true as const, accessLevel: prof?.access_level || "practice_owner" };
}
