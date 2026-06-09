// Custom value tokens for reactivation messages. The buttons in the campaign
// builder insert these at the cursor; replaceTokens() fills them with real
// patient + practice data (used for the live preview client-side, and mirrored
// server-side in supabase/functions/_shared/reactivationTokens.ts at send time).

export const REACTIVATION_TOKENS = [
  { token: '{{first_name}}', label: 'First Name' },
  { token: '{{last_name}}', label: 'Last Name' },
  { token: '{{treatment_type}}', label: 'Treatment Type' },
  { token: '{{tx_plan_date}}', label: 'TX Plan Date' },
  { token: '{{practice_name}}', label: 'Practice Name' },
  { token: '{{doctor_name}}', label: 'Doctor Name' },
  { token: '{{phone_number}}', label: 'Phone Number' },
]

// Human-readable treatment phrasing for {{treatment_type}} in message bodies.
const TREATMENT_PHRASE = {
  dental_implants: 'dental implants',
  full_arch: 'full-arch implants (All-on-4)',
  implant_bridge: 'an implant bridge',
  invisalign: 'Invisalign',
  cosmetic_veneers: 'veneers',
  dentures: 'dentures',
  sleep_apnea: 'a sleep apnea appliance',
  periodontal: 'periodontal treatment',
  full_mouth_rehab: 'full-mouth rehabilitation',
  other: 'your treatment',
}

export function formatTxDate(d) {
  if (!d) return ''
  const dt = new Date(d)
  return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

// Replace {{tokens}} in a template with values from a patient + practice record.
// Unknown tokens are left untouched. Used for the builder's live preview.
export function replaceTokens(template, { patient = {}, practice = {} } = {}) {
  const map = {
    first_name: patient.first_name || patient.patient_first || 'there',
    last_name: patient.last_name || patient.patient_last || '',
    treatment_type: TREATMENT_PHRASE[patient.treatment_type] || 'your treatment',
    tx_plan_date: formatTxDate(patient.tx_plan_date),
    practice_name: practice.name || 'our office',
    doctor_name: practice.doctor_last ? `Dr. ${practice.doctor_last}` : 'the doctor',
    phone_number: practice.phone || '',
  }
  return String(template || '').replace(/\{\{(\w+)\}\}/g, (m, k) => (k in map ? map[k] : m))
}
