import { reportEdgeError } from "../_shared/report-error.ts";
// ============================================================================
// create-portal-session - return a Chargebee customer-portal URL so a practice
// can update its payment method, view invoices, or cancel its subscription.
//
// Accepts the user's JWT, resolves their practice, reads chargebee_customer_id,
// and asks Chargebee for a portal session (POST /portal_sessions). Returns the
// session's access_url for the frontend to redirect to.
//
// Secrets: CHARGEBEE_SITE, CHARGEBEE_API_KEY.
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
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const cfg = chargebeeConfig();
  if (!cfg) return json({ error: "Billing isn't configured yet (Chargebee secrets are not set)." }, 503);

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
      .select("id, chargebee_customer_id")
      .eq("id", practiceId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!practice) return json({ error: "Practice not found or not accessible." }, 403);
    const customerId = practice.chargebee_customer_id;
    if (!customerId) return json({ error: "No Chargebee customer on file - activate a subscription first." }, 409);

    const origin = req.headers.get("origin") || "";
    const redirectUrl = body.redirect_url || (origin ? `${origin}/settings/billing` : undefined);

    const session = await chargebeeRequest(cfg, "/portal_sessions", "POST", {
      customer: { id: String(customerId) },
      redirect_url: redirectUrl,
    });

    const url = session?.portal_session?.access_url;
    if (!url) return json({ error: "Chargebee did not return a portal URL." }, 502);
    return json({ url });
  } catch (e) {
    await reportEdgeError("create-portal-session", e);
    console.error("create-portal-session error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
