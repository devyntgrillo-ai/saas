import { reportEdgeError } from "../_shared/report-error.ts";
// ============================================================================
// twilio-provision, search & purchase US local SMS numbers per practice.
// Actions: search-numbers, purchase-number, get-status
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import {
  cfgOrThrow,
  inboundVoiceWebhookUrlForPractice,
  inboundWebhookUrlForPractice,
  twilioRequest,
} from "../_shared/twilio-api.ts";
import { toE164 } from "../_shared/twilio.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function verifyPracticeAccess(
  req: Request,
  practiceId: string,
  admin: ReturnType<typeof createClient>,
): Promise<{ ok: boolean; status: number; error?: string }> {
  const authHeader = req.headers.get("Authorization") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (authHeader.replace(/^Bearer\s+/i, "") === serviceKey) return { ok: true, status: 200 };

  if (!authHeader) return { ok: false, status: 401, error: "Unauthorized" };

  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return { ok: false, status: 401, error: "Unauthorized" };

  const { data: prof } = await userClient.from("users").select("practice_id, role").eq("id", user.id).maybeSingle();
  if (prof?.practice_id === practiceId) return { ok: true, status: 200 };

  if (prof?.role === "agency_admin" || prof?.role === "agency_owner") {
    const { data: pr } = await admin.from("practices").select("id").eq("id", practiceId).maybeSingle();
    if (pr) return { ok: true, status: 200 };
  }

  return { ok: false, status: 403, error: "Forbidden" };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const cfg = cfgOrThrow();
    const body = await req.json() as {
      action?: string;
      practice_id?: string;
      area_code?: string;
      phone_number?: string;
    };
    const action = String(body.action || "");
    const practiceId = String(body.practice_id || "");
    if (!practiceId) return json({ error: "practice_id required" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const access = await verifyPracticeAccess(req, practiceId, admin);
    if (!access.ok) return json({ error: access.error }, access.status);

    if (action === "get-status") {
      const { data: p } = await admin
        .from("practices")
        .select("twilio_phone_number, twilio_phone_e164, a2p_brand_status, a2p_campaign_status, a2p_failure_reason, sms_enabled")
        .eq("id", practiceId)
        .maybeSingle();
      return json({ ok: true, practice: p });
    }

    if (action === "sync-inbound-webhook") {
      const { data: p } = await admin
        .from("practices")
        .select("twilio_phone_sid, twilio_phone_number")
        .eq("id", practiceId)
        .maybeSingle();
      if (!p?.twilio_phone_sid) {
        return json({ error: "No Twilio number on file. Purchase a number first." }, 400);
      }
      const smsUrl = inboundWebhookUrlForPractice(practiceId);
      const voiceUrl = inboundVoiceWebhookUrlForPractice(practiceId);
      if (!smsUrl || !voiceUrl) {
        return json({ error: "TWILIO_WEBHOOK_BASE_URL is not set for this environment." }, 503);
      }
      const form = new URLSearchParams();
      form.set("SmsUrl", smsUrl);
      form.set("SmsMethod", "POST");
      form.set("VoiceUrl", voiceUrl);
      form.set("VoiceMethod", "POST");
      await twilioRequest(
        cfg,
        "api",
        `/Accounts/${cfg.accountSid}/IncomingPhoneNumbers/${p.twilio_phone_sid}.json`,
        { method: "POST", body: form.toString() },
      );
      if (p.twilio_phone_number) {
        await admin.from("practices").update({
          twilio_phone_e164: toE164(p.twilio_phone_number),
        }).eq("id", practiceId);
      }
      return json({ ok: true, sms_url: smsUrl, voice_url: voiceUrl });
    }

    if (action === "search-numbers") {
      const ac = String(body.area_code || "").replace(/\D/g, "").slice(0, 3);
      if (ac.length !== 3) return json({ error: "Valid 3-digit US area code required" }, 400);

      const data = await twilioRequest<{ available_phone_numbers: Array<Record<string, string>> }>(
        cfg,
        "api",
        `/Accounts/${cfg.accountSid}/AvailablePhoneNumbers/US/Local.json?SmsEnabled=true&AreaCode=${ac}&PageSize=12`,
        { method: "GET" },
      );

      const numbers = (data.available_phone_numbers || []).map((n) => ({
        phone_number: n.phone_number,
        friendly_name: n.friendly_name || n.phone_number,
        locality: n.locality || "",
        region: n.region || "",
      }));

      return json({ ok: true, numbers });
    }

    if (action === "purchase-number") {
      const phone = toE164(String(body.phone_number || ""));
      if (!phone) return json({ error: "phone_number required" }, 400);

      const smsUrl = inboundWebhookUrlForPractice(practiceId);
      const voiceUrl = inboundVoiceWebhookUrlForPractice(practiceId);
      const form = new URLSearchParams();
      form.set("PhoneNumber", phone);
      if (smsUrl) {
        form.set("SmsUrl", smsUrl);
        form.set("SmsMethod", "POST");
      }
      if (voiceUrl) {
        form.set("VoiceUrl", voiceUrl);
        form.set("VoiceMethod", "POST");
      }

      const purchased = await twilioRequest<Record<string, string>>(
        cfg,
        "api",
        `/Accounts/${cfg.accountSid}/IncomingPhoneNumbers.json`,
        { method: "POST", body: form.toString() },
      );

      const phoneSid = purchased.sid || null;
      const nowIso = new Date().toISOString();

      await admin.from("practices").update({
        twilio_phone_number: purchased.phone_number || phone,
        twilio_phone_e164: toE164(purchased.phone_number || phone),
        twilio_phone_sid: phoneSid,
        sms_enabled: false,
        a2p_brand_status: "unregistered",
        a2p_campaign_status: "unregistered",
        a2p_failure_reason: null,
      }).eq("id", practiceId);

      return json({
        ok: true,
        phone_number: purchased.phone_number || phone,
        phone_sid: phoneSid,
        message: "Number purchased. Complete A2P registration to enable outbound SMS.",
        purchased_at: nowIso,
      });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    await reportEdgeError("twilio-provision", e);
    console.error("twilio-provision error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
