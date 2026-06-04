import { reportEdgeError } from "../_shared/report-error.ts";
// ============================================================================
// sikka-oauth-callback - the two ends of the Sikka OAuth 2.0 flow.
//
//   POST  (practice JWT)  → returns { url } the "Connect to Sikka" button sends
//                           the browser to. State carries a random nonce +
//                           practice_id for CSRF protection (audit finding 6).
//   GET   ?code&state     → Sikka's redirect after the practice clicks Allow.
//                           Exchanges the code for request_key + refresh_token,
//                           saves them on the practice, then 302s back to the
//                           app's Integrations page with a status param.
//
// Secrets: SIKKA_APP_ID, SIKKA_APP_SECRET. The redirect_uri registered in the
// Sikka developer portal must equal this function's URL (or SIKKA_REDIRECT_URI).
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { appUrl, exchangeAuthCode, getAppCreds, redirectUri, SIKKA_AUTHORIZE_URL, saveTokens } from "../_shared/sikka.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// 302 back to the SPA's Integrations page with a status the page can surface.
function redirectToApp(status: string, reason?: string): Response {
  const q = new URLSearchParams({ sikka: status });
  if (reason) q.set("reason", reason.slice(0, 120));
  return new Response(null, { status: 302, headers: { Location: `${appUrl()}/settings/integrations?${q.toString()}` } });
}

function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // ── Initiator: build the authorize URL for the signed-in practice ─────────
  if (req.method === "POST") {
    try {
      const authHeader = req.headers.get("Authorization") || "";
      if (!authHeader) return json({ error: "Unauthorized" }, 401);
      const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) return json({ error: "Unauthorized" }, 401);
      const { data: prof } = await userClient.from("users").select("practice_id").eq("id", user.id).maybeSingle();
      const practiceId = prof?.practice_id;
      if (!practiceId) return json({ error: "No practice in context." }, 400);

      // Generate a random nonce, persist it, and include it in the OAuth state
      // parameter to prevent CSRF attacks on the callback (audit finding 6).
      const admin = adminClient();
      const nonce = crypto.randomUUID();
      await admin.from("practices").update({ sikka_oauth_nonce: nonce }).eq("id", practiceId);

      const { id } = getAppCreds();
      const q = new URLSearchParams({
        response_type: "code",
        client_id: id,
        redirect_uri: redirectUri(),
        scope: "*",
        state: `${nonce}:${practiceId}`,
      });
      return json({ url: `${SIKKA_AUTHORIZE_URL}?${q.toString()}` });
    } catch (e) {
      const msg = (e as Error)?.message || String(e);
      if (msg === "sikka_app_not_configured") {
        return json({ error: "Sikka isn't configured yet (SIKKA_APP_ID / SIKKA_APP_SECRET).", code: msg }, 503);
      }
      return json({ error: msg }, 500);
    }
  }

  // ── Callback: Sikka redirected the browser back here with ?code&state ─────
  if (req.method === "GET") {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state"); // nonce:practice_id
    const err = url.searchParams.get("error");
    if (err) return redirectToApp("error", err);
    if (!code || !state) return redirectToApp("error", "missing_code");

    // Parse nonce:practice_id from state and verify the nonce (CSRF protection).
    const colon = state.indexOf(":");
    if (colon < 1) return redirectToApp("error", "invalid_state");
    const gotNonce = state.slice(0, colon);
    const practiceId = state.slice(colon + 1);
    if (!gotNonce || !practiceId) return redirectToApp("error", "invalid_state");

    try {
      const admin = adminClient();
      const { data: practice } = await admin.from("practices").select("id, sikka_oauth_nonce").eq("id", practiceId).maybeSingle();
      if (!practice) return redirectToApp("error", "unknown_practice");
      if (!practice.sikka_oauth_nonce || practice.sikka_oauth_nonce !== gotNonce) {
        console.warn("sikka-oauth-callback: CSRF nonce mismatch", { practiceId, expected: practice.sikka_oauth_nonce, got: gotNonce });
        return redirectToApp("error", "csrf_mismatch");
      }

      // Clear the nonce immediately so it cannot be replayed.
      await admin.from("practices").update({ sikka_oauth_nonce: null }).eq("id", practice.id);

      const tokens = await exchangeAuthCode(code);
      await saveTokens(admin, practice.id, tokens, { sikka_connected: true, pms_last_synced_at: null });

      // Audit (best-effort).
      await admin.from("audit_logs").insert({
        practice_id: practice.id, action: "pms.sikka_connected", resource_type: "practice", resource_id: practice.id,
      }).then(() => {}, () => {});

      return redirectToApp("connected");
    } catch (e) {
    await reportEdgeError("sikka-oauth-callback", e);
      const msg = (e as Error)?.message || String(e);
      console.error("sikka-oauth-callback exchange failed:", msg);
      return redirectToApp("error", msg.startsWith("sikka_token_") ? "token_exchange_failed" : msg);
    }
  }

  return json({ error: "Method not allowed" }, 405);
});
