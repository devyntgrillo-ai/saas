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
