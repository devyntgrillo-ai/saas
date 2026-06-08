// Read-only Trust Hub status for the ISV primary profile + a practice's A2P bundles.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cfgOrThrow, twilioRequest } from "../_shared/twilio-api.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function fetchProfile(cfg: ReturnType<typeof cfgOrThrow>, sid: string | null, label: string) {
  if (!sid) return { label, sid: null, error: "not configured" };
  try {
    const p = await twilioRequest<{
      sid: string;
      friendly_name: string;
      status: string;
      email?: string;
      valid_until?: string;
    }>(cfg, "trusthub", `/CustomerProfiles/${sid}`, { method: "GET" });
    return {
      label,
      sid: p.sid,
      friendly_name: p.friendly_name,
      status: p.status,
      email: p.email ?? null,
      valid_until: p.valid_until ?? null,
      approved: p.status === "twilio-approved",
    };
  } catch (e) {
    return { label, sid, error: String((e as Error).message) };
  }
}

async function fetchTrustProduct(cfg: ReturnType<typeof cfgOrThrow>, sid: string | null, label: string) {
  if (!sid) return { label, sid: null, error: "not configured" };
  try {
    const p = await twilioRequest<{
      sid: string;
      friendly_name: string;
      status: string;
    }>(cfg, "trusthub", `/TrustProducts/${sid}`, { method: "GET" });
    return {
      label,
      sid: p.sid,
      friendly_name: p.friendly_name,
      status: p.status,
      approved: p.status === "twilio-approved",
    };
  } catch (e) {
    return { label, sid, error: String((e as Error).message) };
  }
}

async function fetchBrand(cfg: ReturnType<typeof cfgOrThrow>, sid: string | null) {
  if (!sid) return { sid: null, error: "not configured" };
  try {
    const b = await twilioRequest<{
      sid: string;
      status: string;
      brand_type?: string;
      failure_reason?: string;
      identity_status?: string;
    }>(cfg, "messaging", `/v1/a2p/BrandRegistrations/${sid}`, { method: "GET" });
    return {
      sid: b.sid,
      status: b.status,
      brand_type: b.brand_type ?? null,
      failure_reason: b.failure_reason ?? null,
      identity_status: b.identity_status ?? null,
      approved: b.status === "APPROVED",
    };
  } catch (e) {
    return { sid, error: String((e as Error).message) };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const cfg = cfgOrThrow();
    const body = await req.json().catch(() => ({})) as {
      practice_customer_profile_sid?: string;
      practice_trust_product_sid?: string;
      practice_brand_sid?: string;
    };

    const primarySid = Deno.env.get("TWILIO_PRIMARY_CUSTOMER_PROFILE_SID") ||
      Deno.env.get("TWILIO_PRIMARY_BUSINESS_PROFILE_SID") || null;

    const [primary, customer, trust, brand, profileList] = await Promise.all([
      fetchProfile(cfg, primarySid, "isv_primary"),
      fetchProfile(cfg, body.practice_customer_profile_sid ?? null, "practice_secondary"),
      fetchTrustProduct(cfg, body.practice_trust_product_sid ?? null, "practice_trust_product"),
      fetchBrand(cfg, body.practice_brand_sid ?? null),
      twilioRequest<{ customer_profiles: Array<{ sid: string; friendly_name: string; status: string }> }>(
        cfg,
        "trusthub",
        "/CustomerProfiles?PageSize=50",
        { method: "GET" },
      ).catch(() => ({ customer_profiles: [] })),
    ]);

    return json({
      ok: true,
      checked_at: new Date().toISOString(),
      isv_primary_ready: primary.approved === true,
      primary,
      practice_secondary: customer,
      practice_trust_product: trust,
      practice_brand: brand,
      all_customer_profiles: (profileList.customer_profiles || []).map((p) => ({
        sid: p.sid,
        friendly_name: p.friendly_name,
        status: p.status,
        is_configured_primary: p.sid === primarySid,
      })),
    });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
