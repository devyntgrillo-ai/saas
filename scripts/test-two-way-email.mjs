#!/usr/bin/env node
/**
 * End-to-end two-way email test against production mailgun-send + mailgun-inbound.
 *
 * Usage:
 *   node scripts/test-two-way-email.mjs --to adeoyeadebayo18+3@gmail.com
 */
import { createHmac } from 'node:crypto'
import { parseArgs } from 'node:util'

const PROJECT_URL = 'https://eymgqjeudrmeofytnwgs.supabase.co'
const PRACTICE_ID = 'e26ad518-6b4e-4ccd-b60c-c06740df8ce1' // Gold Dental (email_enabled)

const { values } = parseArgs({
  options: {
    to: { type: 'string', default: 'adeoyeadebayo18+3@gmail.com' },
    'skip-inbound': { type: 'boolean', default: false },
  },
})

async function getServiceKey() {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/eymgqjeudrmeofytnwgs/api-keys`,
    { headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN || ''}` } },
  ).catch(() => null)
  if (res?.ok) {
    const keys = await res.json()
    const k = keys.find((x) => x.name === 'service_role')
    if (k?.api_key) return k.api_key
  }
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY
  throw new Error('Set SUPABASE_SERVICE_ROLE_KEY or run while logged in via supabase CLI')
}

async function sbFetch(serviceKey, path, { method = 'GET', body, prefer } = {}) {
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  }
  if (prefer) headers.Prefer = prefer
  const res = await fetch(`${PROJECT_URL}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`)
  return data
}

function mailgunSignature(signingKey, timestamp, token) {
  return createHmac('sha256', signingKey).update(timestamp + token).digest('hex')
}

async function main() {
  const serviceKey = await getServiceKey()
  const anon =
    process.env.VITE_SUPABASE_ANON_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5bWdxamV1ZHJtZW9meXRud2dzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwMTEyMDcsImV4cCI6MjA5NTU4NzIwN30.RHMOa5aV7H6HoYqIJ61ZSv6RUJ3TkrgvVoMujVr51gQ'
  const to = values.to.trim()

  // Ensure conversation exists with patient email
  let convs = await sbFetch(
    serviceKey,
    `conversations?practice_id=eq.${PRACTICE_ID}&patient_email=eq.${encodeURIComponent(to)}&select=id,patient_email&limit=1`,
  )
  let convId = convs?.[0]?.id
  if (!convId) {
    const created = await sbFetch(serviceKey, 'conversations', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        practice_id: PRACTICE_ID,
        patient_first: 'Adeoye',
        patient_last: 'Test',
        patient_email: to,
        last_message_preview: '2-way email test',
      },
    })
    convId = created[0].id
    console.log('Created conversation:', convId)
  } else {
    console.log('Using conversation:', convId)
  }

  const nowIso = new Date().toISOString()
  const [msg] = await sbFetch(serviceKey, 'conversation_messages', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      conversation_id: convId,
      direction: 'outbound',
      channel: 'email',
      body: 'Please reply to this email to confirm two-way messaging works in CaseLift.',
      sent_at: nowIso,
    },
  })
  console.log('Created outbound message:', msg.id)

  const sendRes = await fetch(`${PROJECT_URL}/functions/v1/mailgun-send`, {
    method: 'POST',
    headers: {
      apikey: anon,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      practice_id: PRACTICE_ID,
      to,
      subject: 'CaseLift — 2-way email test (please reply)',
      body: 'This is a production test from CaseLift.\n\nReply to this email and your reply should appear in Conversations.',
      conversation_message_id: msg.id,
    }),
  })
  const sendData = await sendRes.json()
  console.log('\n--- Outbound (mailgun-send) ---')
  console.log('HTTP', sendRes.status)
  console.log(JSON.stringify(sendData, null, 2))
  if (!sendRes.ok) process.exit(1)

  const replyTo = `reply+${convId}@mysmileinbox.com`
  console.log('\nExpected Reply-To:', replyTo)
  console.log('Check inbox:', to)

  if (values['skip-inbound']) return

  // Simulate patient reply (requires MAILGUN_WEBHOOK_SIGNING_KEY in env for signed webhook)
  const signingKey = process.env.MAILGUN_WEBHOOK_SIGNING_KEY || ''
  const timestamp = String(Math.floor(Date.now() / 1000))
  const token = 'test-token-' + Date.now()
  const signature = signingKey ? mailgunSignature(signingKey, timestamp, token) : ''

  const inboundForm = new FormData()
  inboundForm.set('timestamp', timestamp)
  inboundForm.set('token', token)
  if (signature) inboundForm.set('signature', signature)
  inboundForm.set('sender', to)
  inboundForm.set('from', `Adeoye Test <${to}>`)
  inboundForm.set('recipient', replyTo)
  inboundForm.set('subject', 'Re: CaseLift — 2-way email test')
  inboundForm.set('stripped-text', 'This is a simulated patient reply confirming inbound routing works.')

  const inboundRes = await fetch(`${PROJECT_URL}/functions/v1/mailgun-inbound`, {
    method: 'POST',
    body: inboundForm,
  })
  const inboundData = await inboundRes.json().catch(() => ({}))
  console.log('\n--- Inbound simulation (mailgun-inbound) ---')
  console.log('HTTP', inboundRes.status, signingKey ? '(signed)' : '(unsigned — will 403 if signing key set on server)')
  console.log(JSON.stringify(inboundData, null, 2))

  const inboundMsgs = await sbFetch(
    serviceKey,
    `conversation_messages?conversation_id=eq.${convId}&direction=eq.inbound&channel=eq.email&order=created_at.desc&limit=1&select=id,body,direction,channel,created_at`,
  )
  console.log('\n--- Latest inbound message in DB ---')
  console.log(JSON.stringify(inboundMsgs, null, 2))

  if (inboundRes.ok && inboundMsgs?.[0]) {
    console.log('\n✓ Two-way email path verified (outbound sent + inbound recorded).')
  } else if (sendRes.ok) {
    console.log('\n✓ Outbound sent. Reply from your inbox to complete live inbound test.')
    if (inboundRes.status === 403) {
      console.log('  (Inbound simulation blocked by signature — set MAILGUN_WEBHOOK_SIGNING_KEY locally to simulate.)')
    }
  }
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
