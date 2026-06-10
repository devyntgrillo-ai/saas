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
  doctor_first?: string | null;
  doctor_last?: string | null;
  phone?: string | null;
  sms_sender_name?: string | null;
}

function resolveTcName(practice: TokenPractice): string {
  const fromDoctor = [practice.doctor_first, practice.doctor_last].filter(Boolean).join(" ").trim();
  return (
    (practice.sms_sender_name || "").trim() ||
    fromDoctor ||
    (practice.name || "").trim() ||
    "our team"
  );
}

export function replaceTokens(template: string | null | undefined, patient: TokenPatient, practice: TokenPractice): string {
  const tcName = resolveTcName(practice);
  const first = patient.patient_first || "there";
  const last = patient.patient_last || "";
  const map: Record<string, string> = {
    first_name: first,
    last_name: last,
    treatment_type: (patient.treatment_type && TREATMENT_PHRASE[patient.treatment_type]) || "your treatment",
    tx_plan_date: formatTxDate(patient.tx_plan_date),
    practice_name: practice.name || "our office",
    doctor_name: practice.doctor_last ? `Dr. ${practice.doctor_last}` : "the doctor",
    phone_number: practice.phone || "",
    tc_name: tcName,
  };

  let out = String(template || "");
  out = out.replace(/\{\{(\w+)\}\}/gi, (_m, k) => map[k.toLowerCase()] ?? map[k] ?? "");
  // Legacy bracket placeholders from angle templates (not {{tokens}}).
  out = out.replace(/\[TC\s*Name\]/gi, tcName);
  out = out.replace(/\[TC\s*name\]/gi, tcName);
  out = out.replace(/\[Name\]/gi, first);
  out = out.replace(/\[name\]/gi, first);
  out = out.replace(/\[Last\]/gi, last);
  out = out.replace(/\[last\]/gi, last);
  // Strip any remaining template cruft so patients never see raw placeholders.
  out = out.replace(/\{\{[^}]+\}\}/g, "");
  out = out.replace(/\[[A-Za-z][^\]]*\]/g, "");
  return out.replace(/\n{3,}/g, "\n\n").trim();
}
