#!/usr/bin/env node
/**
 * Seed Power Dialer call touchpoints for a practice (managed Supabase).
 *
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-power-dialer.mjs \
 *     --practice e26ad518-6b4e-4ccd-b60c-c06740df8ce1
 */
import { parseArgs } from 'node:util'

const PROJECT_URL = process.env.SUPABASE_URL || 'https://eymgqjeudrmeofytnwgs.supabase.co'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const { values } = parseArgs({
  options: {
    practice: { type: 'string', default: 'e26ad518-6b4e-4ccd-b60c-c06740df8ce1' },
  },
})

if (!SERVICE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const practiceId = values.practice

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  }
  if (prefer) headers.Prefer = prefer
  const res = await fetch(`${PROJECT_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} ${res.status}: ${text}`)
  return text ? JSON.parse(text) : null
}

const CONSULT_PATCHES = [
  {
    id: '79136c85-660f-4048-8ffe-7622532555eb',
    patient_name: 'John Smith',
    patient_phone: '(512) 555-0142',
    exit_intent_level: 'warm',
    objection_type: 'price',
    status: 'analyzed',
  },
  {
    id: '9ed7d629-09aa-44de-9401-f482a56ec761',
    patient_name: 'Sarah Johnson',
    patient_phone: '(512) 555-0199',
    exit_intent_level: 'warm',
    objection_type: 'price',
    status: 'analyzed',
  },
  {
    id: 'cb8129ca-0d94-454f-8ad8-21ba7dc538ec',
    patient_name: 'Sarah Johnson',
    patient_phone: '(512) 555-0288',
    exit_intent_level: 'hot',
    objection_type: 'spouse',
    status: 'analyzed',
  },
]

const CALL_MESSAGES = [
  {
    consult_id: '79136c85-660f-4048-8ffe-7622532555eb',
    body: 'Call: follow up on financing options before the August family reunion.',
    send_day: 3,
  },
  {
    consult_id: '9ed7d629-09aa-44de-9401-f482a56ec761',
    body: 'Call: address speech concern and monthly payment breakdown before her open house.',
    send_day: 1,
  },
  {
    consult_id: 'cb8129ca-0d94-454f-8ad8-21ba7dc538ec',
    body: 'Call: offer a quick joint call so she and her spouse hear the same numbers.',
    send_day: 7,
  },
]

const MARIA = {
  patient_name: 'Maria Lopez',
  patient_phone: '(512) 555-0367',
  patient_email: 'maria.lopez@example.com',
  status: 'analyzed',
  objection_type: 'timing',
  exit_intent_level: 'long_term',
  personal_detail: "Wants to wait until after her daughter's wedding in September.",
  tc_action: 'Warm check-in call — no pressure, offer a quick 15-minute visit when timing feels right.',
  recording_date: new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10),
  body: 'Call: friendly check-in — respect her wedding timeline, keep it low pressure.',
  send_day: 14,
}

async function main() {
  console.log(`Seeding power dialer for practice ${practiceId}…`)

  for (const patch of CONSULT_PATCHES) {
    const { id, ...fields } = patch
    await rest(`consults?id=eq.${id}&practice_id=eq.${practiceId}`, { method: 'PATCH', body: fields })
    console.log(`  updated consult ${fields.patient_name}`)
  }

  // Maria Lopez — reuse if already seeded.
  let mariaId
  const existingMaria = await rest(
    `consults?practice_id=eq.${practiceId}&patient_phone=eq.${encodeURIComponent(MARIA.patient_phone)}&select=id&limit=1`,
  )
  if (existingMaria?.[0]?.id) {
    mariaId = existingMaria[0].id
    const { body: _b, send_day: _d, ...fields } = MARIA
    await rest(`consults?id=eq.${mariaId}`, { method: 'PATCH', body: fields })
    console.log('  updated consult Maria Lopez')
  } else {
    const { body: _b, send_day: _d, ...fields } = MARIA
    const created = await rest('consults', {
      method: 'POST',
      body: { practice_id: practiceId, ...fields },
      prefer: 'return=representation',
    })
    mariaId = created[0].id
    console.log('  created consult Maria Lopez')
  }

  // Clear old call touchpoints.
  await rest(`messages?practice_id=eq.${practiceId}&or=(channel.eq.call,type.eq.call)`, { method: 'DELETE' })

  const now = new Date().toISOString()
  const rows = [
    ...CALL_MESSAGES.map((m) => ({
      consult_id: m.consult_id,
      practice_id: practiceId,
      type: 'call',
      channel: 'call',
      subject: null,
      body: m.body,
      status: 'scheduled',
      send_day: m.send_day,
      scheduled_for: now,
      created_at: now,
    })),
    {
      consult_id: mariaId,
      practice_id: practiceId,
      type: 'call',
      channel: 'call',
      subject: null,
      body: MARIA.body,
      status: 'scheduled',
      send_day: MARIA.send_day,
      scheduled_for: now,
      created_at: now,
    },
  ]

  const inserted = await rest('messages', { method: 'POST', body: rows, prefer: 'return=representation' })
  console.log(`  inserted ${inserted.length} call touchpoints due today`)

  const queue = await rest(
    `messages?practice_id=eq.${practiceId}&or=(channel.eq.call,type.eq.call)&status=in.(scheduled,pending,draft)&scheduled_for=lte.${encodeURIComponent(new Date().toISOString())}&select=id,send_day,status,scheduled_for,consults(patient_name,patient_phone)&order=scheduled_for.asc`,
  )

  console.log('\nPower dialer queue:')
  for (const m of queue) {
    console.log(`  - ${m.consults?.patient_name} · ${m.consults?.patient_phone} · Day ${m.send_day}`)
  }
  console.log(`\nDone — ${queue.length} call(s) due today. Refresh Power Dialer in the app.`)
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
