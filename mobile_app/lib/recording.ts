import { invokeEdgeFunction } from '@/lib/messaging';
import { supabase } from '@/lib/supabase';

export type RecordingPatient = {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  appointmentId?: string;
  pmsApptId?: string;
  pmsPatientId?: string;
  treatmentType?: string;
  txPlanValue?: number | string;
  txPlanValueSource?: string;
  presentingDoctor?: string;
  tcName?: string;
};

export async function createConsult(
  practiceId: string,
  { durationSec, patient, source = 'native_mobile' }: {
    durationSec?: number;
    patient?: RecordingPatient | null;
    source?: string;
  } = {},
) {
  const now = new Date();
  const row: Record<string, unknown> = {
    practice_id: practiceId,
    status: 'analyzing',
    recording_source: source,
    recording_date: now.toISOString().slice(0, 10),
    recording_time: now.toTimeString().slice(0, 8),
    duration: durationSec || null,
  };

  if (patient) {
    const name = [patient.firstName, patient.lastName].filter(Boolean).join(' ').trim();
    if (name) row.patient_name = name;
    if (patient.firstName) row.patient_first = patient.firstName;
    if (patient.lastName) row.patient_last = patient.lastName;
    if (patient.phone) row.patient_phone = patient.phone;
    if (patient.email) row.patient_email = patient.email;
    if (patient.appointmentId) row.appointment_id = patient.appointmentId;
    if (patient.pmsApptId || patient.appointmentId) {
      row.pms_appointment_id = patient.pmsApptId || patient.appointmentId;
    }
    if (patient.pmsPatientId) row.pms_patient_id = patient.pmsPatientId;
    if (patient.treatmentType) row.treatment_type = patient.treatmentType;
    if (patient.txPlanValue != null && patient.txPlanValue !== '') {
      row.tx_plan_value = Number(patient.txPlanValue);
      row.tx_plan_value_source = patient.txPlanValueSource || 'manual';
    }
    if (patient.presentingDoctor) row.presenting_doctor = patient.presentingDoctor;
    if (patient.tcName) row.tc_name = patient.tcName;
  }

  const { data, error } = await supabase.from('consults').insert(row).select('id').single();
  if (error) throw new Error(error.message || 'Could not create consult');
  return data.id as string;
}

export async function uploadRecording(
  practiceId: string,
  consultId: string,
  payload: ArrayBuffer | Blob,
  contentType = 'audio/m4a',
) {
  const type = payload instanceof Blob ? payload.type || contentType : contentType;
  let ext = 'm4a';
  if (type.includes('mp4')) ext = 'mp4';
  else if (type.includes('webm')) ext = 'webm';
  else if (type.includes('aac') || type.includes('m4a') || type.includes('mpeg')) ext = 'm4a';

  const path = `${practiceId}/${consultId}.${ext}`;
  const { error } = await supabase.storage
    .from('consult-recordings')
    .upload(path, payload, { contentType: type || 'audio/m4a', upsert: true });
  if (error) throw new Error(error.message || 'Could not upload recording');
  return path;
}

export async function transcribeRecording({
  consultId,
  audioPath,
  durationSec,
  patient,
}: {
  consultId: string;
  audioPath: string;
  durationSec?: number;
  patient?: RecordingPatient | null;
}) {
  const body: Record<string, unknown> = {
    consult_id: consultId,
    recording_source: 'native_mobile',
    audio_path: audioPath,
    duration: durationSec || null,
  };

  if (patient) {
    if (patient.firstName) body.patient_first_name = patient.firstName;
    if (patient.lastName) body.patient_last_name = patient.lastName;
    if (patient.phone) body.patient_phone = patient.phone;
    if (patient.email) body.patient_email = patient.email;
    if (patient.appointmentId) body.appointment_id = patient.appointmentId;
  }

  return invokeEdgeFunction('transcribe-consult', body);
}

export async function requestAnalysis(consultId: string) {
  return invokeEdgeFunction('analyze-consult', { consult_id: consultId });
}

/**
 * Mark a consult as failed-to-transcribe so the (web + mobile) detail screens
 * surface a recoverable error + Retry instead of spinning on "analyzing" forever.
 * Mirrors the web RecordingModal's transcribe .catch handler. Retains the audio
 * path so the retry can re-run transcription. Best-effort; never throws.
 */
export async function markTranscriptionError(
  consultId: string,
  audioPath: string | null,
  message?: string | null,
) {
  const patch: Record<string, unknown> = {
    status: 'transcription_error',
    transcript_error: message || 'Transcription failed',
  };
  if (audioPath) patch.audio_storage_path = audioPath;
  await supabase.from('consults').update(patch).eq('id', consultId);
}

export async function saveConsultOutcome(consultId: string, outcome: string, userId?: string | null) {
  const patch: Record<string, unknown> = {
    outcome,
    outcome_set_at: new Date().toISOString(),
    outcome_set_by: userId || null,
  };
  if (outcome === 'pending') {
    patch.sequence_cancelled_at = null;
    patch.sequence_cancelled_reason = null;
    patch.sequence_status = 'active';
    patch.sequence_paused_reason = null;
    patch.followup_approved_at = new Date().toISOString();
  } else if (['accepted', 'not_converting'].includes(outcome)) {
    patch.sequence_cancelled_at = new Date().toISOString();
    patch.sequence_cancelled_reason = outcome;
    patch.sequence_status = 'cancelled';
    if (outcome === 'accepted') patch.status = 'closed_won';
    if (outcome === 'not_converting') patch.status = 'closed_lost';
  }
  const { error } = await supabase.from('consults').update(patch).eq('id', consultId);
  if (error) throw new Error(error.message || 'Could not save outcome');
}

/** Remove a consult created during a failed upload/transcribe attempt. */
export async function abandonConsult(practiceId: string, consultId: string, audioPath?: string | null) {
  if (audioPath) {
    await supabase.storage.from('consult-recordings').remove([audioPath]).catch(() => {});
  }
  const { error } = await supabase.from('consults').delete().eq('id', consultId).eq('practice_id', practiceId);
  if (error) throw new Error(error.message || 'Could not remove failed recording');
}
