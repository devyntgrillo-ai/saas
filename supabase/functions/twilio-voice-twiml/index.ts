// ============================================================================
// twilio-voice-twiml - the TwiML App Voice webhook. When the browser dialer
// places a call, Twilio hits this URL; we return TwiML that dials the patient
// from the practice's caller ID and records the call (dual channel). We also
// insert a call_logs row keyed by the Twilio CallSid so the recording callback
// and the dialer UI can fill it in.
//
// Deploy with --no-verify-jwt (Twilio calls this, no Supabase JWT).
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TWILIO_CALLER_ID (fallback).
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const xml = (body: string) => new Response(`<?xml version="1.0" encoding="UTF-8"?>${body}`, { headers: { "Content-Type": "text/xml" } });
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return xml("<Response><Reject/></Response>");
  try {
    const form = await req.formData();
    const to = String(form.get("To") || "").trim();
    const practiceId = String(form.get("practice_id") || "").trim();
    const consultId = String(form.get("consult_id") || "").trim();
    const callSid = String(form.get("CallSid") || "").trim();

    if (!to) return xml("<Response><Say>No number to dial.</Say></Response>");

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Caller ID: the practice's own Twilio number, else the platform fallback.
    let callerId = Deno.env.get("TWILIO_CALLER_ID") || "";
    if (practiceId) {
      const { data: pr } = await admin.from("practices").select("twilio_phone_number").eq("id", practiceId).maybeSingle();
      if (pr?.twilio_phone_number) callerId = pr.twilio_phone_number;
    }
    if (!callerId) return xml("<Response><Say>No caller ID is configured for this practice.</Say></Response>");

    // Log the call (keyed by CallSid) so the recording callback can attach to it.
    if (callSid && practiceId) {
      await admin.from("call_logs").upsert({
        twilio_call_sid: callSid,
        practice_id: practiceId,
        consult_id: consultId || null,
        direction: "outbound",
        to_number: to,
        from_number: callerId,
        status: "in_progress",
        started_at: new Date().toISOString(),
      }, { onConflict: "twilio_call_sid" }).then(() => {}, (e: unknown) => console.error("call_logs insert failed:", e));
    }

    const base = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
    const recCb = `${base}/functions/v1/twilio-recording-callback`;

    // Recording disclosure (default on; set TWILIO_RECORDING_DISCLOSURE=false to
    // disable, or override the wording with TWILIO_RECORDING_DISCLOSURE_TEXT).
    // Played to the caller at session start. NOTE: this announces to the TC, not
    // the patient - true two-party (callee) consent needs a whisper/conference
    // flow; see TWILIO_VOICE_SETUP.md.
    const discOff = (Deno.env.get("TWILIO_RECORDING_DISCLOSURE") || "").toLowerCase() === "false";
    const discText = Deno.env.get("TWILIO_RECORDING_DISCLOSURE_TEXT")
      || "This call will be recorded for quality and training purposes.";
    const say = discOff ? "" : `<Say voice="Polly.Joanna">${esc(discText)}</Say>`;

    // answerOnBridge so the caller hears ringback; dual-channel recording from answer.
    return xml(
      `<Response>${say}<Dial callerId="${esc(callerId)}" answerOnBridge="true" record="record-from-answer-dual"` +
      ` recordingStatusCallback="${esc(recCb)}" recordingStatusCallbackEvent="completed">` +
      `<Number>${esc(to)}</Number></Dial></Response>`,
    );
  } catch (e) {
    console.error("twilio-voice-twiml error:", e);
    return xml("<Response><Say>An error occurred placing your call.</Say></Response>");
  }
});
