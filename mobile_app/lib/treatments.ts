export const TREATMENT_TYPES = [
  { value: 'dental_implants', label: 'Dental Implants', avgValue: 30000 },
  { value: 'full_arch', label: 'Full Arch / All-on-4', avgValue: 35000 },
  { value: 'invisalign', label: 'Invisalign / Clear Aligners', avgValue: 6500 },
  { value: 'cosmetic_veneers', label: 'Cosmetic / Veneers', avgValue: 12000 },
  { value: 'sleep_apnea', label: 'Sleep Apnea / Oral Appliance', avgValue: 4000 },
  { value: 'periodontal', label: 'Periodontal Treatment', avgValue: 3500 },
  { value: 'full_mouth_rehab', label: 'Full Mouth Rehabilitation', avgValue: 25000 },
  { value: 'other', label: 'Other High-Value Treatment', avgValue: 5000 },
] as const;

export const DEFAULT_TREATMENT = 'dental_implants';

const BY_VALUE = Object.fromEntries(TREATMENT_TYPES.map((t) => [t.value, t]));

export function treatmentLabel(value?: string | null) {
  return BY_VALUE[value || '']?.label || BY_VALUE[DEFAULT_TREATMENT].label;
}

export function normalizeTreatment(raw?: string | null): string | null {
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  if (BY_VALUE[s]) return s;
  if (/all.?on.?4|all.?on.?x|full.?arch/.test(s)) return 'full_arch';
  if (/implant/.test(s)) return 'dental_implants';
  if (/invisalign|aligner|ortho/.test(s)) return 'invisalign';
  if (/veneer|cosmetic|smile/.test(s)) return 'cosmetic_veneers';
  if (/sleep|apnea|cpap|appliance/.test(s)) return 'sleep_apnea';
  if (/perio|gum|scaling|srp/.test(s)) return 'periodontal';
  if (/full.?mouth|rehab|reconstruction/.test(s)) return 'full_mouth_rehab';
  return null;
}
