// ============================================================================
// create-checkout - start a Chargebee hosted-page checkout for a practice's
// CaseLift subscription.
//
// Flow:
//   0. Guard: if Chargebee isn't configured (CHARGEBEE_SITE / CHARGEBEE_API_KEY
//      / CHARGEBEE_PLAN_ID missing) return a clean 503 immediately.
//   1. Authenticate the caller (JWT) and resolve them to a practice (RLS).
//   2. Create or reuse a Chargebee customer for the practice.
//   3. Persist chargebee_customer_id on the practice (service-role) so the
//      webhook can map events back to it.
//   4. Create a hosted-page checkout for the CaseLift plan and return its URL.
//
// Secrets (server-side only):
//   CHARGEBEE_SITE     - required. Chargebee site name, e.g. "caselift".
//   CHARGEBEE_API_KEY  - required. API key from the Chargebee dashboard.
//   CHARGEBEE_PLAN_ID  - required. Plan id for the CaseLift subscription.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { chargebeeConfig, chargebeeRequest } from "../_shared/chargebee.ts";

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

// Best-effort split of a practice's contact name into first/last for Chargebee.
function splitName(practice: { doctor_first?: string; doctor_last?: string; name?: string }): {
  first_name: string;
  last_name: string;
} {
  if (practice.doctor_first || practice.doctor_last) {
    return { first_name: practice.doctor_first ?? "", last_name: practice.doctor_last ?? "" };
  }
  const parts = (practice.name ?? "").trim().split(/\s+/);
  return { first_name: parts[0] ?? "", last_name: parts.slice(1).join(" ") };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const cfg = chargebeeConfig();
  const planId = Deno.env.get("CHARGEBEE_PLAN_ID")?.trim();
  if (!cfg || !planId) {
    return json(
      { error: "Billing isn't configured yet (Chargebee secrets are not set)." },
      503,
    );
  }

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
    const practiceId: string | undefined = body.practice_id;
    if (!practiceId) return json({ error: "Missing 'practice_id'" }, 400);

    // RLS only returns the practice if the caller belongs to it.
    const { data: practice, error: practiceErr } = await supabase
      .from("practices")
      .select("id, name, email, doctor_first, doctor_last, chargebee_customer_id")
      .eq("id", practiceId)
      .maybeSingle();
    if (practiceErr) throw practiceErr;
    if (!practice) return json({ error: "Practice not found or not accessible" }, 403);

    const email: string | undefined = body.email ?? practice.email ?? user.email ?? undefined;
    if (!email) return json({ error: "Missing 'email'" }, 400);

    // Service-role client to persist the customer id (bypasses RLS write rules).
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // --- Create or reuse the Chargebee customer. ---
    let customerId = practice.chargebee_customer_id as string | null;
    if (!customerId) {
      const { first_name, last_name } = splitName(practice);
      const created = await chargebeeRequest(cfg, "/customers", "POST", {
        email,
        first_name,
        last_name,
        company: practice.name ?? "",
      });
      customerId = created?.customer?.id ?? null;
      if (!customerId) return json({ error: "Chargebee did not return a customer id." }, 502);
      await admin.from("practices").update({ chargebee_customer_id: customerId }).eq("id", practice.id);
    }

    const origin = req.headers.get("origin") || "";
    const redirectUrl =
      body.redirect_url || (origin ? `${origin}/settings/billing?success=true` : undefined);

    // --- Create the hosted-page checkout (Product Catalog 2.0). ---
    // PC 2.0 uses /checkout_new_for_items with subscription_items[item_price_id][N];
    // the {0:...} objects encode as the bracketed list indices Chargebee expects
    // (subscription_items[item_price_id][0], subscription_items[quantity][0]).
    // CHARGEBEE_PLAN_ID holds the item price id for the CaseLift plan.
    const checkout = await chargebeeRequest(cfg, "/hosted_pages/checkout_new_for_items", "POST", {
      subscription_items: { item_price_id: { 0: planId }, quantity: { 0: 1 } },
      customer: { id: customerId },
      redirect_url: redirectUrl,
      // Carried back on the hosted_page; a secondary mapping signal for the webhook.
      pass_thru_content: JSON.stringify({ practice_id: String(practice.id) }),
    });

    const url = checkout?.hosted_page?.url;
    if (!url) return json({ error: "Checkout created but no URL was returned." }, 502);
    return json({ url });
  } catch (e) {
    console.error("create-checkout error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
