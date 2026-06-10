// Shared Whisper transcription + PHI stripping (used by transcribe-consult
// and transcribe-call-log).

export function stripPHI(input: string): string {
  if (!input) return "";
  let t = input;
  t = t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[EMAIL]");
  t = t.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[SSN]");
  t = t.replace(/\b(?:born|dob|date of birth)[:\s]+\S+/gi, "[DOB]");
  t = t.replace(/\b(0?[1-9]|1[0-2])[\/\-.](0?[1-9]|[12]\d|3[01])[\/\-.](?:19|20)\d{2}\b/g, "[DOB]");
  t = t.replace(
    /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+(?:19|20)\d{2}\b/gi,
    "[DOB]",
  );
  t = t.replace(/(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}\b/g, "[PHONE]");
  t = t.replace(
    /\b\d{1,6}\s+(?:[A-Za-z0-9.'\-]+\s){1,4}(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl|Terrace|Ter|Circle|Cir|Highway|Hwy|Parkway|Pkwy|Suite|Ste|Apartment|Apt|Unit)\b\.?/gi,
    "[ADDRESS]",
  );
  t = t.replace(/\b(?:Mr|Mrs|Ms|Dr|Miss|Prof)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/g, "[NAME]");
  return t;
}

export async function transcribeAudioWhisper(apiKey: string, blob: Blob, filename = "recording.mp3"): Promise<string> {
  const form = new FormData();
  form.append("file", blob, filename);
  form.append("model", "whisper-1");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const rawBody = await res.text();
  if (!res.ok) {
    let detail = rawBody;
    try {
      const err = JSON.parse(rawBody)?.error;
      if (err) detail = `${err.type ?? "error"}${err.code ? ` (${err.code})` : ""}: ${err.message ?? rawBody}`;
    } catch { /* not JSON */ }
    console.error(`Whisper API error - status=${res.status}; file=${filename}; size=${blob.size}B; body=${rawBody}`);
    throw new Error(`Whisper transcription failed (${res.status}): ${detail}`);
  }
  try {
    return JSON.parse(rawBody).text ?? "";
  } catch {
    throw new Error("Whisper returned an unparseable response body.");
  }
}

export interface TranscriptSegment {
  start: number;
  text: string;
}

// Like transcribeAudioWhisper, but asks Whisper for verbose_json with per-segment
// timestamps so we can render the consult as a timestamped, turn-by-turn dialogue.
export async function transcribeAudioWhisperVerbose(
  apiKey: string,
  blob: Blob,
  filename = "recording.mp3",
): Promise<{ text: string; segments: TranscriptSegment[] }> {
  const form = new FormData();
  form.append("file", blob, filename);
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const rawBody = await res.text();
  if (!res.ok) {
    let detail = rawBody;
    try {
      const err = JSON.parse(rawBody)?.error;
      if (err) detail = `${err.type ?? "error"}${err.code ? ` (${err.code})` : ""}: ${err.message ?? rawBody}`;
    } catch { /* not JSON */ }
    console.error(`Whisper API error - status=${res.status}; file=${filename}; size=${blob.size}B; body=${rawBody}`);
    throw new Error(`Whisper transcription failed (${res.status}): ${detail}`);
  }
  try {
    const parsed = JSON.parse(rawBody);
    const segments: TranscriptSegment[] = Array.isArray(parsed.segments)
      ? parsed.segments
          .map((s: { start?: number; text?: string }) => ({ start: Number(s.start) || 0, text: String(s.text || "").trim() }))
          .filter((s: TranscriptSegment) => s.text)
      : [];
    return { text: parsed.text ?? "", segments };
  } catch {
    throw new Error("Whisper returned an unparseable response body.");
  }
}

function mmss(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Non-AI fallback: render segments as timestamped lines (no speaker labels).
export function formatSegments(segments: TranscriptSegment[]): string {
  return segments.map((s) => `[${mmss(s.start)}] ${s.text}`).join("\n");
}

// Use a cheap LLM pass to turn timestamped segments into a two-speaker dialogue
// (TC vs Patient), one line per turn, formatted "[TC] m:ss, text". Input should
// already be de-identified. Throws on any failure so callers can fall back to
// formatSegments().
export async function diarizeSegments(apiKey: string, segments: TranscriptSegment[]): Promise<string> {
  if (!segments.length) return "";
  const numbered = segments.map((s, i) => `${i}\t${mmss(s.start)}\t${s.text}`).join("\n");
  const system =
    "You format a dental treatment-consultation transcript into a readable two-speaker dialogue. " +
    'The speakers are the treatment coordinator/clinician ("TC") and the "Patient". Decide, from the content, ' +
    "who is speaking in each segment: the TC explains treatment, cost, financing, and scheduling and asks qualifying " +
    "questions; the Patient asks questions and raises concerns or objections. Merge consecutive segments from the same " +
    "speaker into a single turn, using the timestamp of that turn's first segment. Output ONLY the dialogue, one line " +
    "per turn, in EXACTLY this format with no extra commentary:\n[TC] m:ss, text\n[Patient] m:ss, text\n" +
    "Keep the wording verbatim. Never use em dashes inside the spoken text; use commas or periods instead.";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: `Segments (index, timestamp, text):\n${numbered}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Diarization failed (${res.status})`);
  const out = (await res.json())?.choices?.[0]?.message?.content?.trim();
  if (!out) throw new Error("Diarization returned empty content.");
  return out;
}

/** Download a Twilio recording (.mp3 URL) using API key auth. */
export async function downloadTwilioRecording(recordingUrl: string): Promise<Blob> {
  const sid = Deno.env.get("TWILIO_API_KEY_SID");
  const secret = Deno.env.get("TWILIO_API_KEY_SECRET");
  if (!sid || !secret) throw new Error("Twilio API key not configured");
  const res = await fetch(recordingUrl, {
    headers: { Authorization: `Basic ${btoa(`${sid}:${secret}`)}` },
  });
  if (!res.ok) throw new Error(`Twilio media download failed (${res.status})`);
  return await res.blob();
}
