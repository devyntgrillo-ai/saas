#!/usr/bin/env node
/**
 * Seed unscheduled treatment-plan consults for Faith Clinic so the one-off
 * Reactivation Campaign builder has a realistic audience.
 *
 *   node scripts/seed-faith-clinic-reactivation.mjs
 *
 * Uses SUPABASE_SERVICE_ROLE_KEY or Supabase CLI api-keys (managed project).
 */
import { parseArgs } from 'node:util'

const PROJECT_URL = process.env.SUPABASE_URL || 'https://eymgqjeudrmeofytnwgs.supabase.co'
const FAITH_CLINIC_ID = 'b070a386-0c56-4235-9b8c-4cc659d067d0'
const MARKER = '@faith.reactivation.demo'

const { values } = parseArgs({
  options: {
    practice: { type: 'string', default: FAITH_CLINIC_ID },
    'test-phone': { type: 'string', default: '+12087196805' },
    'test-email': { type: 'string', default: 'reaperguy72@gmail.com' },
  },
})

async function getServiceKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY
  const res = await fetch(`https://api.supabase.com/v1/projects/eymgqjeudrmeofytnwgs/api-keys`, {
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN || ''}` },
  }).catch(() => null)
  if (res?.ok) {
    const keys = await res.json()
    const k = keys.find((x) => x.name === 'service_role')
    if (k?.api_key) return k.api_key
  }
  const { execSync } = await import('node:child_process')
  try {
    const out = execSync('npx supabase projects api-keys --project-ref eymgqjeudrmeofytnwgs -o json', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const keys = JSON.parse(out)
    const k = keys.find((x) => x.name === 'service_role')
    if (k?.api_key) return k.api_key
  } catch {
    /* fall through */
  }
  throw new Error('Set SUPABASE_SERVICE_ROLE_KEY or run with Supabase CLI logged in')
}

async function rest(serviceKey, path, { method = 'GET', body, prefer } = {}) {
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  }
  if (prefer) headers.Prefer = prefer
  const res = await fetch(`${PROJECT_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`)
  return text ? JSON.parse(text) : null
}

function daysAgoIso(n) {
  return new Date(Date.now() - n * 86400000).toISOString()
}

function daysAgoDate(n) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)
}

const PATIENTS = [
  {
    patient_first: 'Jordan',
    patient_last: 'Reyes',
    patient_name: 'Jordan Reyes',
    patient_phone: values['test-phone'],
    patient_email: values['test-email'],
    treatment_type: 'dental_implants',
    case_value: 12500,
    tx_plan_value: 12500,
    objection_type: 'price',
    exit_intent_level: 'warm',
    daysAgo: 92,
    note: 'PRIMARY TEST — your phone + email for SMS/email reply testing',
  },
  {
    patient_first: 'Patricia',
    patient_last: 'Nguyen',
    patient_name: 'Patricia Nguyen',
    patient_phone: '(208) 555-0151',
    patient_email: `patricia.nguyen${MARKER}`,
    treatment_type: 'full_arch',
    case_value: 38000,
    tx_plan_value: 38000,
    objection_type: 'price',
    exit_intent_level: 'warm',
    daysAgo: 212,
  },
  {
    patient_first: 'Denise',
    patient_last: 'Carraway',
    patient_name: 'Denise Carraway',
    patient_phone: '(208) 555-0153',
    patient_email: `denise.carraway${MARKER}`,
    treatment_type: 'dental_implants',
    case_value: 12000,
    tx_plan_value: 12000,
    objection_type: 'price',
    exit_intent_level: 'hot',
    daysAgo: 145,
  },
  {
    patient_first: 'Sophia',
    patient_last: 'Reyes',
    patient_name: 'Sophia Reyes',
    patient_phone: '(208) 555-0155',
    patient_email: `sophia.reyes${MARKER}`,
    treatment_type: 'invisalign',
    case_value: 6800,
    tx_plan_value: 6800,
    objection_type: 'timing',
    exit_intent_level: 'long_term',
    daysAgo: 178,
  },
  {
    patient_first: 'Harold',
    patient_last: 'Pruitt',
    patient_name: 'Harold Pruitt',
    patient_phone: '(208) 555-0156',
    patient_email: `harold.pruitt${MARKER}`,
    treatment_type: 'full_mouth_rehab',
    case_value: 27000,
    tx_plan_value: 27000,
    objection_type: 'fear',
    exit_intent_level: 'warm',
    daysAgo: 189,
  },
  {
    patient_first: 'Yvonne',
    patient_last: 'Castillo',
    patient_name: 'Yvonne Castillo',
    patient_phone: '(208) 555-0157',
    patient_email: `yvonne.castillo${MARKER}`,
    treatment_type: 'cosmetic_veneers',
    case_value: 14000,
    tx_plan_value: 14000,
    objection_type: 'spouse',
    exit_intent_level: 'warm',
    daysAgo: 233,
  },
  {
    patient_first: 'Megan',
    patient_last: 'Ipsen',
    patient_name: 'Megan Ipsen',
    patient_phone: '(208) 555-0165',
    patient_email: `megan.ipsen${MARKER}`,
    treatment_type: 'invisalign',
    case_value: 7200,
    tx_plan_value: 7200,
    objection_type: 'price',
    exit_intent_level: 'hot',
    daysAgo: 118,
  },
  {
    patient_first: 'Curtis',
    patient_last: 'Fairbanks',
    patient_name: 'Curtis Fairbanks',
    patient_phone: '(208) 555-0166',
    patient_email: `curtis.fairbanks${MARKER}`,
    treatment_type: 'dental_implants',
    case_value: 13500,
    tx_plan_value: 13500,
    objection_type: 'timing',
    exit_intent_level: 'long_term',
    daysAgo: 167,
  },
]

async function main() {
  const serviceKey = await getServiceKey()
  const practiceId = values.practice

  const practice = await rest(
    serviceKey,
    `practices?id=eq.${practiceId}&select=id,name,sms_enabled,email_enabled,a2p_brand_status,a2p_campaign_status`,
  )
  if (!practice?.[0]) throw new Error(`Practice ${practiceId} not found`)
  console.log('Practice:', practice[0].name)
  console.log('SMS:', practice[0].sms_enabled, '| A2P:', practice[0].a2p_brand_status, '/', practice[0].a2p_campaign_status)
  console.log('Email enabled:', practice[0].email_enabled)

  // Remove prior seed rows (idempotent).
  const old = await rest(
    serviceKey,
    `consults?practice_id=eq.${practiceId}&patient_email=like.*${encodeURIComponent(MARKER)}&select=id`,
  )
  if (old?.length) {
    const ids = old.map((r) => r.id).join(',')
    await rest(serviceKey, `consults?id=in.(${ids})`, { method: 'DELETE' })
    console.log(`Removed ${old.length} prior seed consult(s).`)
  }

  const rows = PATIENTS.map((p) => {
    const created = daysAgoIso(p.daysAgo)
    return {
      practice_id: practiceId,
      patient_name: p.patient_name,
      patient_first: p.patient_first,
      patient_last: p.patient_last,
      patient_phone: p.patient_phone,
      patient_email: p.patient_email,
      treatment_type: p.treatment_type,
      case_value: p.case_value,
      tx_plan_value: p.tx_plan_value,
      objection_type: p.objection_type,
      exit_intent_level: p.exit_intent_level,
      outcome: 'pending',
      status: 'analyzed',
      sequence_activated_at: null,
      sequence_cancelled_at: null,
      recording_date: daysAgoDate(p.daysAgo),
      created_at: created,
    }
  })

  const inserted = await rest(serviceKey, 'consults', {
    method: 'POST',
    prefer: 'return=representation',
    body: rows,
  })

  console.log(`\nSeeded ${inserted.length} reactivation audience consult(s):\n`)
  for (const row of inserted) {
    const src = PATIENTS.find((p) => p.patient_email === row.patient_email || p.patient_name === row.patient_name)
    const tag = src?.note ? `  ← ${src.note}` : ''
    console.log(
      `  • ${row.patient_name} | ${row.treatment_type} | $${row.case_value} | TX ${row.recording_date}${tag}`,
    )
  }

  // Audience count matching default builder filters (365d → 14d ago, no active sequence).
  const txStart = daysAgoIso(365)
  const txEnd = new Date(`${daysAgoDate(14)}T23:59:59`).toISOString()
  const audience = await rest(
    serviceKey,
    `consults?practice_id=eq.${practiceId}` +
      `&created_at=gte.${encodeURIComponent(txStart)}` +
      `&created_at=lte.${encodeURIComponent(txEnd)}` +
      `&select=id,patient_name,sequence_activated_at,sequence_cancelled_at,outcome`,
  )
  const eligible = (audience || []).filter(
    (c) => !(c.sequence_activated_at && !c.sequence_cancelled_at && c.outcome === 'pending'),
  )
  console.log(`\nDefault audience window (14d–365d ago): ${eligible.length} eligible patient(s).`)

  console.log(`
Next steps (Faith Clinic → Sequences → Campaigns → Reactivation Campaign):
  1. Step 1 Filter — defaults should show ~${eligible.length} patients
  2. Step 2 — select patients (Jordan Reyes = your test contact)
  3. Step 4 — Launch Reactivation Blast

To force-send Day 1 messages immediately (bypass send window):
  curl -X POST ${PROJECT_URL}/functions/v1/process-reactivation-drip \\
    -H "Authorization: Bearer <service_role>" \\
    -H "Content-Type: application/json" \\
    -d '{"force":true}'

Note: Outbound SMS requires A2P approval (Faith Clinic is currently pending).
      Email (Day 10) works if Mailgun is configured. UI + enrollments still testable now.
`)
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
