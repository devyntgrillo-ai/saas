// ============================================================================
// twilio-recording-callback - Twilio posts here when a call recording is ready.
// Attaches the recording to the matching call_logs row (by CallSid).
//
// Deploy with --no-verify-jwt (Twilio calls this).
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("ok");
  try {
    const form = await req.formData();
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
