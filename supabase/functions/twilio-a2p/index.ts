import { reportEdgeError } from "../_shared/report-error.ts";
// ============================================================================
// twilio-a2p — A2P 10DLC via Trust Hub (ISV API) + brand/campaign registration.
// Actions: register, poll-status
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import {
  a2pDevAutoApprove,
  cfgOrThrow,
  inboundWebhookUrlForPractice,
  mapA2pStatus,
  twilioRequest,
} from "../_shared/twilio-api.ts";
import {
  type A2PBusiness,
  type TrustHubStored,
  ensureA2pTrustHubBundles,
  preconfiguredA2pBundles,
  trustHubForResubmit,
} from "../_shared/twilio-trusthub.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const DEFAULT_SAMPLES = [
  "Hi [name], following up on your implant consult. Any questions about your treatment plan? Reply STOP to opt out.",
  "Hi [name], just checking in after your visit. Happy to help schedule your next step. Reply STOP to opt out.",
];
// Twilio requires at least two samples for CUSTOMER_CARE campaigns.
function campaignSamples(biz: A2PBusiness): string[] {
  const fromBiz = (biz.message_samples || []).map((s) => String(s).trim()).filter(Boolean);
  const merged = [...fromBiz];
  for (const s of DEFAULT_SAMPLES) {
    if (merged.length >= 2) break;
    if (!merged.includes(s)) merged.push(s);
  }
  return merged.slice(0, 5);
}

function trustHubFromConfig(a2pConfig: unknown): TrustHubStored {
  const cfg = (a2pConfig && typeof a2pConfig === "object" ? a2pConfig : {}) as Record<string, unknown>;
  const th = (cfg.trust_hub && typeof cfg.trust_hub === "object" ? cfg.trust_hub : {}) as TrustHubStored;
  return {
    customer_profile_sid: th.customer_profile_sid || undefined,
    trust_product_sid: th.trust_product_sid || undefined,
  };
}

function mergeA2pConfig(existing: unknown, biz: A2PBusiness, trustHub: TrustHubStored): Record<string, unknown> {
  const base = (existing && typeof existing === "object" ? existing : {}) as Record<string, unknown>;
  return { ...base, ...biz, trust_hub: trustHub };
}

function bearerToken(req: Request): string {
  return (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

function isServiceRoleJwt(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

async function verifyAccess(req: Request, practiceId: string, admin: ReturnType<typeof createClient>) {
  const token = bearerToken(req);
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (token && (token === serviceKey || isServiceRoleJwt(token))) return { ok: true as const };

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) return { ok: false as const, status: 401, error: "Unauthorized" };

  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return { ok: false as const, status: 401, error: "Unauthorized" };
  const { data: prof } = await userClient.from("users").select("practice_id, role").eq("id", user.id).maybeSingle();
  if (prof?.practice_id === practiceId) return { ok: true as const };
  if (prof?.role === "agency_admin" || prof?.role === "agency_owner") return { ok: true as const };
  return { ok: false as const, status: 403, error: "Forbidden" };
}

async function ensureMessagingService(
  cfg: ReturnType<typeof cfgOrThrow>,
  admin: ReturnType<typeof createClient>,
  practiceId: string,
  practiceName: string,
  phoneSid: string | null,
) {
  const { data: p } = await admin
    .from("practices")
    .select("twilio_messaging_service_sid, twilio_phone_sid")
    .eq("id", practiceId)
    .maybeSingle();

  let mgSid = p?.twilio_messaging_service_sid || null;
  const inbound = inboundWebhookUrlForPractice(practiceId);

  if (!mgSid) {
    const form = new URLSearchParams();
    form.set("FriendlyName", `CaseLift - ${practiceName}`.slice(0, 64));
    if (inbound) {
      form.set("InboundRequestUrl", inbound);
      form.set("InboundMethod", "POST");
    }
    const svc = await twilioRequest<{ sid: string }>(cfg, "messaging", "/v1/Services", {
      method: "POST",
      body: form.toString(),
    });
    mgSid = svc.sid;
    await admin.from("practices").update({ twilio_messaging_service_sid: mgSid }).eq("id", practiceId);
  }

  const attachSid = phoneSid || p?.twilio_phone_sid;
  if (mgSid && attachSid) {
    try {
      const attach = new URLSearchParams();
      attach.set("PhoneNumberSid", attachSid);
      await twilioRequest(cfg, "messaging", `/v1/Services/${mgSid}/PhoneNumbers`, {
        method: "POST",
        body: attach.toString(),
      });
    } catch (e) {
      const msg = String((e as Error).message || "");
      if (!msg.includes("21710") && !msg.toLowerCase().includes("already")) console.warn("attach phone:", msg);
    }
  }

  return mgSid;
}

async function submitBrand(
  cfg: ReturnType<typeof cfgOrThrow>,
  customerProfileBundleSid: string,
  a2pProfileBundleSid: string,
  biz: A2PBusiness,
): Promise<{ brandSid: string | null; skipped: boolean; reason?: string }> {
  const brandType = (biz.business_type || "").toLowerCase().includes("sole") ? "SOLE_PROPRIETOR" : "STANDARD";
  const form = new URLSearchParams();
  form.set("CustomerProfileBundleSid", customerProfileBundleSid);
  form.set("A2PProfileBundleSid", a2pProfileBundleSid);
  form.set("BrandType", brandType);
  form.set("Mock", "false");

  try {
    const brand = await twilioRequest<{ sid: string }>(cfg, "messaging", "/v1/a2p/BrandRegistrations", {
      method: "POST",
      body: form.toString(),
    });
    return { brandSid: brand.sid, skipped: false };
  } catch (e) {
    return { brandSid: null, skipped: true, reason: String((e as Error).message) };
  }
}

async function submitCampaign(
  cfg: ReturnType<typeof cfgOrThrow>,
  mgSid: string,
  brandSid: string,
  biz: A2PBusiness,
): Promise<{ campaignSid: string | null; skipped: boolean; reason?: string }> {
  const samples = campaignSamples(biz);
  const form = new URLSearchParams();
  form.set("BrandRegistrationSid", brandSid);
  form.set("Description", biz.use_case || "Post-consult dental implant treatment plan follow-up messages.");
  form.set(
    "MessageFlow",
    biz.opt_in_description ||
      "Patients provide their mobile number during the in-office consult and consent to follow-up texts about their treatment plan.",
  );
  form.set("UsAppToPersonUsecase", "CUSTOMER_CARE");
  form.set("HasEmbeddedLinks", "false");
  form.set("HasEmbeddedPhone", "false");
  for (const s of samples) form.append("MessageSamples", s);

  try {
    const camp = await twilioRequest<{ sid: string }>(
      cfg,
      "messaging",
      `/v1/Services/${mgSid}/Compliance/Usa2p`,
      { method: "POST", body: form.toString() },
    );
    return { campaignSid: camp.sid, skipped: false };
  } catch (e) {
    return { campaignSid: null, skipped: true, reason: String((e as Error).message) };
  }
}

async function pollAndUpdate(
  cfg: ReturnType<typeof cfgOrThrow>,
  admin: ReturnType<typeof createClient>,
  practiceId: string,
) {
  const { data: p } = await admin
    .from("practices")
    .select("*")
    .eq("id", practiceId)
    .maybeSingle();
  if (!p) return null;

  let brandStatus = mapA2pStatus(p.a2p_brand_status);
  let campaignStatus = mapA2pStatus(p.a2p_campaign_status);
  let failureReason = p.a2p_failure_reason as string | null;

  if (p.twilio_brand_sid) {
    try {
      const brand = await twilioRequest<{ status: string; failure_reason?: string }>(
        cfg,
        "messaging",
        `/v1/a2p/BrandRegistrations/${p.twilio_brand_sid}`,
        { method: "GET" },
      );
      brandStatus = mapA2pStatus(brand.status);
      if (brandStatus === "failed" && brand.failure_reason) failureReason = brand.failure_reason;
    } catch { /* keep stored status */ }
  }

  if (p.twilio_campaign_sid && p.twilio_messaging_service_sid) {
    try {
      const camp = await twilioRequest<{ campaign_status: string; errors?: Array<{ description: string }> }>(
        cfg,
        "messaging",
        `/v1/Services/${p.twilio_messaging_service_sid}/Compliance/Usa2p/${p.twilio_campaign_sid}`,
        { method: "GET" },
      );
      campaignStatus = mapA2pStatus(camp.campaign_status);
      if (campaignStatus === "failed" && camp.errors?.[0]?.description) {
        failureReason = camp.errors[0].description;
      }
    } catch { /* keep stored status */ }
  }

  const approved = brandStatus === "approved" && campaignStatus === "approved";
  const patch: Record<string, unknown> = {
    a2p_brand_status: brandStatus,
    a2p_campaign_status: campaignStatus,
    a2p_failure_reason: failureReason,
    sms_enabled: approved,
  };

  await admin.from("practices").update(patch).eq("id", practiceId);
  return { brandStatus, campaignStatus, failureReason, sms_enabled: approved };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const cfg = cfgOrThrow();
    const body = await req.json() as { action?: string; practice_id?: string; business?: A2PBusiness };
    const action = String(body.action || "register");
    const practiceId = String(body.practice_id || "");
    if (!practiceId) return json({ error: "practice_id required" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const access = await verifyAccess(req, practiceId, admin);
    if (!access.ok) return json({ error: access.error }, access.status);

    if (action === "poll-status") {
      const result = await pollAndUpdate(cfg, admin, practiceId);
      return json({ ok: true, ...result });
    }

    if (action === "register" || action === "register-brand") {
      const { data: practice } = await admin.from("practices").select("*").eq("id", practiceId).maybeSingle();
      if (!practice?.twilio_phone_number) {
        return json({ error: "Purchase a phone number before A2P registration." }, 400);
      }

      const biz: A2PBusiness = {
        ...(practice.a2p_config as A2PBusiness || {}),
        ...(body.business || {}),
        legal_name: body.business?.legal_name || (practice.a2p_config as A2PBusiness)?.legal_name || practice.name,
        contact_email: body.business?.contact_email || (practice.a2p_config as A2PBusiness)?.contact_email ||
          practice.email,
        contact_phone: body.business?.contact_phone || (practice.a2p_config as A2PBusiness)?.contact_phone ||
          practice.phone,
        address_street: body.business?.address_street || (practice.a2p_config as A2PBusiness)?.address_street ||
          practice.address,
      };

      const hadFailure = practice.a2p_brand_status === "failed" ||
        practice.a2p_campaign_status === "failed";
      const brandAlreadyApproved = practice.a2p_brand_status === "approved" &&
        Boolean(practice.twilio_brand_sid);
      const campaignOnly = brandAlreadyApproved && !practice.twilio_campaign_sid;
      const trustHubExisting = trustHubForResubmit(
        trustHubFromConfig(practice.a2p_config),
        practice.a2p_brand_status,
        practice.a2p_campaign_status,
      );
      const nowIso = new Date().toISOString();

      const regPatch: Record<string, unknown> = {
        a2p_submitted_at: nowIso,
        a2p_brand_status: campaignOnly ? "approved" : "pending",
        a2p_campaign_status: "pending",
        a2p_failure_reason: null,
        sms_enabled: false,
      };
      if (hadFailure) {
        regPatch.twilio_brand_sid = null;
        regPatch.twilio_campaign_sid = null;
      }
      await admin.from("practices").update(regPatch).eq("id", practiceId);

      const mgSid = await ensureMessagingService(
        cfg,
        admin,
        practiceId,
        practice.name || "Practice",
        practice.twilio_phone_sid,
      );

      const notes: string[] = [];

      // Brand already approved — only attach a campaign to the messaging service.
      if (campaignOnly && practice.twilio_brand_sid) {
        await admin.from("practices").update({
          a2p_config: mergeA2pConfig(practice.a2p_config, biz, trustHubExisting),
        }).eq("id", practiceId);

        const campResult = await submitCampaign(cfg, mgSid!, practice.twilio_brand_sid, biz);
        if (campResult.campaignSid) {
          await admin.from("practices").update({ twilio_campaign_sid: campResult.campaignSid }).eq("id", practiceId);
        } else if (campResult.reason) {
          notes.push(`Campaign: ${campResult.reason}`);
          await admin.from("practices").update({
            a2p_failure_reason: campResult.reason,
            a2p_campaign_status: "unregistered",
          }).eq("id", practiceId);
        }

        const polled = await pollAndUpdate(cfg, admin, practiceId);
        return json({
          ok: !campResult.reason,
          campaign_only: true,
          messaging_service_sid: mgSid,
          brand_sid: practice.twilio_brand_sid,
          campaign_sid: campResult.campaignSid,
          notes,
          status: polled,
        });
      }

      if (a2pDevAutoApprove()) {
        await admin.from("practices").update({
          a2p_config: mergeA2pConfig(practice.a2p_config, biz, trustHubExisting),
          a2p_brand_status: "approved",
          a2p_campaign_status: "approved",
          sms_enabled: true,
        }).eq("id", practiceId);
        return json({
          ok: true,
          dev_auto_approve: true,
          messaging_service_sid: mgSid,
          message: "A2P auto-approved for local development.",
        });
      }

      const bundles = await ensureA2pTrustHubBundles(
        cfg,
        practiceId,
        practice.name || "Practice",
        biz,
        practice.address,
        trustHubExisting,
      );

      if (!bundles.ok) {
        const legacy = Deno.env.get("TWILIO_A2P_BUNDLE_SID");
        const hint = legacy
          ? "TWILIO_A2P_BUNDLE_SID alone is not enough — set TWILIO_CUSTOMER_PROFILE_BUNDLE_SID and TWILIO_A2P_PROFILE_BUNDLE_SID, or configure Trust Hub secrets."
          : "";
        await admin.from("practices").update({
          a2p_config: mergeA2pConfig(practice.a2p_config, biz, trustHubExisting),
          a2p_failure_reason: [bundles.reason, hint].filter(Boolean).join(" "),
        }).eq("id", practiceId);
        return json({ ok: false, error: bundles.reason, notes: hint ? [hint] : [] }, 400);
      }

      await admin.from("practices").update({
        a2p_config: mergeA2pConfig(practice.a2p_config, biz, bundles.trustHub),
      }).eq("id", practiceId);

      const brandResult = await submitBrand(
        cfg,
        bundles.customerProfileBundleSid,
        bundles.a2pProfileBundleSid,
        biz,
      );

      let brandSid = brandResult.brandSid ||
        (practice.a2p_brand_status === "approved" ? practice.twilio_brand_sid : null);
      if (brandResult.skipped && brandResult.reason) notes.push(`Brand: ${brandResult.reason}`);

      if (brandSid) {
        await admin.from("practices").update({ twilio_brand_sid: brandSid }).eq("id", practiceId);
        const campResult = await submitCampaign(cfg, mgSid!, brandSid, biz);
        if (campResult.campaignSid) {
          await admin.from("practices").update({ twilio_campaign_sid: campResult.campaignSid }).eq("id", practiceId);
        } else if (campResult.reason) {
          notes.push(`Campaign: ${campResult.reason}`);
        }
      }

      if (notes.length) {
        await admin.from("practices").update({ a2p_failure_reason: notes.join(" | ") }).eq("id", practiceId);
      }

      const polled = await pollAndUpdate(cfg, admin, practiceId);
      return json({
        ok: true,
        messaging_service_sid: mgSid,
        brand_sid: brandSid,
        customer_profile_bundle_sid: bundles.customerProfileBundleSid,
        a2p_profile_bundle_sid: bundles.a2pProfileBundleSid,
        trust_hub: bundles.trustHub,
        preconfigured_bundles: Boolean(preconfiguredA2pBundles()),
        notes,
        status: polled,
      });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    await reportEdgeError("twilio-a2p", e);
    console.error("twilio-a2p error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
