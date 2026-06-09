// ============================================================================
// Client-side password policy (HIPAA hardening).
//
// Enforces the minimum complexity rules in the signup and password-reset flows:
//   • at least 8 characters
//   • at least one uppercase letter
//   • at least one lowercase letter
//   • at least one number
//   • not on a basic common-password blocklist
//
// This is a UX guardrail only — the authoritative check happens in Supabase Auth
// (config.toml: minimum_password_length + password_requirements). Keep the two in
// sync so the server never rejects a password the UI marked as valid.
// ============================================================================

export const PASSWORD_MIN_LENGTH = 8

// A small blocklist of the most common / trivially-guessed passwords and obvious
// app-specific ones. Lowercased for case-insensitive comparison. This is a basic
// list by design; a production deployment can swap in a larger corpus (e.g. the
// HIBP top-10k) without changing the call sites.
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'p@ssw0rd', 'p@ssword',
  '12345678', '123456789', '1234567890', '123123123', '11111111', '00000000',
  'qwerty', 'qwerty123', 'qwertyuiop', 'asdfghjkl', 'iloveyou', 'admin123',
  'letmein', 'welcome', 'welcome1', 'welcome123', 'abc12345', 'abcd1234',
  'football', 'baseball', 'sunshine', 'princess', 'dragon123', 'monkey123',
  'superman', 'trustno1', 'changeme', 'whatever', 'starwars', 'michael1',
  'caselift', 'caselift1', 'caselift123', 'hopeai123', 'dentist1', 'practice1',
])

/**
 * Evaluate each individual rule. Returns a map of booleans so the UI can render
 * a per-requirement checklist.
 */
export function checkPasswordRules(pw = '') {
  return {
    length: pw.length >= PASSWORD_MIN_LENGTH,
    uppercase: /[A-Z]/.test(pw),
    lowercase: /[a-z]/.test(pw),
    number: /[0-9]/.test(pw),
    // Empty string isn't "common" — it just hasn't been typed yet.
    notCommon: pw.length === 0 || !COMMON_PASSWORDS.has(pw.toLowerCase()),
  }
}

export const PASSWORD_RULE_LABELS = {
  length: `At least ${PASSWORD_MIN_LENGTH} characters`,
  uppercase: 'One uppercase letter',
  lowercase: 'One lowercase letter',
  number: 'One number',
  notCommon: 'Not a common password',
}

/**
 * Validate a password against the full policy.
 * @returns {{ valid: boolean, errors: string[], rules: Record<string, boolean> }}
 */
export function validatePassword(pw = '') {
  const rules = checkPasswordRules(pw)
  const errors = []
  if (!rules.length) errors.push(PASSWORD_RULE_LABELS.length)
  if (!rules.uppercase) errors.push(PASSWORD_RULE_LABELS.uppercase)
  if (!rules.lowercase) errors.push(PASSWORD_RULE_LABELS.lowercase)
  if (!rules.number) errors.push(PASSWORD_RULE_LABELS.number)
  if (pw.length > 0 && !rules.notCommon) errors.push('That password is too common — choose a less guessable one.')
  return { valid: errors.length === 0, errors, rules }
}

/**
 * A rough 0–4 strength score for the visual indicator. This is intentionally
 * simple (rule coverage + length + symbol bonus) — it gates nothing; validate()
 * is the real check.
 * @returns {{ score: 0|1|2|3|4, label: string, percent: number }}
 */
export function passwordStrength(pw = '') {
  if (!pw) return { score: 0, label: '', percent: 0 }

  const rules = checkPasswordRules(pw)
  let score = 0
  if (rules.length) score += 1
  if (rules.uppercase && rules.lowercase) score += 1
  if (rules.number) score += 1
  if (/[^A-Za-z0-9]/.test(pw)) score += 1 // symbol bonus
  if (pw.length >= 12) score += 1 // length bonus

  // A common password can never read as anything but weak, regardless of shape.
  if (!rules.notCommon) score = 1

  score = Math.max(0, Math.min(4, score))
  const labels = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong']
  return { score, label: labels[score], percent: (score / 4) * 100 }
}
