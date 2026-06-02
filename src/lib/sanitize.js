// Strip em/en dashes from AI-generated text before rendering. Mirrors the
// backend sanitizer (supabase/functions/_shared/sanitize.ts) so any text that
// predates the backend fix still renders cleanly in the UI.
export function stripEmDashes(text) {
  if (typeof text !== 'string') return text
  return text.replace(/—/g, '-').replace(/–/g, '-')
}
