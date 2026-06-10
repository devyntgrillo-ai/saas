// Shared text sanitizer for AI-generated output. Em dashes (-) and en dashes (-)
// are replaced with a regular hyphen so they never reach the database or the UI.
// Call this on every AI-produced string before persisting it.
export function sanitizeAIOutput(text: string): string {
  if (typeof text !== "string") return text;
  return text.replace(/, /g, "-").replace(/–/g, "-");
}
