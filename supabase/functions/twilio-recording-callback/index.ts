// ============================================================================
// twilio-recording-callback - Twilio posts here when a call recording is ready.
// Attaches the recording to the matching call_logs row (by CallSid).
//
// Deploy with --no-verify-jwt (Twilio calls this).
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import {
  formDataToRecord,
  getTwilioConfig,
  twilioWebhookUrl,
  validateTwilioSignature,
} from "../_shared/twilio.ts";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("ok");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return new Response("", { status: 204 });
  }

  // Twilio signature verification — mirrors twilio-inbound guard.
  const cfg = getTwilioConfig();
  const publicBase = Deno.env.get("TWILIO_WEBHOOK_BASE_URL") || cfg?.webhookBase || null;
  if (cfg?.authToken) {
    const sig = req.headers.get("X-Twilio-Signature") || "";
    if (sig) {
      const url = twilioWebhookUrl(req, publicBase, "twilio-recording-callback");
      const params = formDataToRecord(form);
      const valid = await validateTwilioSignature(cfg.authToken, sig, url, params);
      if (!valid) {
        console.warn("twilio-recording-callback: invalid Twilio signature");
        return new Response("Forbidden", { status: 403 });
      }
    }
  }

  try {
    const callSid = String(form.get("CallSid") || "").trim();
    const recordingUrl = String(form.get("RecordingUrl") || "").trim();
    const recordingSid = String(form.get("RecordingSid") || "").trim();
    const recordingDuration = Number(form.get("RecordingDuration") || 0) || null;

    if (callSid && recordingUrl) {
      const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      // .mp3 is directly playable; the raw RecordingUrl needs Twilio auth either way.
      await admin.from("call_logs").update({
        recording_url: `${recordingUrl}.mp3`,
        recording_sid: recordingSid || null,
        recording_duration: recordingDuration,
        status: "completed",
        ended_at: new Date().toISOString(),
      }).eq("twilio_call_sid", callSid);
    }
    return new Response("", { status: 204 });
  } catch (e) {
    console.error("twilio-recording-callback error:", e);
    return new Response("", { status: 204 }); // always ack so Twilio doesn't retry-storm
  }
});
