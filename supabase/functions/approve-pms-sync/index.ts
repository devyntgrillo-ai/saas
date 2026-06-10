import { reportEdgeError } from "../_shared/report-error.ts";
// approve-pms-sync, practice admin approves consult sync rules and triggers backfill.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { getAppCreds } from "../_shared/sikka.ts";
import {
  assertPracticeAdmin,
  buildRules,
  clampYears,
  PRACTICE_SYNC_COLS,
  syncMatchedAppointments,
  type PmsSyncCluster,
  type PmsSyncPracticeRow,
  type PmsSyncRules,
} from "../_shared/pms-sync.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

function applyClusterOverrides(rules: PmsSyncRules, overrides: { id: string; included: boolean }[]): PmsSyncRules {
  if (!overrides?.length) return rules;
  const byId = new Map(overrides.map((o) => [o.id, o.included]));
  const clusters = rules.clusters.map((c) => {
    const inc = byId.get(c.id);
    return inc === undefined ? c : { ...c, included: inc };
  });
  return buildRules(clusters, rules.total_scanned, rules.history_years, rules.forward_years, rules.ai_used);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    getAppCreds();
  } catch {
    return json({ error: "PMS sync unavailable, Sikka app credentials are not set.", code: "sikka_not_configured" }, 503);
  }

  let practiceIdForReset: string | null = null;
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    let practiceId: string | null = body.practice_id ?? null;
    if (!practiceId) {
      const { data: prof } = await userClient.from("users").select("practice_id").eq("id", user.id).maybeSingle();
      practiceId = prof?.practice_id ?? null;
    }
    if (!practiceId) return json({ error: "No practice in context." }, 400);
    practiceIdForReset = practiceId;

    const gate = await assertPracticeAdmin(userClient, user.id, practiceId, user.email);
    if (!gate.ok) return json({ error: gate.error }, gate.error.includes("admin") ? 403 : 400);

    const { data: practice, error: prErr } = await admin
      .from("practices")
      .select(PRACTICE_SYNC_COLS)
      .eq("id", practiceId)
      .maybeSingle();
    if (prErr || !practice) return json({ error: "Practice not found" }, 404);

    const draft = practice.pms_sync_rules as PmsSyncRules | null;
    if (!draft?.clusters?.length) {
      return json({ error: "Run discovery first, no sync rules to approve.", code: "no_rules" }, 409);
    }

    const historyYears = clampYears(body.history_years ?? draft.history_years ?? practice.pms_history_years ?? 1);
    const forwardYears = clampYears(body.forward_years ?? draft.forward_years ?? practice.pms_forward_years ?? 1);
    let rules = { ...draft, history_years: historyYears, forward_years: forwardYears };

    if (Array.isArray(body.clusters)) {
      rules = applyClusterOverrides(rules, body.clusters as { id: string; included: boolean }[]);
    } else if (Array.isArray(body.cluster_overrides)) {
      rules = applyClusterOverrides(rules, body.cluster_overrides);
    }

    const now = new Date().toISOString();
    await admin.from("practices").update({
      pms_sync_rules: rules,
      pms_sync_status: "syncing",
      pms_history_years: historyYears,
      pms_forward_years: forwardYears,
      pms_sync_approved_at: now,
    }).eq("id", practiceId);

    const result = await syncMatchedAppointments(admin, practice as PmsSyncPracticeRow, rules);

    await admin.from("practices").update({ pms_sync_status: "active" }).eq("id", practiceId);

    return json({
      ok: true,
      practice_id: practiceId,
      approved_at: now,
      matched_count: rules.matched_count,
      synced: result.synced,
      patients: result.patients,
      scanned: result.scanned,
    });
  } catch (e) {
    await reportEdgeError("approve-pms-sync", e);
    console.error("approve-pms-sync error:", e);
    if (practiceIdForReset) {
      try {
        const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        await admin.from("practices").update({
          pms_sync_status: "pending_approval",
          pms_sync_approved_at: null,
        }).eq("id", practiceIdForReset);
      } catch { /* best-effort */ }
    }
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
