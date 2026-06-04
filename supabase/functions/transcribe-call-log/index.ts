// ============================================================================
// transcribe-call-log - Whisper + PHI strip for a Twilio call_logs recording.
// Invoked by twilio-recording-callback (service role) after a recording lands.
//
// Auth: service-role bearer + practice_id + call_log_id in body.
// Secrets: OPENAI_API_KEY, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { downloadTwilioRecording, stripPHI, transcribeAudioWhisper } from "../_shared/transcription.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MIN_RECORDING_SEC = 2;

function requireServiceRole(req: Request): Response | undefined {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Forbidden: service_role required" }, 403);
  const envKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (envKey && token === envKey) return undefined;
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (payload.role === "service_role") return undefined;
  } catch { /* fall through */ }
  return json({ error: "Forbidden: service_role required" }, 403);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const denied = requireServiceRole(req);
  if (denied) return denied;

  let callLogId = "";
  try {
    const body = await req.json().catch(() => ({}));
    callLogId = String(body.call_log_id || "").trim();
    const practiceId = String(body.practice_id || "").trim();
    if (!callLogId || !practiceId) return json({ error: "call_log_id and practice_id are required" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: row, error: fetchErr } = await admin
      .from("call_logs")
      .select("id, practice_id, recording_url, recording_duration, transcript_status, transcript_deidentified")
      .eq("id", callLogId)
      .maybeSingle();

    if (fetchErr) return json({ error: fetchErr.message }, 500);
    if (!row || row.practice_id !== practiceId) return json({ error: "Call log not found" }, 404);
    if (row.transcript_status === "transcribed" && row.transcript_deidentified) {
      return json({ ok: true, call_log_id: callLogId, status: "transcribed", skipped: true });
    }
    if (!row.recording_url) return json({ error: "No recording URL on this call" }, 422);

    const dur = Number(row.recording_duration) || 0;
    if (dur > 0 && dur < MIN_RECORDING_SEC) {
      await admin.from("call_logs").update({
        transcript_status: "skipped",
        transcript_error: "Recording too short to transcribe",
      }).eq("id", callLogId);
      return json({ ok: true, call_log_id: callLogId, status: "skipped" });
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) return json({ error: "OPENAI_API_KEY is not configured" }, 503);

    await admin.from("call_logs").update({ transcript_status: "pending", transcript_error: null }).eq("id", callLogId);

    const blob = await downloadTwilioRecording(row.recording_url);
    const raw = await transcribeAudioWhisper(openaiKey, blob, "call-recording.mp3");
    if (!raw.trim()) {
      await admin.from("call_logs").update({
        transcript_status: "failed",
        transcript_error: "Empty transcript",
      }).eq("id", callLogId);
      return json({ error: "Empty transcript" }, 422);
    }

    const deidentified = stripPHI(raw);
    await admin.from("call_logs").update({
      transcript_deidentified: deidentified,
      transcript_status: "transcribed",
      transcript_error: null,
    }).eq("id", callLogId);

    return json({ ok: true, call_log_id: callLogId, status: "transcribed" });
  } catch (e) {
    console.error("transcribe-call-log error:", e);
    const detail = String((e as Error)?.message ?? e);
    if (callLogId) {
      try {
        const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        await admin.from("call_logs").update({
          transcript_status: "failed",
          transcript_error: detail.slice(0, 500),
        }).eq("id", callLogId);
      } catch { /* best-effort */ }
    }
    return json({ error: "Transcription failed", detail }, 502);
  }
});
