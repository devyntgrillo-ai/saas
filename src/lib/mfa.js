// ============================================================================
// MFA helpers, backup (recovery) code generation + hashing.
//
// Supabase TOTP MFA does not issue recovery codes natively, so we generate them
// client-side, show them to the user once, and persist only SHA-256 HASHES in the
// user's auth metadata (never the plaintext). The plaintext is shown exactly once
// at setup time and never retrievable again, standard backup-code UX.
//
// NOTE: redeeming a backup code at sign-in (when the authenticator is lost)
// requires a server-side verification step that validates the entered code
// against these stored hashes and then issues an aal2 session. That belongs in an
// edge function and is out of scope for this client change, the hashes are
// stored here so that server step has something to verify against.
// ============================================================================

const BACKUP_CODE_COUNT = 10

// Crockford-ish alphabet without easily-confused chars (no O/0, I/1, etc.).
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/** Generate N human-friendly backup codes, formatted XXXX-XXXX. */
export function generateBackupCodes(count = BACKUP_CODE_COUNT) {
  const codes = []
  for (let i = 0; i < count; i++) {
    const bytes = new Uint8Array(8)
    crypto.getRandomValues(bytes)
    let raw = ''
    for (const b of bytes) raw += ALPHABET[b % ALPHABET.length]
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}`)
  }
  return codes
}

/** SHA-256 hash a single code (normalized: uppercase, dashes stripped). */
async function hashCode(code) {
  const normalized = code.replace(/-/g, '').toUpperCase()
  const data = new TextEncoder().encode(normalized)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Hash a list of backup codes for at-rest storage. */
export function hashBackupCodes(codes) {
  return Promise.all(codes.map(hashCode))
}
