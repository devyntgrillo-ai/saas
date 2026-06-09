// Browser-recording helpers + recording-source display config.
import { supabase } from './supabase'
import { auditConsultCreated } from './audit'

export const RECORDING_SOURCES = {
  browser: { label: '📱 Phone Recording', classes: 'bg-primary/10 text-primary-300 ring-primary-400/20' },
  native_mobile: { label: '📱 Phone Recording', classes: 'bg-primary/10 text-primary-300 ring-primary-400/20' },
  pms_autosync: { label: '🔗 PMS AutoSync', classes: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/20' },
  plaud_autoflow: { label: 'Plaud AutoFlow', classes: 'bg-[var(--accent-subtle)] text-[var(--accent)]' },
  plaud_device: { label: 'Plaud Device', classes: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/20' },
}
export function recordingSourceMeta(source) {
  return RECORDING_SOURCES[source] || null
}

export const AUDIO_QUALITY = {
  standard: { label: 'Standard', bitsPerSecond: 64000, hint: 'Smaller files, great for speech' },
  high: { label: 'High', bitsPerSecond: 128000, hint: 'Larger files, richer audio' },
}

export const RECORDING_METHODS = [
  { value: 'browser', label: 'Browser recording' },
  { value: 'plaud_autoflow', label: 'Plaud AutoFlow' },
  { value: 'plaud_api', label: 'Plaud API' },
]

export const MIC_PREF_KEY = 'ciq_pref_mic'

// The AutoFlow forwarding address for a practice.
export function plaudAutoflowEmail(practiceId) {
  return `consults+${practiceId}@caselift.io`
}

// Create a placeholder consult row up front so we can redirect to it.
// `patient` (optional) attaches appointment + contact info so the DB triggers
// link the appointment and the generated messages have the right recipient.
// `source` distinguishes native (Capacitor) vs browser recording.
export async function createBrowserConsult(practiceId, { durationSec, patient, source } = {}) {
  const now = new Date()
  const row = {
    practice_id: practiceId,
    status: 'analyzing',
    recording_source: source || 'browser',
    recording_date: now.toISOString().slice(0, 10),
    recording_time: now.toTimeString().slice(0, 8),
    duration: durationSec || null,
  }
  if (patient) {
    const name = [patient.firstName, patient.lastName].filter(Boolean).join(' ').trim()
    if (name) row.patient_name = name
    if (patient.firstName) row.patient_first = patient.firstName
    if (patient.lastName) row.patient_last = patient.lastName
    if (patient.phone) row.patient_phone = patient.phone
    if (patient.email) row.patient_email = patient.email
    if (patient.appointmentId) row.appointment_id = patient.appointmentId
    if (patient.pmsApptId || patient.appointmentId) row.pms_appointment_id = patient.pmsApptId || patient.appointmentId
    // Direct PMS-patient link (from the "Select Patient" picker) for attribution
    // even when there's no today's appointment to link through.
    if (patient.pmsPatientId) row.pms_patient_id = patient.pmsPatientId
    // Treatment-type system (set at the recording confirm step).
    if (patient.treatmentType) row.treatment_type = patient.treatmentType
    if (patient.txPlanValue != null && patient.txPlanValue !== '') {
      row.tx_plan_value = Number(patient.txPlanValue)
      row.tx_plan_value_source = patient.txPlanValueSource || 'manual'
    }
    if (patient.presentingDoctor) row.presenting_doctor = patient.presentingDoctor
    if (patient.tcName) row.tc_name = patient.tcName
  }
  const { data, error } = await supabase.from('consults').insert(row).select('id').single()
  if (error) throw error
  auditConsultCreated(data.id, { source: source || 'browser' })
  return data.id
}

export async function uploadRecording(practiceId, consultId, blob) {
  // Map the recorder's MIME type to a storage extension. Native (Capacitor)
  // recording yields aac/m4a; the browser path yields mp4 or webm.
  const type = blob.type || ''
  let ext = 'webm'
  if (type.includes('mp4')) ext = 'mp4'
  else if (type.includes('aac') || type.includes('m4a') || type.includes('mpeg')) ext = 'm4a'
  const path = `${practiceId}/${consultId}.${ext}`
  const { error } = await supabase.storage
    .from('consult-recordings')
    .upload(path, blob, { contentType: type || 'audio/webm', upsert: true })
  if (error) throw error
  return path
}

// FAST path: upload → transcribe → save (status "transcribed"). Returns quickly
// so the UI can redirect immediately. AI analysis runs separately (see
// requestAnalysis), triggered from the consult detail page after redirect.
export async function transcribeRecording({ consultId, audioPath, transcript, durationSec, appointmentId, patient } = {}) {
  const body = {
    consult_id: consultId,
    recording_source: 'browser',
    duration: durationSec || null,
  }
  // Either transcribe stored audio, or pass a transcript straight through
  // (used by the demo "load example consult" flow).
  if (transcript) body.transcript = transcript
  else body.audio_path = audioPath
  if (appointmentId) body.appointment_id = appointmentId
  if (patient) {
    if (patient.firstName) body.patient_first_name = patient.firstName
    if (patient.lastName) body.patient_last_name = patient.lastName
    if (patient.phone) body.patient_phone = patient.phone
    if (patient.email) body.patient_email = patient.email
  }
  const { data, error } = await supabase.functions.invoke('transcribe-consult', { body })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}

// SLOW path: kick off Claude analysis + message generation for a saved consult.
// Fire-and-forget from the detail page; it updates status to "analyzed" when done.
export async function requestAnalysis(consultId) {
  const { data, error } = await supabase.functions.invoke('analyze-consult', {
    body: { consult_id: consultId },
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}

export async function listMicrophones() {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices.filter((d) => d.kind === 'audioinput')
  } catch {
    return []
  }
}
