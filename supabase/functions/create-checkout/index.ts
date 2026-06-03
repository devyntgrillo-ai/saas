import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { lsConfig, createLSCustomer, findLSCustomerByEmail, createLSCheckout } from "../_shared/lemonsqueezy.ts";

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

  const cfg = lsConfig();
  if (!cfg) {
    return json(
      { error: "Billing isn't configured yet (Lemon Squeezy secrets are not set)." },
      503,
    );
  }

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
    const practiceId: string | undefined = body.practice_id;
    if (!practiceId) return json({ error: "Missing 'practice_id'" }, 400);

    const { data: practice, error: practiceErr } = await supabase
      .from("practices")
      .select("id, name, email, doctor_first, doctor_last, ls_customer_id")
      .eq("id", practiceId)
      .maybeSingle();
    if (practiceErr) throw practiceErr;
    if (!practice) return json({ error: "Practice not found or not accessible" }, 403);

    const email: string | undefined = body.email ?? practice.email ?? user.email ?? undefined;
    if (!email) return json({ error: "Missing 'email'" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    let customerId = practice.ls_customer_id as string | null;
    if (!customerId) {
      const existing = await findLSCustomerByEmail(cfg, email);
      if (existing) {
        customerId = existing.id;
      } else {
        const { first_name, last_name } = splitName(practice);
        const name = [first_name, last_name].filter(Boolean).join(" ") || email;
        const created = await createLSCustomer(cfg, email, name);
        customerId = created.id;
      }
      await admin.from("practices").update({ ls_customer_id: customerId }).eq("id", practice.id);
    }

    const origin = req.headers.get("origin") || "";
    const redirectUrl =
      body.redirect_url || (origin ? `${origin}/settings/billing?success=true` : undefined);

    const checkout = await createLSCheckout(cfg, cfg.variantId, {
      email,
      name: practice.name || email,
      customData: { practice_id: practice.id },
      redirectUrl,
    });

    return json({ url: checkout.url, id: checkout.id });
  } catch (e) {
    console.error("create-checkout error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
