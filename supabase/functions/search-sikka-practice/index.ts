import { reportEdgeError } from "../_shared/report-error.ts";
// ============================================================================
// search-sikka-practice - admin-only: list the Sikka offices a practice's
// OAuth token is authorized for, so a super admin can pick the right office_id
// (stored as sikka_practice_id) to sync.
//
// In the OAuth 2.0 model there is no global name/NPI search - an app can only
// see the practices that authorized it. This calls Sikka's authorized_practices
// endpoint with that practice's request_key (auto-refreshed). Body: { practice_id }.
//
// Auth: super-admin JWT. Secrets: SIKKA_APP_ID, SIKKA_APP_SECRET (no SIKKA_API_KEY).
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { isSuperAdminUser } from "../_shared/admin.ts";
import {
  ensureFreshToken,
  getAppCreds,
  SIKKA_AUTHORIZED_PRACTICES_PATH,
  sikkaGet,
  type SikkaPracticeRow,
  unwrapList,
} from "../_shared/sikka.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const PRACTICE_COLS = "id, sikka_practice_id, sikka_request_key, sikka_refresh_token, sikka_token_expires_at";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    getAppCreds();
  } catch {
    return json({ error: "Sikka isn't configured (SIKKA_APP_ID / SIKKA_APP_SECRET).", code: "sikka_not_configured" }, 503);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);
    // Super-admin only.
    const { data: prof } = await supabase.from("users").select("access_level").eq("id", user.id).maybeSingle();
    if (!isSuperAdminUser(user, prof?.access_level)) return json({ error: "Forbidden - admin only." }, 403);

    const { practice_id } = await req.json().catch(() => ({ practice_id: "" }));
    if (!practice_id) return json({ error: "practice_id required." }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: pr } = await admin.from("practices").select(PRACTICE_COLS).eq("id", practice_id).maybeSingle();
    if (!pr) return json({ error: "Practice not found." }, 404);
    if (!pr.sikka_refresh_token) {
      return json({ error: "This practice hasn't connected to Sikka yet - have them click Connect to Sikka first.", code: "not_linked" }, 409);
    }

    const requestKey = await ensureFreshToken(admin, pr as SikkaPracticeRow);
    const data = await sikkaGet(SIKKA_AUTHORIZED_PRACTICES_PATH, requestKey);
    const list = unwrapList(data, "authorized_practices", "practices");

    // deno-lint-ignore no-explicit-any
    const results = (list as any[]).map((p) => ({
      sikka_practice_id: String(p.office_id ?? p.sikka_practice_id ?? p.practice_id ?? p.id ?? ""),
      name: p.practice_name ?? p.office_name ?? p.name ?? null,
      address: p.address ?? ([p.city, p.state].filter(Boolean).join(", ") || null),
      npi: p.npi ?? null,
    })).filter((r) => r.sikka_practice_id);

    return json({ results });
  } catch (e) {
    await reportEdgeError("search-sikka-practice", e);
    const msg = (e as Error)?.message ?? String(e);
    console.error("search-sikka-practice error:", msg);
    if (msg === "sikka_not_connected") return json({ error: "This practice hasn't connected to Sikka yet.", code: "not_linked" }, 409);
    return json({ error: "Sikka request failed.", code: "sikka_error", detail: msg }, 502);
  }
});
