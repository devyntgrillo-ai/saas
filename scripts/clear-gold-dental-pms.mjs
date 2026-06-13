#!/usr/bin/env node
/**
 * Delete ingested PMS data for Gold Dental so consult sync can be redone
 * with the discovery → AI classification → approval flow.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/clear-gold-dental-pms.mjs
 *
 * Optional: --practice <uuid>  (default: Gold Dental)
 *           --dry-run
 */
import { parseArgs } from 'node:util'

const GOLD_DENTAL_ID = 'e26ad518-6b4e-4ccd-b60c-c06740df8ce1'
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://eymgqjeudrmeofytnwgs.supabase.co'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const { values: args } = parseArgs({
  options: {
    practice: { type: 'string', default: GOLD_DENTAL_ID },
    'dry-run': { type: 'boolean', default: false },
  },
})

if (!SERVICE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

async function rest(path, method = 'GET', body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: method === 'DELETE' ? 'return=representation' : 'return=minimal',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

async function count(table, practiceId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?practice_id=eq.${practiceId}&select=id`,
    {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Prefer: 'count=exact',
        Range: '0-0',
      },
    },
  )
  const range = res.headers.get('content-range') || ''
  const m = range.match(/\/(\d+)/)
  return m ? Number(m[1]) : 0
}

async function main() {
  const practiceId = args.practice
  console.log(`Practice: ${practiceId}`)
  console.log(`Dry run: ${args['dry-run']}`)

  const before = {
    appointments: await count('pms_appointments', practiceId),
    patients: await count('pms_patients', practiceId),
    providers: await count('pms_providers', practiceId),
  }
  console.log('Before:', before)

  if (args['dry-run']) {
    console.log('Would delete PMS rows and reset sync calibration state.')
    return
  }

  await rest(`pms_appointments?practice_id=eq.${practiceId}`, 'DELETE')
  await rest(`pms_patients?practice_id=eq.${practiceId}`, 'DELETE')
  await rest(`pms_providers?practice_id=eq.${practiceId}`, 'DELETE')
  await rest(`pms_transactions?practice_id=eq.${practiceId}`, 'DELETE')
  await rest(`pms_sync_log?practice_id=eq.${practiceId}`, 'DELETE')

  await rest(`practices?id=eq.${practiceId}`, 'PATCH', {
    sikka_practice_id: null,
    sikka_connected: false,
    sikka_request_key: null,
    sikka_refresh_token: null,
    sikka_token_expires_at: null,
    sikka_oauth_nonce: null,
    pms_connected: false,
    pms_type: null,
    pms_status: null,
    pms_last_sync: null,
    pms_sync_approved_at: null,
    pms_sync_rules: null,
    pms_sync_status: 'draft',
    pms_history_years: 1,
    pms_forward_years: 1,
    pms_last_synced_at: null,
  })

  const after = {
    appointments: await count('pms_appointments', practiceId),
    patients: await count('pms_patients', practiceId),
    providers: await count('pms_providers', practiceId),
  }
  console.log('After:', after)
  console.log('Done — run discovery from Settings → PMS for Gold Dental.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
