#!/usr/bin/env node
/**
 * Reset Faith Clinic reactivation campaigns and seed a 3-email / 5-minute test
 * for Alex Morgan (same contact info as Jordan Reyes).
 *
 *   node scripts/reset-faith-reactivation-email-test.mjs           # draft (ready to launch)
 *   node scripts/reset-faith-reactivation-email-test.mjs --launch  # activate + start timer
 */
import { parseArgs } from 'node:util'

const PROJECT_URL = process.env.SUPABASE_URL || 'https://eymgqjeudrmeofytnwgs.supabase.co'
const FAITH_CLINIC_ID = 'b070a386-0c56-4235-9b8c-4cc659d067d0'
const { values } = parseArgs({
  options: { launch: { type: 'boolean', default: false } },
})

async function getServiceKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY
  const { execSync } = await import('node:child_process')
  const out = execSync('npx supabase projects api-keys --project-ref eymgqjeudrmeofytnwgs -o json', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return JSON.parse(out).find((x) => x.name === 'service_role').api_key
}

async function rest(key, path, { method = 'GET', body, prefer } = {}) {
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
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

const PATIENT = {
  patient_first: 'Alex',
  patient_last: 'Morgan',
  patient_name: 'Alex Morgan',
  patient_phone: '+12087196805',
  patient_email: 'reaperguy72@gmail.com',
  treatment_type: 'dental_implants',
  case_value: 12500,
  tx_plan_value: 12500,
  objection_type: 'price',
  exit_intent_level: 'warm',
  daysAgo: 92,
}

const EMAIL_1_SUBJECT = 'Checking in, {{first_name}}'
const EMAIL_1_BODY = `Hi {{first_name}},

It's {{tc_name}} from {{practice_name}}. I was reviewing some charts and thought of you — we talked about {{treatment_type}} back in {{tx_plan_date}}.

Still something you're thinking about? Reply anytime, no pressure.

{{tc_name}}
{{practice_name}}, {{phone_number}}`

const EMAIL_2_SUBJECT = 'Following up, {{first_name}}'
const EMAIL_2_BODY = `Hi {{first_name}},

Just wanted to make sure my last note didn't get lost. No rush at all — I just want you to have everything you need when you're ready.

Anything I can answer for you?

{{tc_name}}
{{practice_name}}`

const EMAIL_3_SUBJECT = 'One more check-in, {{first_name}}'
const EMAIL_3_BODY = `Hi {{first_name}},

I wanted to reach out one more time about the {{treatment_type}} plan we put together for you.

{{doctor_name}} remembers your case, and we're happy to pick up right where we left off whenever you're ready.

Would love to hear from you.

{{tc_name}}
{{practice_name}}, {{phone_number}}`

async function main() {
  const key = await getServiceKey()
  const practiceId = FAITH_CLINIC_ID

  // Ensure step_interval_minutes column exists (idempotent).
  try {
    const { execSync } = await import('node:child_process')
    execSync(
      `npx supabase db query --linked "alter table public.reactivation_campaigns add column if not exists step_interval_minutes int;"`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
  } catch {
    console.warn('Could not apply migration via CLI — ensure step_interval_minutes column exists.')
  }

  // Delete all reactivation campaigns (cascades enrollments).
  const campaigns = await rest(
    key,
    `reactivation_campaigns?practice_id=eq.${practiceId}&select=id,campaign_name`,
  )
  if (campaigns?.length) {
    const ids = campaigns.map((c) => c.id).join(',')
    await rest(key, `reactivation_campaigns?id=in.(${ids})`, { method: 'DELETE' })
    console.log(`Deleted ${campaigns.length} campaign(s): ${campaigns.map((c) => c.campaign_name).join(', ')}`)
  } else {
    console.log('No existing campaigns to delete.')
  }

  // Remove prior Alex Morgan seed consult if re-running.
  const oldAlex = await rest(
    key,
    `consults?practice_id=eq.${practiceId}&patient_first=eq.Alex&patient_last=eq.Morgan&select=id`,
  )
  if (oldAlex?.length) {
    await rest(key, `consults?id=in.(${oldAlex.map((c) => c.id).join(',')})`, { method: 'DELETE' })
  }

  const created = daysAgoIso(PATIENT.daysAgo)
  const [consult] = await rest(key, 'consults', {
    method: 'POST',
    prefer: 'return=representation',
    body: [{
      practice_id: practiceId,
      patient_name: PATIENT.patient_name,
      patient_first: PATIENT.patient_first,
      patient_last: PATIENT.patient_last,
      patient_phone: PATIENT.patient_phone,
      patient_email: PATIENT.patient_email,
      treatment_type: PATIENT.treatment_type,
      case_value: PATIENT.case_value,
      tx_plan_value: PATIENT.tx_plan_value,
      objection_type: PATIENT.objection_type,
      exit_intent_level: PATIENT.exit_intent_level,
      outcome: 'pending',
      status: 'analyzed',
      sequence_activated_at: null,
      sequence_cancelled_at: null,
      recording_date: daysAgoDate(PATIENT.daysAgo),
      created_at: created,
    }],
  })

  const nowIso = new Date().toISOString()
  const launching = values.launch
  const [campaign] = await rest(key, 'reactivation_campaigns', {
    method: 'POST',
    prefer: 'return=representation',
    body: [{
      practice_id: practiceId,
      campaign_name: 'Email test — Alex Morgan (5 min)',
      angle_type: 'email_test_5m',
      message_1_sms: null,
      message_1_email_subject: EMAIL_1_SUBJECT,
      message_1_email_body: EMAIL_1_BODY,
      message_2_sms: null,
      message_2_email_subject: EMAIL_2_SUBJECT,
      message_2_email_body: EMAIL_2_BODY,
      message_3_sms: null,
      message_3_email_subject: EMAIL_3_SUBJECT,
      message_3_email_body: EMAIL_3_BODY,
      tx_date_start: daysAgoDate(365),
      tx_date_end: daysAgoDate(14),
      treatment_types: [],
      total_recipients: 1,
      messages_per_day: 50,
      step_interval_minutes: 5,
      send_window_start: 0,
      send_window_end: 24,
      send_days: 'mon_sat',
      status: launching ? 'active' : 'draft',
      scheduled_start: launching ? nowIso : null,
      started_at: launching ? nowIso : null,
      launched_at: launching ? nowIso : null,
    }],
  })

  await rest(key, 'reactivation_enrollments', {
    method: 'POST',
    body: [{
      campaign_id: campaign.id,
      practice_id: practiceId,
      consult_id: consult.id,
      patient_first: PATIENT.patient_first,
      patient_last: PATIENT.patient_last,
      patient_phone: PATIENT.patient_phone,
      patient_email: PATIENT.patient_email,
      treatment_type: PATIENT.treatment_type,
      tx_plan_date: daysAgoDate(PATIENT.daysAgo),
      status: 'pending',
    }],
  })

  console.log(`
Faith Clinic reactivation reset complete.

Patient:  Alex Morgan
Email:    ${PATIENT.patient_email}  (3 emails, 5 min apart)
Phone:    ${PATIENT.patient_phone}
Campaign: ${campaign.campaign_name}
Status:   ${campaign.status}
ID:       ${campaign.id}
`)

  if (!launching) {
    console.log(`To start the flow:
  node scripts/reset-faith-reactivation-email-test.mjs --launch

Or in Supabase SQL:
  update reactivation_campaigns
     set status = 'active', started_at = now(), launched_at = now(), scheduled_start = now()
   where id = '${campaign.id}';

Schedule (3 emails only, 5 min apart — trigger drip after each wait):
  • Email 1 — at launch (run drip once)
  • Email 2 — +5 min
  • Email 3 — +10 min

Send Email 1 now:
  curl -X POST ${PROJECT_URL}/functions/v1/process-reactivation-drip \\
    -H "Authorization: Bearer <service_role>" -H "Content-Type: application/json" -d '{}'

Then every 5 minutes run the same curl (do NOT use force:true — that skips the 5m gap).
`)
  } else {
    console.log(`Campaign is ACTIVE. Send Email 1:
  curl -X POST ${PROJECT_URL}/functions/v1/process-reactivation-drip \\
    -H "Authorization: Bearer <service_role>" -H "Content-Type: application/json" -d '{}'
`)
  }
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
