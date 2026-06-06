import { reportEdgeError } from "../_shared/report-error.ts";
// ============================================================================
// transcribe-consult - FAST path. Downloads audio, transcribes (Whisper),
// strips PHI, and saves the consult with status = "transcribed" immediately.
// Returns the consult id so the UI can redirect right away. AI analysis is a
// separate, slower step (analyze-consult) triggered after redirect - so a slow
// or failing AI step can never lose the transcript.
//
// Auth: user JWT (resolves practice) or service-role bearer + practice_id.
// Secret: OPENAI_API_KEY.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { resolveAuth } from "../_shared/auth.ts";
import { stripPHI, transcribeAudioWhisperVerbose, diarizeSegments, formatSegments } from "../_shared/transcription.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BUCKET = "consult-recordings";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const body = await req.json().catch(() => ({}));
    const { ctx, error: authErr } = await resolveAuth(req, body);
    if (authErr || !ctx) return authErr ?? json({ error: "Unauthorized" }, 401);
    const { practiceId } = ctx;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const auditClient = createClient(SUPABASE_URL, SERVICE_KEY);

    // Transcript: text passthrough, or transcribe stored audio into a timestamped,
    // speaker-labeled dialogue (TC vs Patient) so the consult reads as a back-and-forth.
    let deidentified: string | undefined;
    if (typeof body.transcript === "string" && body.transcript.trim()) {
      // Caller supplied raw text - just de-identify it (no timestamps/speakers).
      deidentified = stripPHI(body.transcript);
    } else if (body.audio_path) {
      const openaiKey = Deno.env.get("OPENAI_API_KEY");
      if (!openaiKey) return json({ error: "Transcription is unavailable - OPENAI_API_KEY is not configured." }, 503);
      await admin.storage.createBucket(BUCKET, { public: false }).catch(() => {});
      const { data: file, error: dErr } = await admin.storage.from(BUCKET).download(body.audio_path);
      if (dErr || !file) {
        console.error(`Audio download failed (path=${body.audio_path}):`, dErr?.message);
        return json({ error: `Could not read the uploaded audio from storage (${body.audio_path}).` }, 502);
      }
      try {
        const { text, segments } = await transcribeAudioWhisperVerbose(openaiKey, file as Blob, body.audio_path.split("/").pop());
        if (!text.trim()) {
          return json({ error: "No transcript could be produced - the recording may be empty or unreadable." }, 422);
        }
        // De-identify each segment BEFORE the diarization LLM sees it, so PHI never
        // leaves in the dialogue step. Then label speakers; fall back to plain
        // timestamped lines if diarization fails, so we never lose the transcript.
        const deidentSegments = segments.map((s) => ({ start: s.start, text: stripPHI(s.text) }));
        if (deidentSegments.length) {
          try {
            deidentified = await diarizeSegments(openaiKey, deidentSegments);
          } catch (e) {
            console.warn("Diarization failed, falling back to timestamped lines:", (e as Error)?.message ?? e);
            deidentified = formatSegments(deidentSegments);
          }
        } else {
          deidentified = stripPHI(text);
        }
      } catch (e) {
        const detail = (e as Error)?.message ?? String(e);
        console.error(`Transcription failed (audio_path=${body.audio_path}):`, detail);
        return json({ error: "Transcription failed.", detail }, 502);
      }
    }
    if (!deidentified || !deidentified.trim()) {
      return json({ error: "No transcript could be produced - the recording may be empty or unreadable." }, 422);
    }

    // Save the consult immediately with status "transcribed".
    const record: Record<string, unknown> = {
      practice_id: practiceId,
      status: "transcribed",
      transcript_deidentified: deidentified,
      recording_date: body.recording_date ?? null,
      recording_time: body.recording_time ?? null,
      duration: body.duration ?? null,
    };
    if (body.recording_source) record.recording_source = body.recording_source;
    if (body.appointment_id) record.appointment_id = body.appointment_id;
    const patientName = [body.patient_first_name, body.patient_last_name].filter(Boolean).join(" ").trim();
    if (patientName) record.patient_name = patientName;
    if (body.patient_phone) record.patient_phone = body.patient_phone;
    if (body.patient_email) record.patient_email = body.patient_email;

    let savedId = body.consult_id;
    if (savedId) {
      const { error } = await admin.from("consults").update(record).eq("id", savedId);
      if (error) return json({ error: "Could not save the transcript.", detail: error.message }, 500);
    } else {
      const { data, error } = await admin.from("consults").insert(record).select("id").single();
      if (error) return json({ error: "Could not save the consult.", detail: error.message }, 500);
      savedId = data.id;
    }

    // Back-link the PMS appointment (marks it Recorded).
    if (body.appointment_id) {
      admin.from("pms_appointments").update({ consult_id: savedId }).eq("id", body.appointment_id).then(
        () => {}, (e: unknown) => console.error("appointment back-link failed:", e),
      );
    }

    // Clean up raw audio - we keep only the de-identified transcript.
    if (body.audio_path) admin.storage.from(BUCKET).remove([body.audio_path]).catch(() => {});

    try {
      await auditClient.rpc("log_audit_event", { p_action: "consult.transcribed", p_resource_type: "consult", p_resource_id: savedId, p_ip_address: ip });
    } catch { /* non-blocking */ }

    return json({ consult_id: savedId, status: "transcribed" });
  } catch (e) {
    await reportEdgeError("transcribe-consult", e);
    console.error("transcribe-consult error:", e);
    return json({ error: "Unexpected error while transcribing.", detail: String((e as Error)?.message ?? e) }, 500);
  }
});
