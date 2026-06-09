// transcribe-chat-audio - transcribe a voice-memo chat message (Whisper) and
// store the result on the message row. Best-effort; the audio still plays
// without a transcript. Secret: OPENAI_API_KEY.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { transcribeAudioWhisper } from "../_shared/transcription.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false }, 405);
  try {
    const { message_id } = await req.json().catch(() => ({}));
    if (!message_id) return json({ ok: false }, 400);
    const key = Deno.env.get("OPENAI_API_KEY");
    if (!key) return json({ ok: false, reason: "no_key" });

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: m } = await admin
      .from("support_messages")
      .select("id, attachment_url")
      .eq("id", message_id)
      .maybeSingle();
    if (!m?.attachment_url) return json({ ok: false, reason: "no_audio" });

    const res = await fetch(m.attachment_url);
    if (!res.ok) return json({ ok: false, reason: "fetch_failed" });
    const blob = await res.blob();

    const text = await transcribeAudioWhisper(key, blob, "voice.webm");
    await admin.from("support_messages").update({ audio_transcript: (text || "").trim() || null }).eq("id", message_id);
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) });
  }
});
