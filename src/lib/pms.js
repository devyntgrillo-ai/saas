// PMS (Sikka) integration helpers. All Sikka API calls are mocked until we have
// credentials - the data structures and UI are real and wire to Sikka later.
import { supabase } from './supabase'
import { normalizeTreatment, treatmentLabel } from './treatments'

const CDT_LABELS = {
  D9310: 'Consultation',
  D0140: 'Limited Oral Evaluation',
  D0150: 'Comprehensive Oral Evaluation',
  D0180: 'Periodontal Evaluation',
  D1110: 'Prophylaxis (Cleaning)',
  D1120: 'Child Prophylaxis',
  D0210: 'Full Mouth X-Rays',
  D0220: 'Periapical X-Ray',
  D0274: 'Bitewing X-Rays',
  D4910: 'Periodontal Maintenance',
}

const CONSULT_LABEL_RULES = [
  [/implant/i, 'Implant Consult'],
  [/invisalign|aligner|ortho/i, 'Invisalign Consult'],
  [/veneer|cosmetic|smile/i, 'Cosmetic Consult'],
  [/sleep|apnea|cpap/i, 'Sleep Apnea Consult'],
  [/new patient/i, 'New Patient Consult'],
  [/consult/i, 'Consultation'],
]

function cdtLabel(code) {
  return CDT_LABELS[(code || '').toUpperCase().trim()] || null
}

function isCodeOnlyLabel(s) {
  const t = (s || '').trim()
  return /^procedure\s+d\d{4}$/i.test(t) || /^d\d{4}$/i.test(t) ||
    /^[A-Z0-9]{3,8}(,\s*[A-Z0-9]{3,8})+$/i.test(t)
}

function inferConsultLabel(blob) {
  for (const [re, label] of CONSULT_LABEL_RULES) {
    if (re.test(blob)) return label
  }
  return null
}

/** Human-readable label for schedule / consult list (not raw CDT codes). */
export function formatAppointmentType(appt, practice = null) {
  const raw = (appt?.appointment_type || '').trim()

  if (raw && !isCodeOnlyLabel(raw)) {
    return inferConsultLabel(raw) || raw
  }

  const cluster = practice?.pms_sync_rules?.clusters?.find((c) => c.id === appt?.pms_match_rule)
  if (cluster) {
    const label = (cluster.label || '').trim()
    if (label && !isCodeOnlyLabel(label) && /[a-z]/i.test(label)) return inferConsultLabel(label) || label
    for (const code of cluster.procedure_codes || []) {
      const mapped = cdtLabel(code)
      if (mapped) return mapped
    }
    const fromReason = inferConsultLabel(`${label} ${cluster.ai_reason || ''}`)
    if (fromReason) return fromReason
  }

  const code = raw.match(/D\d{4}/i)?.[0] || cluster?.procedure_codes?.[0]
  if (code) {
    const mapped = cdtLabel(code)
    if (mapped) return mapped
  }

  if (appt?.treatment_type) return treatmentLabel(appt.treatment_type)

  const inferred = inferConsultLabel(raw)
  if (inferred) return inferred

  return raw || 'Consult'
}

// Sikka-supported systems. `cloud: true` skips the local bridge install step.
export const SIKKA_SYSTEMS = [
  { value: 'dentrix', label: 'Dentrix', cloud: false },
  { value: 'eaglesoft', label: 'Eaglesoft', cloud: false },
  { value: 'opendental', label: 'Open Dental', cloud: false },
  { value: 'curve', label: 'Curve Dental', cloud: true },
  { value: 'dentrix_ascend', label: 'Dentrix Ascend', cloud: true },
  { value: 'dolphin', label: 'Dolphin', cloud: false },
  { value: 'practiceworks', label: 'PracticeWorks', cloud: false },
  { value: 'softdent', label: 'SoftDent', cloud: false },
  { value: 'carestream', label: 'Carestream', cloud: false },
  { value: 'denticon', label: 'Denticon', cloud: true },
  { value: 'carestack', label: 'CareStack', cloud: true },
  { value: 'tab32', label: 'tab32', cloud: true },
  { value: 'adit', label: 'Adit', cloud: true },
  { value: 'oryx', label: 'Oryx', cloud: true },
  { value: 'planet_dds', label: 'Planet DDS', cloud: true },
  { value: 'patterson', label: 'Patterson Fuse', cloud: true },
  { value: 'easy_dental', label: 'Easy Dental', cloud: false },
  { value: 'winoms', label: 'WinOMS', cloud: false },
  { value: 'macpractice', label: 'MacPractice', cloud: false },
  { value: 'abeldent', label: 'ABELDent', cloud: false },
  { value: 'cleardent', label: 'ClearDent', cloud: false },
  { value: 'tracker', label: 'Tracker', cloud: false },
  { value: 'powerpractice', label: 'Power Practice', cloud: false },
  { value: 'dentimax', label: 'DentiMax', cloud: false },
  { value: 'practice_web', label: 'Practice-Web', cloud: false },
  { value: 'maxident', label: 'MaxiDent', cloud: false },
  { value: 'open_dental_cloud', label: 'Open Dental Cloud', cloud: true },
  { value: 'nexhealth', label: 'NexHealth', cloud: true },
  { value: 'modento', label: 'Modento / Dental Intel', cloud: true },
  { value: 'dentplus', label: 'Dent+', cloud: true },
  { value: 'sensei', label: 'Sensei Cloud', cloud: true },
  { value: 'iDentalSoft', label: 'iDentalSoft', cloud: true },
  { value: 'dentr', label: 'Dentr', cloud: true },
  { value: 'archy', label: 'Archy', cloud: true },
  { value: 'umbie', label: 'Umbie', cloud: true },
  { value: 'datacon', label: 'Datacon', cloud: false },
  { value: 'orthotrac', label: 'OrthoTrac', cloud: false },
  { value: 'cloud9', label: 'Cloud 9 Ortho', cloud: true },
  { value: 'topsortho', label: 'TOPS Ortho', cloud: false },
  { value: 'other', label: 'Other / not listed', cloud: true },
]

export function pmsLabel(type) {
  return SIKKA_SYSTEMS.find((s) => s.value === type)?.label || type || 'PMS'
}
export function pmsIsCloud(type) {
  return Boolean(SIKKA_SYSTEMS.find((s) => s.value === type)?.cloud)
}

// Derived connection status for the badge at the top of the PMS tab.
export function pmsStatusMeta(practice) {
  if (!practice?.pms_connected) return { key: 'none', label: 'No PMS connected', dot: 'bg-slate-500' }
  if (practice.pms_status === 'syncing') return { key: 'syncing', label: 'Syncing…', dot: 'bg-sky-400 animate-pulse' }
  if (practice.pms_status === 'error') return { key: 'error', label: 'Connection error - reconnect', dot: 'bg-rose-500' }
  return { key: 'connected', label: `Connected to ${pmsLabel(practice.pms_type)}`, dot: 'bg-emerald-400' }
}

// supabase-js surfaces non-2xx edge responses as a generic message, pull the
// real `error` field from the response body when present.
async function edgeErrorMessage(error) {
  try {
    const body = await error?.context?.json?.()
    if (body?.error) return body.detail ? `${body.error} (${body.detail})` : body.error
  } catch {
    /* body wasn't JSON or already consumed */
  }
  return error?.message || 'Request failed'
}

// --- Mocked Sikka calls -----------------------------------------------------
export async function testSikkaConnection(sikkaPracticeId) {
  await new Promise((r) => setTimeout(r, 900))
  const id = (sikkaPracticeId || '').trim()
  if (id.length < 4 || /fail/i.test(id)) {
    return { ok: false, error: 'Practice not found. Check your ID and try again.' }
  }
  return { ok: true, practiceName: 'Perry Family Dentistry' }
}

export async function connectPms(practiceId, { pmsType, sikkaPracticeId }) {
  const { error } = await supabase
    .from('practices')
    .update({
      pms_connected: true,
      pms_type: pmsType,
      sikka_practice_id: sikkaPracticeId,
      pms_status: null,
      pms_last_sync: new Date().toISOString(),
    })
    .eq('id', practiceId)
  if (error) throw error
}

// Practice-facing wizard: save only the PMS type. The practice never sees or
// enters a Sikka ID - that's configured by an admin / the connect webhook.
export async function savePmsType(practiceId, pmsType) {
  const { error } = await supabase.from('practices').update({ pms_type: pmsType }).eq('id', practiceId)
  if (error) throw error
}

export async function fetchAppointmentCount(practiceId) {
  const { count } = await supabase
    .from('pms_appointments')
    .select('id', { count: 'exact', head: true })
    .eq('practice_id', practiceId)
  return count || 0
}

// --- Admin (super-admin) Sikka linking --------------------------------------
// OAuth model: list the offices a connected practice's token is authorized for
// so the admin can pick the office_id (stored as sikka_practice_id) to sync.
export async function searchSikkaPractice(practiceId) {
  const { data, error } = await supabase.functions.invoke('search-sikka-practice', { body: { practice_id: practiceId } })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data?.results || []
}

export async function saveSikkaConfig(practiceId, patch) {
  const update = {}
  if (patch.sikkaPracticeId !== undefined) update.sikka_practice_id = patch.sikkaPracticeId || null
  if (patch.pmsType !== undefined) update.pms_type = patch.pmsType || null
  if (patch.sikkaConnected !== undefined) update.sikka_connected = patch.sikkaConnected
  const { error } = await supabase.from('practices').update(update).eq('id', practiceId)
  if (error) throw error
}

// Manually trigger the real sync-appointments function for one practice.
export async function testSyncForPractice(practiceId) {
  const { data, error } = await supabase.functions.invoke('sync-appointments', { body: { practice_id: practiceId } })
  if (error) throw new Error(error.message || 'Sync failed')
  if (data?.error) throw new Error(data.error)
  return data // { synced, practices, errors }
}

/** Scan PMS appointments, cluster types, classify with AI, save draft rules. */
export async function discoverPmsConsults(practiceId, { historyYears = 1, forwardYears = 1 } = {}) {
  const { data, error } = await supabase.functions.invoke('discover-pms-consults', {
    body: { practice_id: practiceId, history_years: historyYears, forward_years: forwardYears },
  })
  if (error) throw new Error(await edgeErrorMessage(error))
  if (data?.error) throw new Error(data.detail ? `${data.error} (${data.detail})` : data.error)
  return data
}

/** Practice admin approves consult sync rules and triggers backfill. */
export async function approvePmsSync(practiceId, { historyYears, forwardYears, clusters } = {}) {
  const { data, error } = await supabase.functions.invoke('approve-pms-sync', {
    body: {
      practice_id: practiceId,
      history_years: historyYears,
      forward_years: forwardYears,
      clusters,
    },
  })
  if (error) throw new Error(await edgeErrorMessage(error))
  if (data?.error) throw new Error(data.error)
  return data
}

export async function fetchUnlinkedRegistrations() {
  const { data } = await supabase
    .from('sikka_registrations')
    .select('*')
    .in('status', ['unlinked', 'pending'])
    .order('created_at', { ascending: false })
    .limit(50)
  return data || []
}

/** Look up a Sikka office the webhook stored after SPU sync (Settings → PMS). */
export async function lookupSikkaRegistration(practiceId, sikkaPracticeId) {
  const { data, error } = await supabase.functions.invoke('link-sikka-practice', {
    body: { action: 'lookup', practice_id: practiceId, sikka_practice_id: sikkaPracticeId },
  })
  if (error) throw new Error(await edgeErrorMessage(error))
  if (data?.error) throw new Error(data.error)
  return data.registration
}

/** Claim a webhook registration and link it to the signed-in practice. */
export async function linkSikkaRegistration(practiceId, sikkaPracticeId) {
  const { data, error } = await supabase.functions.invoke('link-sikka-practice', {
    body: { action: 'link', practice_id: practiceId, sikka_practice_id: sikkaPracticeId },
  })
  if (error) throw new Error(await edgeErrorMessage(error))
  if (data?.error) throw new Error(data.error)
  return data
}

export async function linkRegistration(registrationId, practiceId, sikkaPracticeId) {
  await supabase.from('practices').update({ sikka_practice_id: sikkaPracticeId, sikka_connected: true }).eq('id', practiceId)
  await supabase.from('sikka_registrations').update({ status: 'linked', matched_practice_id: practiceId }).eq('id', registrationId)
}

export async function disconnectPms(practiceId) {
  const { error } = await supabase
    .from('practices')
    .update({
      pms_connected: false,
      pms_status: null,
      sikka_practice_id: null,
      sikka_connected: false,
      sikka_request_key: null,
      sikka_refresh_token: null,
      sikka_token_expires_at: null,
    })
    .eq('id', practiceId)
  if (error) throw error
}

// Mocked manual sync - logs an event and bumps the last-sync timestamp.
export async function syncNow(practiceId) {
  const now = new Date().toISOString()
  await supabase.from('pms_sync_log').insert({
    practice_id: practiceId,
    sync_type: 'manual',
    records_synced: Math.floor(Math.random() * 6) + 10,
  })
  await supabase.from('practices').update({ pms_last_sync: now, pms_status: null }).eq('id', practiceId)
  return now
}

export async function fetchSyncStats(practiceId) {
  const [appts, matched, plans] = await Promise.all([
    supabase.from('pms_appointments').select('id', { count: 'exact', head: true }).eq('practice_id', practiceId),
    supabase.from('consults').select('id', { count: 'exact', head: true }).eq('practice_id', practiceId).not('pms_appointment_id', 'is', null),
    supabase.from('pms_sync').select('id', { count: 'exact', head: true }).eq('practice_id', practiceId),
  ])
  return {
    appointments: appts.count || 0,
    patientsMatched: matched.count || 0,
    treatmentPlans: plans.count || 0,
  }
}

export async function fetchSyncLog(practiceId, limit = 10) {
  const { data } = await supabase
    .from('pms_sync_log')
    .select('*')
    .eq('practice_id', practiceId)
    .order('created_at', { ascending: false })
    .limit(limit)
  return data || []
}

// Searchable lookup over every patient synced from the practice's PMS
// (pms_patients). Powers the recording flow's "Select Patient" option so a TC
// can record for any patient, not only one on today's schedule. Server-side
// name/phone match, capped so a large roster stays responsive.
export async function searchPmsPatients(practiceId, query = '', limit = 25) {
  if (!practiceId) return []
  let q = supabase
    .from('pms_patients')
    .select('id, external_id, first_name, last_name, phone, email')
    .eq('practice_id', practiceId)
    .order('last_name', { ascending: true })
    .limit(limit)
  const term = (query || '').trim().replace(/[%,]/g, '')
  if (term) {
    q = q.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,phone.ilike.%${term}%`)
  }
  const { data, error } = await q
  if (error) {
    console.warn('[pms] searchPmsPatients failed:', error.message)
    return []
  }
  return data || []
}

// Today's appointments (local day).
export async function fetchTodaysAppointments(practiceId) {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  const { data } = await supabase
    .from('pms_appointments')
    .select('*')
    .eq('practice_id', practiceId)
    .gte('appointment_time', start.toISOString())
    .lt('appointment_time', end.toISOString())
    .order('appointment_time', { ascending: true })
  return data || []
}

export async function setImplantConsult(appointmentId, value) {
  const { error } = await supabase
    .from('pms_appointments')
    .update({ is_implant_consult: value })
    .eq('id', appointmentId)
  if (error) throw error
}

// Recording rate over the last `weeks` rolling 7-day buckets.
export async function fetchRecordingRate(practiceId, weeks = 4) {
  const since = new Date()
  since.setHours(0, 0, 0, 0)
  since.setDate(since.getDate() - weeks * 7 + 1)
  const { data } = await supabase
    .from('pms_appointments')
    .select('appointment_time, consult_id, is_implant_consult')
    .eq('practice_id', practiceId)
    .eq('is_implant_consult', true)
    .gte('appointment_time', since.toISOString())

  const rows = data || []
  const today = new Date()
  today.setHours(23, 59, 59, 999)
  const buckets = []
  for (let i = weeks - 1; i >= 0; i--) {
    const end = new Date(today)
    end.setDate(end.getDate() - i * 7)
    const start = new Date(end)
    start.setDate(start.getDate() - 6)
    start.setHours(0, 0, 0, 0)
    const inBucket = rows.filter((r) => {
      const t = new Date(r.appointment_time)
      return t >= start && t <= end
    })
    const total = inBucket.length
    const recorded = inBucket.filter((r) => r.consult_id).length
    buckets.push({
      label: `${start.getMonth() + 1}/${start.getDate()}`,
      total,
      recorded,
      rate: total ? Math.round((recorded / total) * 100) : 0,
    })
  }
  const current = buckets[buckets.length - 1] || { total: 0, recorded: 0, rate: 0 }
  return { current, trend: buckets }
}

export function rateColor(pct) {
  if (pct >= 80) return { text: 'text-emerald-400', bar: 'bg-emerald-500' }
  if (pct >= 50) return { text: 'text-amber-400', bar: 'bg-amber-500' }
  return { text: 'text-rose-400', bar: 'bg-rose-500' }
}

// Attribution split: total production from CaseLift patients vs the portion
// conservatively attributed to CaseLift sequences.
export async function fetchAttribution(practiceId) {
  const { data } = await supabase
    .from('consults')
    .select('status, case_value, attribution_model')
    .eq('practice_id', practiceId)
    .in('status', ['closed_won', 'active', 'recovered'])
  const rows = data || []
  const total = rows.reduce((s, c) => s + (Number(c.case_value) || 0), 0)
  const attributed = rows
    .filter((c) => c.attribution_model === 'caselift_recovered')
    .reduce((s, c) => s + (Number(c.case_value) || 0), 0)
  return { total, attributed }
}

export const ATTRIBUTION_BADGES = {
  caselift_recovered: { label: 'Recovered by CaseLift', classes: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/20' },
  practice_recovered: { label: 'Closed independently', classes: 'bg-slate-500/15 text-slate-300 ring-slate-400/20' },
  unknown: { label: 'Attribution pending', classes: 'bg-slate-500/10 text-slate-400 ring-slate-400/10' },
}
export function attributionBadge(model) {
  return ATTRIBUTION_BADGES[model] || null
}
