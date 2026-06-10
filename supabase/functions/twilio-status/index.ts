import { reportEdgeError } from "../_shared/report-error.ts";
// ============================================================================
// twilio-status - Twilio delivery status callback for outbound SMS.
// Updates conversation_messages.meta.delivery_status by MessageSid.
//
// Deploy with verify_jwt=false (see config.toml).
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { formDataToRecord, getTwilioConfig, twilioWebhookUrl, validateTwilioSignature } from "../_shared/twilio.ts";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response(null, { status: 204 });

  try {
    const form = await req.formData();
    const params = formDataToRecord(form);
    const messageSid = String(params.MessageSid || "").trim();
    const messageStatus = String(params.MessageStatus || params.SmsStatus || "").trim();

    if (!messageSid) return new Response(null, { status: 204 });

    const cfg = getTwilioConfig();
    const publicBase = Deno.env.get("TWILIO_WEBHOOK_BASE_URL") || cfg?.webhookBase || null;
    if (cfg?.authToken && req.headers.get("X-Twilio-Signature")) {
      const sig = req.headers.get("X-Twilio-Signature") || "";
      const valid = await validateTwilioSignature(cfg.authToken, sig, twilioWebhookUrl(req, publicBase, "twilio-status"), params);
      if (!valid) return new Response("Forbidden", { status: 403 });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: rows } = await admin
      .from("conversation_messages")
      .select("id, meta")
      .filter("meta->>twilio_message_sid", "eq", messageSid)
      .limit(1);

    const row = rows?.[0];
    if (row) {
      const meta = (row.meta && typeof row.meta === "object" ? row.meta : {}) as Record<string, unknown>;
      await admin.from("conversation_messages").update({
        meta: { ...meta, delivery_status: messageStatus || meta.delivery_status },
      }).eq("id", row.id);
    }

    return new Response(null, { status: 204 });
  } catch (e) {
    await reportEdgeError("twilio-status", e);
    console.error("twilio-status error:", e);
    return new Response(null, { status: 204 });
  }
});
