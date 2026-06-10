import { reportEdgeError } from "../_shared/report-error.ts";
// ============================================================================
// sync-pms-unscheduled-treatments — pull the practice's UNSCHEDULED treatment
// plans from their PMS (Sikka) and mirror them into
// public.pms_unscheduled_treatments, so the dashboard "Unscheduled TX Plans"
// KPI can reflect the PMS's own list (count + total value).
//
// Callable:
//   • per-practice with { practice_id } (or by a practice admin for their own), or
//   • by a cron with the service-role key + no body → syncs ALL Sikka-connected
//     practices (intended to run on a schedule).
//
// The Sikka resource path is env-overridable (SIKKA_UNSCHEDULED_TX_PATH) because
// the exact v4 name is account-dependent — confirm it against the target
// account's API portal before relying on this in production.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import {
  ensureFreshToken,
  getAppCreds,
  normalizeTreatment,
  pickTxValue,
  sikkaGet,
  SIKKA_UNSCHEDULED_TX_PATH,
  type SikkaPracticeRow,
  unwrapList,
} from "../_shared/sikka.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const PRACTICE_COLS =
  "id, email, sikka_practice_id, sikka_request_key, sikka_refresh_token, sikka_token_expires_at";

// deno-lint-ignore no-explicit-any
function mapRow(practiceId: string, officeId: string | null, o: any) {
  const externalId =
    o?.treatment_plan_id ?? o?.treatmentplan_id ?? o?.plan_id ?? o?.procedure_id ?? o?.id ?? null;
  const first = o?.patient_firstname ?? o?.firstname ?? o?.first_name ?? "";
  const last = o?.patient_lastname ?? o?.lastname ?? o?.last_name ?? "";
  const patientName = (o?.patient_name ?? o?.patientname ?? `${first} ${last}`).toString().trim() || null;
  const description = o?.description ?? o?.procedure_description ?? o?.treatment ?? o?.proc_name ?? null;
  return {
    practice_id: practiceId,
    office_id: officeId,
    external_id: externalId != null ? String(externalId) : null,
    patient_external_id: (o?.patient_id ?? o?.patientid ?? o?.patient_external_id ?? null)?.toString() ?? null,
    patient_name: patientName,
    treatment_type: normalizeTreatment(description),
    description: description != null ? String(description) : null,
    tx_value: pickTxValue(o),
    status: (o?.status ?? o?.treatment_status ?? "unscheduled")?.toString() ?? null,
    raw: o,
  };
}

// deno-lint-ignore no-explicit-any
async function syncPractice(admin: any, practice: any): Promise<{ practice_id: string; count: number; value: number }> {
  const requestKey = await ensureFreshToken(admin, practice as SikkaPracticeRow);
  const officeId = practice.sikka_practice_id ?? null;
  const params: Record<string, string> = {};
  if (officeId) params.practice_id = String(officeId);
  const data = await sikkaGet(SIKKA_UNSCHEDULED_TX_PATH, requestKey, params);
  const items = unwrapList(data, "unscheduled_treatment_plans", "treatment_plans", "treatments", "unscheduled_treatments");
  const rows = items.map((o) => mapRow(practice.id, officeId, o));

  // Replace the practice's list atomically-ish: clear then insert the fresh set.
  await admin.from("pms_unscheduled_treatments").delete().eq("practice_id", practice.id);
  if (rows.length) {
    await admin.from("pms_unscheduled_treatments").insert(rows);
  }
  const value = rows.reduce((s: number, r) => s + (Number(r.tx_value) || 0), 0);
  return { practice_id: practice.id, count: rows.length, value };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    getAppCreds();
  } catch {
    return json({ error: "Sikka app credentials are not set.", code: "sikka_not_configured" }, 503);
  }

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const isService = authHeader.replace(/^Bearer\s+/i, "") === serviceKey;
    const body = await req.json().catch(() => ({}));
    let practiceId: string | null = body.practice_id ?? null;

    // A non-service caller may only sync their own practice (and must be an admin).
    if (!isService) {
      const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) return json({ error: "Unauthorized" }, 401);
      const { data: prof } = await userClient.from("users").select("practice_id, role").eq("id", user.id).maybeSingle();
      if (!prof?.practice_id || !["owner", "admin"].includes(prof.role)) {
        return json({ error: "Practice admins only." }, 403);
      }
      practiceId = prof.practice_id;
    }

    // Build the practice set: one practice, or every Sikka-connected practice (cron).
    let q = admin.from("practices").select(PRACTICE_COLS).not("sikka_refresh_token", "is", null);
    if (practiceId) q = q.eq("id", practiceId);
    const { data: practices, error: pErr } = await q;
    if (pErr) return json({ error: pErr.message }, 500);
    if (!practices?.length) return json({ ok: true, results: [], note: "no connected practices" });

    const results = [];
    for (const p of practices) {
      try {
        results.push(await syncPractice(admin, p));
      } catch (e) {
        results.push({ practice_id: p.id, error: String((e as Error)?.message ?? e) });
      }
    }
    return json({ ok: true, results });
  } catch (e) {
    await reportEdgeError("sync-pms-unscheduled-treatments", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
