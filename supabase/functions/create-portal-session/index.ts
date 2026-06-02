// ============================================================================
// create-portal-session - return a Lemon Squeezy customer-portal URL so a
// practice can update its payment method / manage its subscription.
//
// Accepts the user's JWT, resolves their practice, reads ls_customer_id, and
// asks Lemon Squeezy for a portal URL. Tries POST /v1/customer-portal-sessions
// first; falls back to the customer's `urls.customer_portal` if that endpoint
// isn't available on the account.
//
// Secrets: LEMONSQUEEZY_API_KEY.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const LS_HEADERS = (key: string) => ({
  Authorization: `Bearer ${key}`,
  Accept: "application/vnd.api+json",
  "Content-Type": "application/vnd.api+json",
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = Deno.env.get("LEMONSQUEEZY_API_KEY");
  if (!apiKey) return json({ error: "Billing isn't configured yet (LEMONSQUEEZY_API_KEY is not set)." }, 503);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    let practiceId: string | null = body.practice_id ?? null;
    if (!practiceId) {
      const { data: prof } = await supabase.from("users").select("practice_id").eq("id", user.id).maybeSingle();
      practiceId = prof?.practice_id ?? null;
    }
    if (!practiceId) return json({ error: "No practice in context." }, 400);

    const { data: practice, error: pErr } = await supabase
      .from("practices")
      .select("id, ls_customer_id")
      .eq("id", practiceId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!practice) return json({ error: "Practice not found or not accessible." }, 403);
    const customerId = practice.ls_customer_id;
    if (!customerId) return json({ error: "No Lemon Squeezy customer on file - activate a subscription first." }, 409);

    // Preferred: POST /v1/customer-portal-sessions.
    const sessRes = await fetch("https://api.lemonsqueezy.com/v1/customer-portal-sessions", {
      method: "POST",
      headers: LS_HEADERS(apiKey),
      body: JSON.stringify({
        data: {
          type: "customer-portal-sessions",
          relationships: { customer: { data: { type: "customers", id: String(customerId) } } },
        },
      }),
    });
    if (sessRes.ok) {
      const url = (await sessRes.json())?.data?.attributes?.url;
      if (url) return json({ url });
    }

    // Fallback: the customer object exposes a portal URL directly.
    const custRes = await fetch(`https://api.lemonsqueezy.com/v1/customers/${customerId}`, {
      headers: LS_HEADERS(apiKey),
    });
    const custRaw = await custRes.text();
    if (!custRes.ok) {
      console.error(`LS customer fetch ${custRes.status}:`, custRaw);
      return json({ error: `Could not get a portal link from Lemon Squeezy (${custRes.status}).` }, 502);
    }
    const urls = JSON.parse(custRaw)?.data?.attributes?.urls;
    const portalUrl = urls?.customer_portal || urls?.customer_portal_update_subscription;
    if (!portalUrl) return json({ error: "No customer portal URL available." }, 502);
    return json({ url: portalUrl });
  } catch (e) {
    console.error("create-portal-session error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
