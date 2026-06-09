// Server-side token replacement for reactivation messages, used by the
// process-reactivation-drip sender before handing off to twilio-send /
// mailgun-send. Mirrors src/lib/reactivationTokens.js. Replaces {{tokens}} with
// real patient + practice values; leaves unknown tokens untouched.

const TREATMENT_PHRASE: Record<string, string> = {
  dental_implants: "dental implants",
  full_arch: "full-arch implants (All-on-4)",
  implant_bridge: "an implant bridge",
  invisalign: "Invisalign",
  cosmetic_veneers: "veneers",
  dentures: "dentures",
  sleep_apnea: "a sleep apnea appliance",
  periodontal: "periodontal treatment",
  full_mouth_rehab: "full-mouth rehabilitation",
  other: "your treatment",
};

function formatTxDate(d: unknown): string {
  if (!d) return "";
  const dt = new Date(String(d));
  return isNaN(dt.getTime()) ? "" : dt.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export interface TokenPatient {
  patient_first?: string | null;
  patient_last?: string | null;
  treatment_type?: string | null;
  tx_plan_date?: string | null;
}
export interface TokenPractice {
  name?: string | null;
  doctor_last?: string | null;
  phone?: string | null;
}

export function replaceTokens(template: string | null | undefined, patient: TokenPatient, practice: TokenPractice): string {
  const map: Record<string, string> = {
    first_name: patient.patient_first || "there",
    last_name: patient.patient_last || "",
    treatment_type: (patient.treatment_type && TREATMENT_PHRASE[patient.treatment_type]) || "your treatment",
    tx_plan_date: formatTxDate(patient.tx_plan_date),
    practice_name: practice.name || "our office",
    doctor_name: practice.doctor_last ? `Dr. ${practice.doctor_last}` : "the doctor",
    phone_number: practice.phone || "",
  };
  return String(template || "").replace(/\{\{(\w+)\}\}/g, (m, k) => (k in map ? map[k] : m));
}
