/** Patient-facing email host (must match MAILGUN_PATIENT_MAIL_ROOT in edge functions). */
export const PATIENT_MAIL_ROOT = import.meta.env.VITE_PATIENT_MAIL_ROOT || 'mail.heyhope.ai'

export function practiceMailHostname(practice) {
  const sub = practice?.mail_subdomain
  if (!sub) return null
  return `${sub}.${PATIENT_MAIL_ROOT}`
}

export function practiceFromAddress(practice) {
  const host = practiceMailHostname(practice)
  if (!host) return null
  const local = (practice?.mail_from_local_part || 'office').trim() || 'office'
  return `${local}@${host}`
}
