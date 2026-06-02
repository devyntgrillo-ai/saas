// ============================================================================
// Treatment types - the core taxonomy for Hope AI. Hope AI recovers
// unconverted patients across ALL high-value dental treatments, not just
// implants. This module is the single source of truth for the treatment list,
// per-treatment objection categories, and treatment-plan-value resolution.
// ============================================================================

export const TREATMENT_TYPES = [
  { value: 'dental_implants', label: 'Dental Implants', avgValue: 30000 },
  { value: 'full_arch', label: 'Full Arch / All-on-4', avgValue: 35000 },
  { value: 'invisalign', label: 'Invisalign / Clear Aligners', avgValue: 6500 },
  { value: 'cosmetic_veneers', label: 'Cosmetic / Veneers', avgValue: 12000 },
  { value: 'sleep_apnea', label: 'Sleep Apnea / Oral Appliance', avgValue: 4000 },
  { value: 'periodontal', label: 'Periodontal Treatment', avgValue: 3500 },
  { value: 'full_mouth_rehab', label: 'Full Mouth Rehabilitation', avgValue: 25000 },
  { value: 'other', label: 'Other High-Value Treatment', avgValue: 5000 },
]

export const DEFAULT_TREATMENT = 'dental_implants'

const BY_VALUE = Object.fromEntries(TREATMENT_TYPES.map((t) => [t.value, t]))

/** Human label for a treatment value. Falls back gracefully for unknown/legacy values. */
export function treatmentLabel(value) {
  return BY_VALUE[value]?.label || BY_VALUE[DEFAULT_TREATMENT].label
}

/** Type-average treatment-plan value (last-resort estimate). */
export function treatmentAvg(value) {
  return BY_VALUE[value]?.avgValue ?? BY_VALUE.other.avgValue
}

/** Normalize an arbitrary string (e.g. a PMS appointment_type) to a known
 *  treatment value, or null if there's no confident match. */
export function normalizeTreatment(raw) {
  if (!raw) return null
  const s = String(raw).toLowerCase()
  if (BY_VALUE[s]) return s
  if (/all.?on.?4|all.?on.?x|full.?arch/.test(s)) return 'full_arch'
  if (/implant/.test(s)) return 'dental_implants'
  if (/invisalign|aligner|ortho/.test(s)) return 'invisalign'
  if (/veneer|cosmetic|smile/.test(s)) return 'cosmetic_veneers'
  if (/sleep|apnea|cpap|appliance/.test(s)) return 'sleep_apnea'
  if (/perio|gum|scaling|srp/.test(s)) return 'periodontal'
  if (/full.?mouth|rehab|reconstruction/.test(s)) return 'full_mouth_rehab'
  return null
}

// Per-treatment objection categories - mirrors the analyze-consult prompt so the
// UI (sequence/consult badges) can render friendly labels for whatever Claude
// returned for that treatment type.
export const TREATMENT_OBJECTIONS = {
  dental_implants: ['price', 'fear_surgery', 'spouse_approval', 'timing', 'health_concerns'],
  full_arch: ['price', 'fear_surgery', 'spouse_approval', 'timing', 'health_concerns'],
  invisalign: ['compliance_concerns', 'aesthetics', 'cost_vs_braces', 'timing', 'not_sure_needed'],
  cosmetic_veneers: ['cost', 'fear_of_looking_fake', 'recovery_time', 'spouse_approval', 'timing'],
  sleep_apnea: ['insurance_coverage', 'cpap_preference', 'cost', 'skepticism', 'spouse_referral'],
  periodontal: ['cost', 'fear', 'insurance', 'denial_of_severity', 'timing'],
  full_mouth_rehab: ['cost', 'overwhelm', 'timeline', 'fear', 'spouse_approval'],
  other: ['cost', 'overwhelm', 'timeline', 'fear', 'spouse_approval'],
}

const OBJECTION_LABELS = {
  price: 'Price', cost: 'Cost', fear: 'Fear', fear_surgery: 'Fear of surgery',
  spouse_approval: 'Spouse approval', spouse: 'Spouse', spouse_referral: 'Spouse referral',
  timing: 'Timing', timeline: 'Timeline', health_concerns: 'Health concerns',
  compliance_concerns: 'Compliance', aesthetics: 'Aesthetics', cost_vs_braces: 'Cost vs braces',
  not_sure_needed: 'Not sure needed', fear_of_looking_fake: 'Looking fake',
  recovery_time: 'Recovery time', insurance_coverage: 'Insurance', insurance: 'Insurance',
  cpap_preference: 'Prefers CPAP', skepticism: 'Skepticism', denial_of_severity: 'Denies severity',
  overwhelm: 'Overwhelm', other: 'Other',
}

/** Friendly label for an objection key (treatment-agnostic). */
export function objectionLabel(key) {
  if (!key) return null
  return OBJECTION_LABELS[String(key).toLowerCase()] || String(key).replace(/_/g, ' ')
}

// ---- Treatment-plan-value resolution ---------------------------------------
// Source precedence (first available wins):
//   pms → manual → practice_default → estimate (AI) → estimate (type avg)
export const TX_VALUE_SOURCES = {
  pms: { label: 'PMS', confirmed: true },
  manual: { label: 'Manual', confirmed: true },
  practice_default: { label: 'Practice avg', confirmed: false },
  estimate: { label: 'Estimated', confirmed: false },
}

export function isConfirmedSource(source) {
  return source === 'pms' || source === 'manual'
}

function practiceDefaultFor(practice, treatmentType) {
  const defaults = practice?.treatment_defaults
  const v = defaults && typeof defaults === 'object' ? Number(defaults[treatmentType]) : NaN
  return Number.isFinite(v) && v > 0 ? v : null
}

/**
 * Resolve the treatment-plan value to DISPLAY for a consult, applying the full
 * priority chain. Returns { value:number, source:string }.
 * Use this on the dashboard / consult detail / sequences for consistent display.
 */
export function consultTxValue(consult, practice) {
  const tt = consult?.treatment_type || DEFAULT_TREATMENT
  const stored = Number(consult?.tx_plan_value)
  if (Number.isFinite(stored) && stored > 0) {
    // The stored source is authoritative (pms/manual/estimate written upstream).
    return { value: stored, source: consult?.tx_plan_value_source || 'manual' }
  }
  const pd = practiceDefaultFor(practice, tt)
  if (pd) return { value: pd, source: 'practice_default' }
  return { value: treatmentAvg(tt), source: 'estimate' }
}

/**
 * The best DEFAULT value to pre-fill when starting a recording, before any
 * manual entry. Priority: PMS appt value → practice default → type avg.
 * Returns { value:number, source:string }.
 */
export function defaultTxValue({ appt, practice, treatmentType }) {
  const tt = treatmentType || normalizeTreatment(appt?.appointment_type) || DEFAULT_TREATMENT
  const pms = Number(appt?.tx_plan_value)
  if (Number.isFinite(pms) && pms > 0) return { value: pms, source: 'pms' }
  const pd = practiceDefaultFor(practice, tt)
  if (pd) return { value: pd, source: 'practice_default' }
  return { value: treatmentAvg(tt), source: 'estimate' }
}

/** Compact currency, e.g. 30000 → "$30k", 1260000 → "$1.26M". */
export function formatTxValue(n) {
  const v = Number(n) || 0
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(abs % 1_000_000 === 0 ? 0 : 2)}M`
  if (abs >= 1000) return `$${(v / 1000).toFixed(abs % 1000 === 0 ? 0 : 1)}k`
  return `$${v.toLocaleString()}`
}

/**
 * Display descriptor for a resolved { value, source }:
 *   { text, prefix, qualifier, tone, tooltip, confirmed }
 * - confirmed (pms/manual): solid green, no qualifier
 * - practice_default: amount + "Practice avg" qualifier
 * - estimate: greyed, "~" prefix + tooltip
 */
export function txValueDisplay({ value, source }) {
  const confirmed = isConfirmedSource(source)
  if (confirmed) {
    return { text: formatTxValue(value), prefix: '', qualifier: null, tone: 'text-emerald-400', confirmed: true, tooltip: null }
  }
  if (source === 'practice_default') {
    return { text: formatTxValue(value), prefix: '', qualifier: 'Practice avg', tone: 'text-slate-300', confirmed: false, tooltip: 'Practice default for this treatment - enter the actual value for accurate reporting.' }
  }
  return {
    text: formatTxValue(value), prefix: '~', qualifier: 'Estimated', tone: 'text-slate-500', confirmed: false,
    tooltip: 'Estimated - enter actual value for accurate reporting',
  }
}
