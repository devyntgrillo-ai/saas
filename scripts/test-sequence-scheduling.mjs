#!/usr/bin/env node
/**
 * Local verification for follow-up sequence scheduling.
 * Run: node scripts/test-sequence-scheduling.mjs
 */
import { createClient } from '@supabase/supabase-js'
import {
  TIMING_PRESETS,
  resolveTouchpoints,
  computeScheduledFor,
  rulesFromConfig,
  scheduleConsultMessages,
} from '../src/lib/sequence.js'

const URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321'
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!KEY) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY (see supabase/.env.local)')
  process.exit(1)
}

const admin = createClient(URL, KEY, { auth: { persistSession: false } })
let passed = 0
let failed = 0

function ok(label, detail = '') {
  passed++
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`)
}
function fail(label, detail = '') {
  failed++
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
}

function assert(cond, label, detail) {
  if (cond) ok(label, detail)
  else fail(label, detail)
}

console.log('\n=== Unit: timing presets & computeScheduledFor ===\n')

const hot = resolveTouchpoints(null, 'hot')
assert(hot.length === 6 && hot[0].day === 0 && hot[1].day === 1, 'hot preset days (6 steps)', JSON.stringify(hot.map((t) => t.day)))
assert(hot[0].channel === 'sms' && hot[1].channel === 'email', 'hot preset channels')

const warm = resolveTouchpoints(null, 'warm')
assert(warm[2].day === 7 && warm[2].channel === 'sms', 'warm preset day 7 sms')

const rules = rulesFromConfig(null, 'America/Chicago')
const created = '2026-06-02T15:00:00.000Z' // 10am Central
const day0 = computeScheduledFor(created, 0, rules)
const day0Date = new Date(day0)
// Hold 24h → earliest send ~ Jun 3 15:00 UTC, then quiet hours push to 8am Central = 13:00 UTC
assert(day0Date.getTime() >= new Date('2026-06-03T13:00:00Z').getTime() - 60000, 'day0 respects hold + quiet (Central)', day0)

console.log('\n=== DB: migrations & cron ===\n')

const { data: prac, error: pe } = await admin.from('practices').select('id, timezone, auto_start_followup, sequence_config').limit(1).single()
if (pe) fail('load practice', pe.message)
else {
  ok('practice loaded', prac.id)
  assert(prac.timezone === 'America/Chicago' || prac.timezone, 'timezone column', prac.timezone)
}

const TEST_EMAIL = 'sched-test@local.test'
const { data: oldConsult } = await admin.from('consults').select('id').eq('patient_email', TEST_EMAIL).maybeSingle()
if (oldConsult?.id) await admin.from('consults').delete().eq('id', oldConsult.id)

const seqConfig = typeof prac.sequence_config === 'string' ? prac.sequence_config : JSON.stringify(prac.sequence_config || {})
const touchpoints = resolveTouchpoints(seqConfig, 'hot')
const seqRules = rulesFromConfig(seqConfig, prac.timezone)
const consultCreated = new Date(Date.now() - 48 * 3600 * 1000).toISOString() // 48h ago → past hold

const { data: consult, error: ce } = await admin.from('consults').insert({
  practice_id: prac.id,
  patient_name: 'Schedule Test',
  patient_phone: '+15555550199',
  patient_email: TEST_EMAIL,
  status: 'analyzed',
  outcome: 'pending',
  sequence_timing_preset: 'hot',
  created_at: consultCreated,
  followup_approved_at: null,
  sequence_activated_at: null,
}).select('id, created_at').single()

if (ce) {
  fail('insert consult', ce.message)
  process.exit(1)
}
ok('test consult created', consult.id)

const rows = touchpoints.slice(0, 4).map((tp, i) => ({
  consult_id: consult.id,
  practice_id: prac.id,
  type: i === 0 ? 'followup' : 'nurture',
  channel: tp.channel,
  subject: tp.channel === 'email' ? 'Test subject' : null,
  body: `Test body ${i} for ${tp.channel}`,
  status: 'draft',
  send_day: tp.day,
  scheduled_for: null,
}))

const { error: me } = await admin.from('messages').insert(rows)
if (me) fail('insert draft messages', me.message)
else ok('draft messages (manual start)', String(rows.length))

console.log('\n=== Approve & schedule (scheduleConsultMessages) ===\n')

await scheduleConsultMessages(admin, {
  consultId: consult.id,
  createdAt: consult.created_at,
  sequenceConfig: seqConfig,
  practiceTimezone: prac.timezone,
  timingPreset: 'hot',
})

const { data: afterApprove } = await admin.from('consults').select('followup_approved_at').eq('id', consult.id).single()
assert(!!afterApprove?.followup_approved_at, 'followup_approved_at set')

const { data: msgs } = await admin.from('messages').select('id, status, send_day, scheduled_for, channel').eq('consult_id', consult.id).order('send_day')
assert(msgs?.every((m) => m.status === 'scheduled' && m.scheduled_for), 'all messages scheduled')
assert(msgs?.[0]?.send_day === 0 && msgs?.[1]?.send_day === 1, 'send_day matches hot preset')

for (const m of msgs || []) {
  const expected = computeScheduledFor(consult.created_at, m.send_day, seqRules)
  const diff = Math.abs(new Date(m.scheduled_for).getTime() - new Date(expected).getTime())
  if (diff > 1000) fail(`scheduled_for day ${m.send_day}`, `got ${m.scheduled_for} expected ${expected}`)
  else ok(`scheduled_for day ${m.send_day}`, m.scheduled_for)
}

console.log('\n=== Edge: process-sequences & send-due-messages ===\n')

const procRes = await fetch(`${URL}/functions/v1/process-sequences`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ tick: true }),
})
const procJson = await procRes.json()
assert(procRes.ok && procJson.ok, 'process-sequences', JSON.stringify(procJson))

const { data: afterProc } = await admin.from('consults').select('sequence_activated_at').eq('id', consult.id).single()
assert(!!afterProc?.sequence_activated_at, 'sequence_activated_at after hold', afterProc?.sequence_activated_at)

// Force only first message due (others stay in the future)
const firstId = msgs[0].id
const future = new Date(Date.now() + 7 * 86400000).toISOString()
await admin.from('messages').update({ scheduled_for: future }).eq('consult_id', consult.id).neq('id', firstId)
await admin.from('messages').update({ scheduled_for: new Date(Date.now() - 60000).toISOString() }).eq('id', firstId)

const sendRes = await fetch(`${URL}/functions/v1/send-due-messages`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ tick: true }),
})
const sendJson = await sendRes.json()
assert(sendRes.ok && sendJson.ok, 'send-due-messages', JSON.stringify(sendJson))

const { data: sentMsg } = await admin.from('messages').select('status').eq('id', firstId).single()
// SMS may send (twilio) or fail (no creds) — must not skip due to gates
if (sentMsg?.status === 'sent') ok('first message sent via twilio-send')
else if (sentMsg?.status === 'failed') ok('first message attempted (failed transport OK locally)', sentMsg.status)
else fail('first message still pending after send', sentMsg?.status)

// Gate: separate consult, no approval, due message must be skipped
const { data: gateConsult } = await admin.from('consults').insert({
  practice_id: prac.id,
  patient_name: 'Gate Test',
  patient_email: 'gate-only@local.test',
  status: 'analyzed',
  outcome: 'pending',
  created_at: consultCreated,
  sequence_activated_at: new Date().toISOString(),
  followup_approved_at: null,
}).select('id').single()
const { data: gateMsg } = await admin.from('messages').insert({
  consult_id: gateConsult.id,
  practice_id: prac.id,
  type: 'followup',
  channel: 'sms',
  body: 'gate test',
  status: 'scheduled',
  send_day: 0,
  scheduled_for: new Date(Date.now() - 60000).toISOString(),
}).select('id').single()

const send2 = await fetch(`${URL}/functions/v1/send-due-messages`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ tick: true }),
})
const send2Json = await send2.json()
assert((send2Json.skipped ?? 0) >= 1, 'send-due-messages skips unapproved', JSON.stringify(send2Json))
const { data: gated } = await admin.from('messages').select('status').eq('id', gateMsg.id).single()
assert(gated?.status === 'scheduled', 'unapproved message stays scheduled', gated?.status)
await admin.from('consults').delete().eq('id', gateConsult.id)

console.log('\n=== Cleanup ===\n')
await admin.from('consults').delete().eq('id', consult.id)
ok('test consult removed')

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
