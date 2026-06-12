// Shared text sanitizer for AI-generated output. Em dashes (U+2014) and en
// dashes (U+2013) are replaced with a regular hyphen so they never reach the
// database or the UI. Regular commas, hyphens, and other punctuation are left
// untouched. Call this on every AI-produced string before persisting it.
export function sanitizeAIOutput(text: string): string {
  if (typeof text !== "string") return text;
  return text.replace(/[—–]/g, "-");
}
