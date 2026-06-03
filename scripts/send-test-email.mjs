#!/usr/bin/env node
/**
 * Send a test email via production mailgun-send (same path as Conversations).
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   SUPABASE_ACCESS_TOKEN=eyJ... \   # user JWT from a logged-in browser session
 *   node scripts/send-test-email.mjs \
 *     --practice <uuid> \
 *     --to adeoyeadebayo18@gmail.com
 *
 * Get USER token: DevTools → Application → localStorage → supabase auth token,
 * or sign in and copy session.access_token from the auth storage key.
 */
import { parseArgs } from 'node:util'

const PROJECT_URL = process.env.SUPABASE_URL || 'https://eymgqjeudrmeofytnwgs.supabase.co'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const USER_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || process.env.USER_ACCESS_TOKEN
const ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

const { values } = parseArgs({
  options: {
    practice: { type: 'string' },
    to: { type: 'string', default: 'adeoyeadebayo18@gmail.com' },
    subject: { type: 'string', default: 'Hope AI — Mailgun integration test' },
    body: {
      type: 'string',
      default:
        'This is a test email from Hope AI production (mailgun-send). If you received this, Mailgun is working.',
    },
  },
})

if (!SERVICE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY (Dashboard → API → service_role)')
  process.exit(1)
}
if (!USER_TOKEN) {
  console.error('Missing SUPABASE_ACCESS_TOKEN (user JWT from logged-in session)')
  process.exit(1)
}
if (!values.practice) {
  console.error('Missing --practice <uuid>')
  process.exit(1)
}

const apikey = ANON || SERVICE_KEY

const res = await fetch(`${PROJECT_URL}/functions/v1/mailgun-send`, {
  method: 'POST',
  headers: {
    apikey,
    Authorization: `Bearer ${USER_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    practice_id: values.practice,
    to: values.to,
    subject: values.subject,
    body: values.body,
  }),
})

const text = await res.text()
let data
try {
  data = JSON.parse(text)
} catch {
  data = { raw: text }
}

console.log('status:', res.status)
console.log(JSON.stringify(data, null, 2))
if (!res.ok) process.exit(1)
