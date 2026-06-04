import { reportEdgeError } from "../_shared/report-error.ts";
// ============================================================================
// get-billing-status - return the caller's practice subscription status.
//
// Auth: the user's JWT. Resolves the practice (body.practice_id, validated via
// RLS, or the caller's own users.practice_id) and returns:
//   { plan, status, trial_ends_at, subscription_id }
// If there's no paid subscription, returns a 14-day trial window derived from
// the practice's created_at.
//
// Subscription state lives on the practices table (written by chargebee-webhook):
//   subscription_status, trial_ends_at, created_at, chargebee_subscription_id.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const TRIAL_DAYS = 14;

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

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    // User-scoped client → practice lookups are constrained by RLS.
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
    if (!practiceId) return json({ error: "No practice in context for this user." }, 400);

    const { data: practice, error: pErr } = await supabase
      .from("practices")
      .select("*")
      .eq("id", practiceId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!practice) return json({ error: "Practice not found or not accessible." }, 403);

    const status: string | null = practice.subscription_status ?? null;
    const subscriptionId = practice.chargebee_subscription_id ?? practice.subscription_id ?? null;

    // No paid subscription (or explicit trial) → return a 14-day trial window.
    if (!status || status === "trial") {
      let trialEndsAt: string | null = practice.trial_ends_at ?? null;
      if (!trialEndsAt && practice.created_at) {
        const d = new Date(practice.created_at);
        d.setDate(d.getDate() + TRIAL_DAYS);
        trialEndsAt = d.toISOString();
      }
      return json({ plan: "trial", status: "trial", trial_ends_at: trialEndsAt, subscription_id: subscriptionId });
    }

    // active / past_due / paused / cancelled - report the real status.
    const plan = status === "active" ? "caselift" : status;
    return json({
      plan,
      status,
      trial_ends_at: practice.trial_ends_at ?? null,
      subscription_id: subscriptionId,
    });
  } catch (e) {
    await reportEdgeError("get-billing-status", e);
    console.error("get-billing-status error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
