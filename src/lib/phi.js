// HIPAA "minimum necessary" helpers for masking patient identity in the UI.
//
// A practice_viewer (e.g. office manager) may see operational lists but not
// individual patient PHI. Instead of a name we show a stable pseudonymous
// label like "Patient #4827" derived from the record id, so the same patient
// reads consistently across views without exposing who they are.

// Deterministic 4-digit label from any id (uuid or number). Stable per record.
export function maskedPatientLabel(id) {
  const s = String(id || '')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return `Patient #${1000 + (h % 9000)}`
}

// The real patient name from a consult/conversation/appointment row.
export function patientName(record) {
  if (!record) return ''
  return (
    record.patient_name ||
    [record.patient_first, record.patient_last].filter(Boolean).join(' ').trim()
  )
}

// Name to render given the caller's PHI permission. When PHI is not allowed,
// returns the masked label keyed off the row id (falls back to consult_id).
export function displayPatientName(record, canViewPHI, fallback = 'Patient') {
  if (canViewPHI) return patientName(record) || fallback
  return maskedPatientLabel(record?.id || record?.consult_id || record?.conversation_id)
}
