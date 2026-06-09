// Shared PHI-minimization helpers for edge functions.
//
// Patient identifiers must never leave the system in low-trust sinks (Slack,
// error webhooks, logs). Use these to reduce a name to initials and to scrub
// free-text (error messages) of emails/phone numbers before forwarding.

// "Robert Maxwell" -> "R.M.", "Robert" -> "R.", "" / "A patient" -> "a patient".
// Accepts an already-composed name; callers join first/last before passing.
export function patientInitials(name?: string | null): string {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  const letters = parts
    .map((p) => p[0])
    .filter((c) => c && /[A-Za-z]/.test(c))
    .map((c) => c!.toUpperCase());
  return letters.length ? letters.join(".") + "." : "a patient";
}

// Scrub email addresses and phone numbers from free text (e.g. an error
// message or stack trace) before it is sent to Slack/logs. Defense-in-depth:
// even if a throw site interpolates patient contact info, it won't leak.
export function redactPhi(text?: string | null): string {
  if (!text) return String(text ?? "");
  return String(text)
    // Emails first, so the local/domain parts aren't partially matched below.
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email redacted]")
    // Phone-like runs: optional +, then 7+ digits possibly broken by spaces,
    // dashes, dots, or parentheses.
    .replace(/\+?\d(?:[\d\s().-]{5,})\d/g, "[phone redacted]");
}
