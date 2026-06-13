import { reportEdgeError } from "../_shared/report-error.ts";
// discover-pms-consults, scan PMS appointments across configured year windows,
// cluster types, classify with AI (always), save draft rules for admin approval.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { ensureFreshToken, getAppCreds } from "../_shared/sikka.ts";
import {
  assertPracticeAdmin,
  buildRules,
  classifyClustersWithAI,
  clampYears,
  clusterAppointments,
  fetchAppointmentsInWindow,
  PRACTICE_SYNC_COLS,
  type PmsSyncCluster,
  type PmsSyncPracticeRow,
} from "../_shared/pms-sync.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    getAppCreds();
  } catch {
    return json({ error: "PMS discovery unavailable, Sikka app credentials are not set.", code: "sikka_not_configured" }, 503);
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
    const isService = authHeader.replace(/^Bearer\s+/i, "") === serviceKey;
    if (!practiceId && !isService) {
      const { data: prof } = await userClient.from("users").select("practice_id").eq("id", user.id).maybeSingle();
      practiceId = prof?.practice_id ?? null;
    }
    if (!practiceId) return json({ error: "practice_id required" }, 400);
    practiceIdForReset = practiceId;

    if (!isService) {
      const gate = await assertPracticeAdmin(userClient, user.id, practiceId, user.email, admin);
      if (!gate.ok) return json({ error: gate.error }, gate.error.includes("admin") ? 403 : 400);
    }

    const { data: practice, error: prErr } = await admin
      .from("practices")
      .select(PRACTICE_SYNC_COLS)
      .eq("id", practiceId)
      .maybeSingle();
    if (prErr || !practice) return json({ error: "Practice not found" }, 404);
    if (!practice.sikka_refresh_token) {
      return json({ error: "This practice hasn't connected to Sikka yet.", code: "not_linked" }, 409);
    }

    const historyYears = clampYears(body.history_years ?? practice.pms_history_years ?? 1);
    const forwardYears = clampYears(body.forward_years ?? practice.pms_forward_years ?? 1);

    await admin.from("practices").update({
      pms_sync_status: "syncing",
      pms_history_years: historyYears,
      pms_forward_years: forwardYears,
    }).eq("id", practiceId);

    const requestKey = await ensureFreshToken(admin, practice as PmsSyncPracticeRow);
    const raw = await fetchAppointmentsInWindow(
      requestKey,
      practice.sikka_practice_id!,
      historyYears,
      forwardYears,
    );

    const clusterMap = clusterAppointments(raw);
    let clusters: PmsSyncCluster[] = [...clusterMap.values()].sort((a, b) => b.count - a.count);
    let aiUsed = false;
    try {
      clusters = await classifyClustersWithAI(clusters);
      aiUsed = true;
    } catch (e) {
      console.error("discover-pms-consults AI failed:", e);
      await admin.from("practices").update({ pms_sync_status: "draft" }).eq("id", practiceId);
      return json({
        error: "AI classification is required for discovery but failed. Check ANTHROPIC_API_KEY.",
        detail: String((e as Error)?.message ?? e),
      }, 503);
    }

    const rules = buildRules(clusters, raw.length, historyYears, forwardYears, aiUsed);

    await admin.from("practices").update({
      pms_sync_rules: rules,
      pms_sync_status: "pending_approval",
      pms_history_years: historyYears,
      pms_forward_years: forwardYears,
    }).eq("id", practiceId);

    return json({
      ok: true,
      practice_id: practiceId,
      total_scanned: rules.total_scanned,
      matched_count: rules.matched_count,
      excluded_count: rules.excluded_count,
      clusters: rules.clusters.length,
      ai_used: aiUsed,
      rules,
    });
  } catch (e) {
    await reportEdgeError("discover-pms-consults", e);
    console.error("discover-pms-consults error:", e);
    if (practiceIdForReset) {
      try {
        const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        await admin.from("practices").update({ pms_sync_status: "draft" }).eq("id", practiceIdForReset);
      } catch { /* best-effort */ }
    }
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
