import { reportEdgeError } from "../_shared/report-error.ts";
// ============================================================================
// doxyme-webhook - inbound webhook fired by Doxy.me when a virtual-consult
// recording is ready. Authenticates by matching the supplied API key to a
// practice (practices.doxyme_api_key), downloads the recording, stores it, then
// runs the normal pipeline: transcribe-consult (Whisper + PHI strip) then
// analyze-consult. Returns 200 quickly.
//
// Deploy with verify_jwt=false (external caller):
//   supabase functions deploy doxyme-webhook --no-verify-jwt --project-ref eymgqjeudrmeofytnwgs
//
// Auth from Doxy.me: send the key as header `x-doxyme-key` (preferred) or
// body `api_key`. Query-param `?key=` was removed to avoid secret leakage
// in proxy logs (audit finding 2).
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-doxyme-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const BUCKET = "consult-recordings";

// deno-lint-ignore no-explicit-any
function findRecordingUrl(p: any): string | null {
  return (
    p?.recording_url || p?.download_url || p?.url ||
    p?.recording?.url || p?.recording?.download_url ||
    p?.data?.recording_url || p?.data?.recording?.url || null
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

    const url = new URL(req.url);
    const payload = await req.json().catch(() => ({}));
    const key = req.headers.get("x-doxyme-key") || payload.api_key;
    if (!key) return json({ error: "Missing Doxy.me API key." }, 401);

    // Authenticate + resolve the practice by stored key.
    // Key is encrypted at rest (pgcrypto); the DB function decrypts and matches.
    const { data: practiceId } = await admin.rpc("match_doxyme_key", { p_key: key });
    if (!practiceId) return json({ error: "Unrecognized Doxy.me API key." }, 403);

    const recUrl = findRecordingUrl(payload);
    if (!recUrl) return json({ error: "No recording URL in payload." }, 422);

    // Download the recording and stage it in storage for the transcriber.
    const audioRes = await fetch(recUrl);
    if (!audioRes.ok) {
      console.error(`Doxy recording download failed (${audioRes.status}) ${recUrl}`);
      return json({ error: "Could not download the Doxy.me recording." }, 502);
    }
    const bytes = new Uint8Array(await audioRes.arrayBuffer());
    const ext = (recUrl.split("?")[0].split(".").pop() || "mp4").toLowerCase().slice(0, 4);
    const stamp = (payload.session_id || payload.id || Math.floor(Date.now() / 1000)).toString().replace(/[^a-z0-9-]/gi, "");
    const path = `${practiceId}/doxyme-${stamp}.${ext}`;
    await admin.storage.createBucket(BUCKET, { public: false }).catch(() => {});
    const contentType = audioRes.headers.get("content-type") || "audio/mp4";
    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
    if (upErr) {
      console.error("Doxy recording upload failed:", upErr.message);
      return json({ error: "Could not stage the recording." }, 502);
    }

    // Run the pipeline. transcribe-consult creates the consult (status
    // 'transcribed'); analyze-consult then fills the analysis + messages.
    const fnHeaders = { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };
    const tRes = await fetch(`${SUPABASE_URL}/functions/v1/transcribe-consult`, {
      method: "POST", headers: fnHeaders,
      body: JSON.stringify({
        practice_id: practiceId, audio_path: path, recording_source: "doxyme",
        patient_first_name: payload.patient_first_name || payload.patient_name || null,
        patient_phone: payload.patient_phone || null,
        patient_email: payload.patient_email || null,
      }),
    });
    const tBody = await tRes.json().catch(() => ({}));
    if (!tRes.ok || !tBody.consult_id) {
      console.error("Doxy -> transcribe-consult failed:", tBody);
      return json({ error: "Transcription step failed.", detail: tBody }, 502);
    }

    // Kick off analysis (fire-and-forget; the detail page also polls/triggers it).
    fetch(`${SUPABASE_URL}/functions/v1/analyze-consult`, {
      method: "POST", headers: fnHeaders,
      body: JSON.stringify({ practice_id: practiceId, consult_id: tBody.consult_id }),
    }).catch((e) => console.error("Doxy -> analyze-consult trigger failed:", e));

    return json({ ok: true, consult_id: tBody.consult_id, status: "analyzing" });
  } catch (e) {
    await reportEdgeError("doxyme-webhook", e);
    console.error("doxyme-webhook error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
