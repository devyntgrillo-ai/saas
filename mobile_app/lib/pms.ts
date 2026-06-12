import { supabase } from '@/lib/supabase';
import { normalizeTreatment, treatmentLabel } from '@/lib/treatments';

export type PmsAppointment = {
  id: string;
  patient_first?: string | null;
  patient_last?: string | null;
  patient_phone?: string | null;
  patient_email?: string | null;
  appointment_time?: string | null;
  appointment_type?: string | null;
  treatment_type?: string | null;
  tx_plan_value?: number | null;
  provider?: string | null;
  pms_appointment_id?: string | null;
  consult_id?: string | null;
  pms_match_rule?: string | null;
};

export type PmsPatient = {
  id: string;
  external_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  email?: string | null;
};

type PracticeLike = {
  pms_sync_rules?: {
    clusters?: Array<{
      id?: string;
      label?: string;
      procedure_codes?: string[];
      ai_reason?: string;
    }>;
  } | null;
};

const CONSULT_LABEL_RULES: Array<[RegExp, string]> = [
  [/implant/i, 'Implant Consult'],
  [/invisalign|aligner|ortho/i, 'Invisalign Consult'],
  [/veneer|cosmetic|smile/i, 'Cosmetic Consult'],
  [/sleep|apnea|cpap/i, 'Sleep Apnea Consult'],
  [/new patient/i, 'New Patient Consult'],
  [/consult/i, 'Consultation'],
];

function inferConsultLabel(blob: string) {
  for (const [re, label] of CONSULT_LABEL_RULES) {
    if (re.test(blob)) return label;
  }
  return null;
}

export function formatAppointmentType(appt: PmsAppointment, practice?: PracticeLike | null) {
  const raw = (appt.appointment_type || '').trim();
  if (raw && !/^d\d{4}$/i.test(raw)) {
    return inferConsultLabel(raw) || raw;
  }

  const cluster = practice?.pms_sync_rules?.clusters?.find((c) => c.id === appt.pms_match_rule);
  if (cluster?.label) {
    const label = cluster.label.trim();
    if (label) return inferConsultLabel(label) || label;
  }

  if (appt.treatment_type) return treatmentLabel(appt.treatment_type);
  return raw || 'Consult';
}

export async function fetchTodaysAppointments(practiceId: string): Promise<PmsAppointment[]> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const { data, error } = await supabase
    .from('pms_appointments')
    .select('*')
    .eq('practice_id', practiceId)
    .gte('appointment_time', start.toISOString())
    .lt('appointment_time', end.toISOString())
    .order('appointment_time', { ascending: true });

  if (error) throw error;
  return (data as PmsAppointment[]) || [];
}

export async function searchPmsPatients(practiceId: string, query = '', limit = 25): Promise<PmsPatient[]> {
  if (!practiceId) return [];

  let q = supabase
    .from('pms_patients')
    .select('id, external_id, first_name, last_name, phone, email')
    .eq('practice_id', practiceId)
    .order('last_name', { ascending: true })
    .limit(limit);

  const term = query.trim().replace(/[%,]/g, '');
  if (term) {
    q = q.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,phone.ilike.%${term}%`);
  }

  const { data, error } = await q;
  if (error) return [];
  return (data as PmsPatient[]) || [];
}
