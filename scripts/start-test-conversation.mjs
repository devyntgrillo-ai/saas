#!/usr/bin/env node
/**
 * Start a test SMS conversation through production Supabase (same path as the app).
 *
 * 1) Inserts conversations + conversation_messages via REST (service role)
 * 2) Invokes twilio-send with a user access token (not direct Twilio API)
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ACCESS_TOKEN=... node scripts/start-test-conversation.mjs \
 *     --practice e26ad518-6b4e-4ccd-b60c-c06740df8ce1 \
 *     --to +2348145878086 \
 *     --body "Hello from Hope AI test"
 *
 * Get a user access token by signing in (browser devtools → localStorage auth token)
 * or: npx supabase projects api-keys --project-ref eymgqjeudrmeofytnwgs (service role for step 1 only)
 */
import { parseArgs } from 'node:util'

const PROJECT_URL = process.env.SUPABASE_URL || 'https://eymgqjeudrmeofytnwgs.supabase.co'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const USER_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || process.env.USER_ACCESS_TOKEN
const ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

const { values } = parseArgs({
  options: {
    practice: { type: 'string' },
    to: { type: 'string', default: '+2348145878086' },
    body: {
      type: 'string',
      default: 'Hi — test from Hope AI via production Supabase. Reply to confirm two-way SMS.',
    },
    'first-name': { type: 'string', default: 'Test' },
    'last-name': { type: 'string', default: 'Mobile' },
  },
})

if (!SERVICE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
if (!USER_TOKEN) {
  console.error('Missing SUPABASE_ACCESS_TOKEN (user JWT from a logged-in session)')
  process.exit(1)
}
if (!values.practice) {
  console.error('Missing --practice <uuid>')
  process.exit(1)
}

const apikey = ANON || SERVICE_KEY

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const headers = {
    apikey,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  }
  if (prefer) headers.Prefer = prefer
  const res = await fetch(`${PROJECT_URL}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} ${res.status}: ${text}`)
  return text ? JSON.parse(text) : null
}

async function invokeTwilioSend(payload) {
  const res = await fetch(`${PROJECT_URL}/functions/v1/twilio-send`, {
    method: 'POST',
    headers: {
      apikey: apikey,
      Authorization: `Bearer ${USER_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = { raw: text }
  }
  if (!res.ok) throw new Error(`twilio-send ${res.status}: ${JSON.stringify(data)}`)
  return data
}

const now = new Date().toISOString()
const phone = values.to.startsWith('+') ? values.to : `+${values.to.replace(/\D/g, '')}`

const [conv] = await rest('conversations', {
  method: 'POST',
  prefer: 'return=representation',
  body: {
    practice_id: values.practice,
    patient_first: values['first-name'],
    patient_last: values['last-name'],
    patient_phone: phone,
    last_message_at: now,
    last_message_preview: values.body.slice(0, 80),
    unread_count: 0,
  },
})

const [msg] = await rest('conversation_messages', {
  method: 'POST',
  prefer: 'return=representation',
  body: {
    conversation_id: conv.id,
    direction: 'outbound',
    channel: 'sms',
    body: values.body,
    sent_at: now,
  },
})

console.log('conversation_id:', conv.id)
console.log('message_id:', msg.id)

const send = await invokeTwilioSend({
  practice_id: values.practice,
  to: phone,
  body: values.body,
  conversation_message_id: msg.id,
})

console.log('twilio-send:', send)
console.log('\nOpen Conversations in the app to see the thread.')
