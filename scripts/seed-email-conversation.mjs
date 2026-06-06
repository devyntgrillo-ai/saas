#!/usr/bin/env node
/**
 * Seed a sample email thread for testing GHL-style email UI.
 *
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-email-conversation.mjs \
 *     --practice e26ad518-6b4e-4ccd-b60c-c06740df8ce1
 */
import { parseArgs } from 'node:util'

const PROJECT_URL = process.env.SUPABASE_URL || 'https://eymgqjeudrmeofytnwgs.supabase.co'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const { values } = parseArgs({
  options: {
    practice: { type: 'string', default: 'e26ad518-6b4e-4ccd-b60c-c06740df8ce1' },
    consult: { type: 'string', default: '79136c85-660f-4048-8ffe-7622532555eb' },
    email: { type: 'string', default: 'john.smith.test@example.com' },
  },
})

if (!SERVICE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

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

async function main() {
  const practiceId = values.practice
  const consultId = values.consult
  const patientEmail = values.email
  const now = new Date().toISOString()
  const yesterday = new Date(Date.now() - 86400000).toISOString()

  let convId
  const existing = await rest(
    `conversations?practice_id=eq.${practiceId}&patient_email=eq.${encodeURIComponent(patientEmail)}&select=id&limit=1`,
  )
  if (existing?.[0]?.id) {
    convId = existing[0].id
    await rest(`conversation_messages?conversation_id=eq.${convId}`, { method: 'DELETE' })
    await rest(`conversations?id=eq.${convId}`, {
      method: 'PATCH',
      body: {
        patient_first: 'John',
        patient_last: 'Smith',
        patient_email: patientEmail,
        patient_phone: '(512) 555-0142',
        consult_id: consultId,
        last_message_at: now,
        last_message_preview: 'Hi team, Please call this new lead about financing options.',
        unread_count: 1,
      },
    })
    console.log('Updated existing email conversation')
  } else {
    const created = await rest('conversations', {
      method: 'POST',
      body: [{
        practice_id: practiceId,
        consult_id: consultId,
        patient_first: 'John',
        patient_last: 'Smith',
        patient_email: patientEmail,
        patient_phone: '(512) 555-0142',
        last_message_at: now,
        last_message_preview: 'Hi team, Please call this new lead about financing options.',
        unread_count: 1,
      }],
      prefer: 'return=representation',
    })
    convId = created[0].id
    console.log('Created email conversation')
  }

  await rest('conversation_messages', {
    method: 'POST',
    body: [
      {
        conversation_id: convId,
        direction: 'inbound',
        channel: 'email',
        body: 'Hi team,\n\nPlease call this new lead about financing options before the August reunion.\n\nName: John Smith\nEmail: john.smith.test@example.com\nPhone: (512) 555-0142\n\nOpen Portal >> https://example.com/portal',
        sent_at: yesterday,
        created_at: yesterday,
        meta: { subject: 'New Lead from Method Pro' },
      },
      {
        conversation_id: convId,
        direction: 'outbound',
        channel: 'email',
        body: 'Hi John,\n\nThanks for reaching out! I would love to walk you through our monthly financing options. Would Thursday afternoon work for a quick call?\n\nBest,\nSara',
        sent_at: now,
        created_at: now,
        meta: { subject: 'Re: New Lead from Method Pro' },
      },
    ],
  })

  console.log(`Done — open Conversations and select ${patientEmail}`)
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
