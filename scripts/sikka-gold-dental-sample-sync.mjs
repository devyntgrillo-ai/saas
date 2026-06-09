#!/usr/bin/env node
/**
 * Map Sikka sandbox office D22072 → Gold Dental in prod, then pull a small
 * sample of patients / providers / appointments to demonstrate field mapping.
 *
 * Usage:
 *   SIKKA_APP_ID=... SIKKA_APP_SECRET=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/sikka-gold-dental-sample-sync.mjs
 *
 * Optional:
 *   --practice <uuid>   (default: Gold Dental)
 *   --office <id>       (default: D22072)
 *   --startdate YYYY-MM-DD  (appointment window start)
 *   --enddate YYYY-MM-DD    (appointment window end)
 *   --patients <n>      (default: 10)
 *   --appointments-only Skip patients/providers; sync appointments only
 *   --dry-run
 */
import { parseArgs } from 'node:util'

const GOLD_DENTAL_ID = 'e26ad518-6b4e-4ccd-b60c-c06740df8ce1'
const DEFAULT_OFFICE = 'D22072'
const DEFAULT_SECRET = 'A33E3312D2203030FGPV' // Sikka sandbox secret for D22072

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://eymgqjeudrmeofytnwgs.supabase.co'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const APP_ID = process.env.SIKKA_APP_ID
const APP_SECRET = process.env.SIKKA_APP_SECRET

const { values: args } = parseArgs({
  options: {
    practice: { type: 'string', default: GOLD_DENTAL_ID },
    office: { type: 'string', default: DEFAULT_OFFICE },
    secret: { type: 'string', default: DEFAULT_SECRET },
    startdate: { type: 'string', default: '2025-06-01' },
    enddate: { type: 'string', default: '2025-06-30' },
    patients: { type: 'string', default: '10' },
    'appointments-only': { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  },
})

const TYPE_RE = /(consult|implant|new patient implant)/i

function requireEnv(name, value) {
  if (!value) {
    console.error(`Missing ${name}`)
    process.exit(1)
  }
}

function pick(o, ...keys) {
  for (const k of keys) if (o?.[k] != null && o[k] !== '') return o[k]
  return null
}

function str(v) {
  return v == null ? null : String(v).trim() || null
}

function appointmentTime(rec) {
  if (rec.appointment_datetime) return rec.appointment_datetime
  const date = pick(rec, 'appointment_date', 'date')
  const time = pick(rec, 'appointment_time', 'start_time', 'time')
  if (date && typeof time === 'string' && /^\d{1,2}:\d{2}/.test(time)) {
    const d = String(date).slice(0, 10)
    const t = time.length === 5 ? time : time.slice(0, 5)
    return `${d}T${t}:00`
  }
  if (date) return `${String(date).slice(0, 10)}T00:00:00`
  return typeof time === 'string' ? time : null
}

function splitPatientName(name) {
  if (!name) return { first: null, last: null }
  const parts = String(name).trim().split(/\s+/)
  if (parts.length === 1) return { first: parts[0], last: null }
  return { first: parts[0], last: parts.slice(1).join(' ') }
}

async function sikkaRequestKey(officeId, secretKey) {
  const res = await fetch('https://api.sikkasoft.com/v4/request_key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'request_key',
      office_id: officeId,
      secret_key: secretKey,
      app_id: APP_ID,
      app_key: APP_SECRET,
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Sikka request_key failed: ${JSON.stringify(data).slice(0, 300)}`)
  return data
}

async function sikkaGet(path, requestKey, params = {}) {
  const q = new URLSearchParams({ request_key: requestKey, ...params })
  const res = await fetch(`https://api.sikkasoft.com/v4${path}?${q}`, {
    headers: { Accept: 'application/json', 'Request-Key': requestKey },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Sikka GET ${path} ${res.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text)
}

function unwrapItems(data) {
  if (Array.isArray(data?.items)) return data.items
  if (Array.isArray(data?.data?.items)) return data.data.items
  if (Array.isArray(data)) return data
  return []
}

async function supabaseUpsert(table, rows, onConflict) {
  if (!rows.length) return { count: 0 }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Supabase upsert ${table} failed: ${text.slice(0, 400)}`)
  }
  return { count: rows.length }
}

async function supabasePatchPractice(practiceId, patch) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/practices?id=eq.${practiceId}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(patch),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Supabase patch practices failed: ${text.slice(0, 400)}`)
  }
  return res.json()
}

function mapPatient(practiceId, officeId, r) {
  return {
    practice_id: practiceId,
    office_id: officeId,
    external_id: str(pick(r, 'patient_id', 'patient_sr_no', 'external_id', 'id')),
    first_name: str(pick(r, 'firstname', 'first_name')),
    last_name: str(pick(r, 'lastname', 'last_name')),
    phone: str(pick(r, 'cell', 'mobile_phone', 'phone', 'home_phone')),
    email: str(pick(r, 'email')),
    date_of_birth: str(pick(r, 'birthdate', 'date_of_birth', 'dob'))?.slice(0, 10) ?? null,
    raw: r,
    updated_at: new Date().toISOString(),
  }
}

function mapProvider(practiceId, officeId, r) {
  const first = str(pick(r, 'firstname', 'first_name'))
  const last = str(pick(r, 'lastname', 'last_name'))
  return {
    practice_id: practiceId,
    office_id: officeId,
    external_id: str(pick(r, 'provider_id', 'provider_sr_no', 'external_id', 'id')),
    name: str(pick(r, 'provider_name', 'name')) ?? ([first, last].filter(Boolean).join(' ') || null),
    first_name: first,
    last_name: last,
    specialty: str(pick(r, 'specialty', 'provider_specialty', 'specialty_code')),
    raw: r,
    updated_at: new Date().toISOString(),
  }
}

function mapAppointment(practiceId, r) {
  const type = str(pick(r, 'appointment_type', 'type', 'description', 'procedure_code1'))
  const { first, last } = splitPatientName(pick(r, 'patient_name'))
  return {
    practice_id: practiceId,
    pms_appointment_id: str(pick(r, 'appointment_sr_no', 'sikka_appointment_id', 'appointment_id', 'id')),
    patient_first: str(pick(r, 'patient_first_name', 'firstname', 'first_name')) ?? first,
    patient_last: str(pick(r, 'patient_last_name', 'lastname', 'last_name')) ?? last,
    patient_phone: str(pick(r, 'cell', 'mobile_phone', 'phone', 'patient_phone')),
    patient_email: str(pick(r, 'email', 'patient_email')),
    appointment_time: appointmentTime(r),
    appointment_type: type,
    provider: str(pick(r, 'provider_name', 'provider_id', 'provider')),
    duration_minutes: pick(r, 'duration_minutes', 'length') ? Number(pick(r, 'duration_minutes', 'length')) : null,
    is_implant_consult: TYPE_RE.test(type || ''),
    treatment_type: null,
    tx_plan_value: pick(r, 'amount', 'procedure_code1_amount') ? Number(pick(r, 'amount', 'procedure_code1_amount')) : null,
  }
}

async function main() {
  requireEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE_KEY)
  requireEnv('SIKKA_APP_ID', APP_ID)
  requireEnv('SIKKA_APP_SECRET', APP_SECRET)

  const practiceId = args.practice
  const officeId = args.office
  const secretKey = args.secret
  const dryRun = args['dry-run']

  console.log(`Practice: ${practiceId}`)
  console.log(`Sikka office: ${officeId}`)
  if (dryRun) console.log('DRY RUN — no writes')

  const token = await sikkaRequestKey(officeId, secretKey)
  const requestKey = token.request_key
  const refreshKey = token.refresh_key
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  const patientLimit = String(args.patients)
  const appointmentsOnly = args['appointments-only']

  const appointmentsRaw = await sikkaGet('/appointments', requestKey, {
    office_id: officeId,
    startdate: args.startdate,
    enddate: args.enddate,
    limit: '50',
  })

  let patients = []
  let providers = []
  if (!appointmentsOnly) {
    const [patientsRaw, providersRaw] = await Promise.all([
      sikkaGet('/patients', requestKey, { office_id: officeId, limit: patientLimit }),
      sikkaGet('/providers', requestKey, { office_id: officeId, limit: '5' }),
    ])
    patients = unwrapItems(patientsRaw).map((r) => mapPatient(practiceId, officeId, r)).filter((r) => r.external_id)
    providers = unwrapItems(providersRaw).map((r) => mapProvider(practiceId, officeId, r)).filter((r) => r.external_id)
  }

  const appointments = unwrapItems(appointmentsRaw).map((r) => mapAppointment(practiceId, r)).filter((r) => r.pms_appointment_id)

  console.log('\nSample pulled from Sikka:')
  console.log(`  patients: ${patients.length}`)
  console.log(`  providers: ${providers.length}`)
  console.log(`  appointments (${args.startdate} → ${args.enddate}): ${appointments.length}`)
  if (patients[0]) {
    console.log('\nExample patient mapping:')
    console.log(`  Sikka patient_id ${patients[0].external_id} → pms_patients.external_id`)
    console.log(`  ${patients[0].first_name} ${patients[0].last_name}`)
  }
  if (appointments[0]) {
    console.log('\nExample appointment mapping:')
    console.log(`  Sikka appointment_sr_no ${appointments[0].pms_appointment_id} → pms_appointments.pms_appointment_id`)
    console.log(`  time: ${appointments[0].appointment_time}, type: ${appointments[0].appointment_type}`)
  }

  if (dryRun) return

  const practicePatch = {
    sikka_practice_id: officeId,
    sikka_connected: true,
    sikka_request_key: requestKey,
    sikka_refresh_token: refreshKey,
    sikka_token_expires_at: expiresAt,
    pms_type: 'opendental',
    pms_last_synced_at: new Date().toISOString(),
  }

  const [practice] = await supabasePatchPractice(practiceId, practicePatch)
  console.log(`\nLinked practice "${practice.name}" → Sikka office ${practice.sikka_practice_id}`)

  let p1 = { count: 0 }
  let p2 = { count: 0 }
  if (!appointmentsOnly) {
    p1 = await supabaseUpsert('pms_patients', patients, 'practice_id,external_id')
    p2 = await supabaseUpsert('pms_providers', providers, 'practice_id,external_id')
  }
  const p3 = await supabaseUpsert('pms_appointments', appointments, 'practice_id,pms_appointment_id')

  console.log('\nUpserted into prod:')
  if (!appointmentsOnly) {
    console.log(`  pms_patients: ${p1.count}`)
    console.log(`  pms_providers: ${p2.count}`)
  }
  console.log(`  pms_appointments: ${p3.count}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
