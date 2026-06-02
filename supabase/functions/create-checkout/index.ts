// ============================================================================
// create-checkout - start a Lemon Squeezy checkout for a practice's Hope AI
// subscription.
//
// Flow:
//   0. Guard: if LEMONSQUEEZY_API_KEY is missing, return a clean 503 immediately
//      (never touch the LS API).
//   1. Authenticate the caller (JWT) and resolve them to a practice (RLS).
//   2. Create a Lemon Squeezy hosted checkout for the Hope AI variant via the
//      REST API directly (no SDK - avoids import/init failures in Deno), tagging
//      it with custom.practice_id so `ls-webhook` can map the subscription back.
//   3. Return the hosted checkout URL + whether it's a test-mode checkout.
//
// Test vs live mode is determined entirely by the API key: a Lemon Squeezy
// test-mode key only sees test-mode data and produces test-mode checkouts (no
// per-request flag needed). Note that variant IDs differ between test and live
// mode, so the variant must match the key's mode.
//
// Secrets (server-side only):
//   LEMONSQUEEZY_API_KEY     - required. Test-mode key while the account is in review.
//   LEMONSQUEEZY_STORE_ID    - optional. Falls back to the Hope AI store id below.
//   LEMONSQUEEZY_VARIANT_ID  - optional. Falls back to the id below; set this to the
//                              TEST-mode variant id while using a test-mode key.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

// Hope AI store + plan in Lemon Squeezy. Overridable via secrets so test/live
// switching is a config change, not a code change.
const STORE_ID = Deno.env.get("LEMONSQUEEZY_STORE_ID")?.trim() || "390825";
const VARIANT_ID = Deno.env.get("LEMONSQUEEZY_VARIANT_ID")?.trim() || "1718899";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Guard FIRST - no key means billing isn't configured. Clean 503, no crash.
  // .trim() defends against a trailing newline/space in the stored secret, which
  // is a common cause of a 401 from LS even though the key looks correct.
  const apiKey = Deno.env.get("LEMONSQUEEZY_API_KEY")?.trim();
  if (!apiKey) {
    return json({ error: "Billing isn't configured yet (LEMONSQUEEZY_API_KEY is not set)." }, 503);
  }
  // Diagnostic (prefix only - never log the full key). A Lemon Squeezy *personal
  // API key* is a long opaque token; a value starting with "eyJ" is a JWT (wrong
  // key type) and will 401.
  console.log(
    "LS key prefix:", apiKey.slice(0, 8),
    "len:", apiKey.length,
    apiKey.startsWith("eyJ") ? "(looks like a JWT - likely the WRONG key type)" : "",
  );

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    // User-scoped client so the practice lookup is constrained by RLS.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    // mode_check: a lightweight probe that creates a checkout purely to read its
    // test_mode flag (the only reliable signal of the API key's mode), then
    // discards it. Used by the billing UI to decide whether to show the test-mode
    // banner. It needs no practice and no redirect.
    const modeCheck: boolean = body.mode_check === true;
    const practiceId: string | undefined = body.practice_id;
    const email: string | undefined = body.email ?? user.email ?? undefined;
    if (!email) return json({ error: "Missing 'email'" }, 400);

    let practice: { id: string; name?: string } | null = null;
    if (!modeCheck) {
      if (!practiceId) return json({ error: "Missing 'practice_id'" }, 400);
      // RLS only returns the practice if the caller belongs to it.
      const { data, error: practiceErr } = await supabase
        .from("practices")
        .select("id, name")
        .eq("id", practiceId)
        .maybeSingle();
      if (practiceErr) throw practiceErr;
      if (!data) return json({ error: "Practice not found or not accessible" }, 403);
      practice = data;
    }

    const origin = req.headers.get("origin") || "";
    const redirectUrl =
      body.redirect_url || (origin ? `${origin}/settings/billing?success=true` : undefined);

    // Lemon Squeezy Checkouts API (JSON:API). custom values must be strings.
    // For a mode_check probe we omit custom (it's never completed, so the webhook
    // would never map it) and the redirect.
    const attributes: Record<string, unknown> = {
      checkout_data: practice
        ? { email, custom: { practice_id: String(practice.id) } }
        : { email },
      checkout_options: { embed: false },
    };
    if (!modeCheck) {
      attributes.product_options = {
        redirect_url: redirectUrl,
        receipt_button_text: "Return to Hope AI",
      };
    }
    const payload = {
      data: {
        type: "checkouts",
        attributes,
        relationships: {
          store: { data: { type: "stores", id: String(STORE_ID) } },
          variant: { data: { type: "variants", id: String(VARIANT_ID) } },
        },
      },
    };

    const lsRes = await fetch("https://api.lemonsqueezy.com/v1/checkouts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/vnd.api+json",
        "Content-Type": "application/vnd.api+json",
      },
      body: JSON.stringify(payload),
    });

    const raw = await lsRes.text();
    if (!lsRes.ok) {
      let detail = raw;
      try {
        const errs = JSON.parse(raw)?.errors;
        if (Array.isArray(errs) && errs.length) detail = errs[0].detail || errs[0].title || raw;
      } catch { /* keep raw */ }
      console.error(`Lemon Squeezy checkout error ${lsRes.status}:`, raw);
      return json({ error: `Lemon Squeezy rejected the checkout (${lsRes.status}): ${detail}` }, 502);
    }

    let url: string | undefined;
    let testMode = false;
    try {
      const attrs = JSON.parse(raw)?.data?.attributes;
      url = attrs?.url;
      testMode = attrs?.test_mode === true;
    } catch { /* fall through */ }

    // Surface the mode so the caller (and logs) can confirm the full flow is
    // running against test mode before going live.
    console.log("LS checkout", modeCheck ? "probe" : "created", "test_mode:", testMode, "store:", STORE_ID, "variant:", VARIANT_ID);

    // Probe: return only the mode; the throwaway checkout is left to expire.
    if (modeCheck) return json({ test_mode: testMode });

    if (!url) return json({ error: "Checkout created but no URL was returned." }, 502);
    return json({ url, test_mode: testMode });
  } catch (e) {
    console.error("create-checkout error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
