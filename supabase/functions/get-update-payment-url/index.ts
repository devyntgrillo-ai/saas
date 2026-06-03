import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { lsConfig, createLSCheckout } from "../_shared/lemonsqueezy.ts";

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

  const cfg = lsConfig();
  if (!cfg) return json({ error: "Billing isn't configured yet (Lemon Squeezy secrets are not set)." }, 503);

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
      .select("id, name, email, ls_customer_id")
      .eq("id", practiceId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!practice) return json({ error: "Practice not found or not accessible." }, 403);

    const email = practice.email || user.email;
    if (!email) return json({ error: "No email on file - update your practice profile first." }, 409);

    const origin = req.headers.get("origin") || "";
    const redirectUrl = body.redirect_url || (origin ? `${origin}/settings/billing` : undefined);

    const checkout = await createLSCheckout(cfg, cfg.variantId, {
      email,
      name: practice.name || email,
      customData: { practice_id: practice.id, update_payment: "true" },
      redirectUrl,
    });

    return json({ url: checkout.url });
  } catch (e) {
    console.error("get-update-payment-url error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
