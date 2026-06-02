// ============================================================================
// twilio-a2p — A2P 10DLC brand + campaign registration per practice.
// Actions: register, poll-status, webhook
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import {
  a2pDevAutoApprove,
  cfgOrThrow,
  inboundWebhookUrl,
  mapA2pStatus,
  twilioRequest,
} from "../_shared/twilio-api.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

interface A2PBusiness {
  legal_name?: string;
  business_type?: string;
  ein?: string;
  website?: string;
  contact_first?: string;
  contact_last?: string;
  contact_email?: string;
  contact_phone?: string;
  use_case?: string;
  message_samples?: string[];
  opt_in_description?: string;
}

const DEFAULT_SAMPLES = [
  "Hi [name], following up on your implant consult. Any questions about your treatment plan? Reply STOP to opt out.",
  "Hi [name], just checking in after your visit. Happy to help schedule your next step. Reply STOP to opt out.",
];

async function verifyAccess(req: Request, practiceId: string, admin: ReturnType<typeof createClient>) {
  const authHeader = req.headers.get("Authorization") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (authHeader.replace(/^Bearer\s+/i, "") === serviceKey) return { ok: true as const };

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
  const inbound = inboundWebhookUrl();

  if (!mgSid) {
    const form = new URLSearchParams();
    form.set("FriendlyName", `Hope AI - ${practiceName}`.slice(0, 64));
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
      // Already attached is fine
      const msg = String((e as Error).message || "");
      if (!msg.includes("21710") && !msg.toLowerCase().includes("already")) console.warn("attach phone:", msg);
    }
  }

  return mgSid;
}

async function submitBrand(
  cfg: ReturnType<typeof cfgOrThrow>,
  biz: A2PBusiness,
): Promise<{ brandSid: string | null; skipped: boolean; reason?: string }> {
  const bundleSid = Deno.env.get("TWILIO_A2P_BUNDLE_SID") || Deno.env.get("TWILIO_CUSTOMER_PROFILE_BUNDLE_SID");
  if (!bundleSid) {
    return {
      brandSid: null,
      skipped: true,
      reason: "TWILIO_A2P_BUNDLE_SID not configured — registration queued for manual Trust Hub setup.",
    };
  }

  const brandType = (biz.business_type || "").toLowerCase().includes("sole") ? "SOLE_PROPRIETOR" : "STANDARD";
  const form = new URLSearchParams();
  form.set("CustomerProfileBundleSid", bundleSid);
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
  const samples = (biz.message_samples?.length ? biz.message_samples : DEFAULT_SAMPLES).slice(0, 5);
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

      const biz: A2PBusiness = { ...(practice.a2p_config as A2PBusiness || {}), ...(body.business || {}) };
      const nowIso = new Date().toISOString();

      await admin.from("practices").update({
        a2p_config: biz,
        a2p_submitted_at: nowIso,
        a2p_brand_status: "pending",
        a2p_campaign_status: "pending",
        a2p_failure_reason: null,
        sms_enabled: false,
      }).eq("id", practiceId);

      const mgSid = await ensureMessagingService(
        cfg,
        admin,
        practiceId,
        practice.name || "Practice",
        practice.twilio_phone_sid,
      );

      const brandResult = await submitBrand(cfg, biz);
      let brandSid = brandResult.brandSid;
      let notes: string[] = [];
      if (brandResult.skipped && brandResult.reason) notes.push(brandResult.reason);

      if (a2pDevAutoApprove()) {
        await admin.from("practices").update({
          a2p_brand_status: "approved",
          a2p_campaign_status: "approved",
          sms_enabled: true,
          a2p_failure_reason: notes.length ? notes.join(" ") : null,
        }).eq("id", practiceId);
        return json({
          ok: true,
          dev_auto_approve: true,
          messaging_service_sid: mgSid,
          message: "A2P auto-approved for local development.",
        });
      }

      if (brandSid) {
        await admin.from("practices").update({ twilio_brand_sid: brandSid }).eq("id", practiceId);
        const campResult = await submitCampaign(cfg, mgSid!, brandSid, biz);
        if (campResult.campaignSid) {
          await admin.from("practices").update({ twilio_campaign_sid: campResult.campaignSid }).eq("id", practiceId);
        } else if (campResult.reason) {
          notes.push(campResult.reason);
          await admin.from("practices").update({ a2p_failure_reason: notes.join(" | ") }).eq("id", practiceId);
        }
      } else {
        await admin.from("practices").update({
          a2p_failure_reason: notes.join(" | ") || "Awaiting Trust Hub bundle configuration.",
        }).eq("id", practiceId);
      }

      const polled = await pollAndUpdate(cfg, admin, practiceId);
      return json({
        ok: true,
        messaging_service_sid: mgSid,
        brand_sid: brandSid,
        notes,
        status: polled,
      });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("twilio-a2p error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
