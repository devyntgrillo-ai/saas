#!/usr/bin/env node
/**
 * Ensure Mailgun Routes forward patient replies to CaseLift.
 *
 * Usage:
 *   MAILGUN_API_KEY=key-... node scripts/setup-mailgun-inbound-route.mjs
 *   MAILGUN_API_KEY=key-... node scripts/setup-mailgun-inbound-route.mjs --check-only
 *
 * Creates/updates a high-priority route:
 *   reply+.*@mysmileinbox.com  →  mailgun-webhook-new (or --target mailgun-inbound)
 */
import { parseArgs } from 'node:util'

const PROJECT_URL = 'https://eymgqjeudrmeofytnwgs.supabase.co'
const INBOUND_HOST = process.env.MAILGUN_INBOUND_DOMAIN || 'mysmileinbox.com'
const API_KEY = process.env.MAILGUN_API_KEY
const API_BASE = process.env.MAILGUN_API_BASE || 'https://api.mailgun.net/v3'

const { values } = parseArgs({
  options: {
    'check-only': { type: 'boolean', default: false },
    target: { type: 'string', default: 'mailgun-webhook-new' },
  },
})

const FORWARD_URL = `${PROJECT_URL}/functions/v1/${values.target}`
const EXPRESSION = `match_recipient("reply+.*@${INBOUND_HOST.replace(/\./g, '\\.')}")`
const ROUTE_DESC = `CaseLift patient email replies (${INBOUND_HOST})`

async function mg(path, { method = 'GET', body } = {}) {
  const auth = Buffer.from(`api:${API_KEY}`).toString('base64')
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body,
  })
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`)
  return data
}

function routeMatches(route) {
  const actions = route.actions || []
  const expr = route.expression || ''
  return (
    expr.includes('reply+') &&
    expr.includes(INBOUND_HOST) &&
    actions.some((a) => String(a).includes(FORWARD_URL))
  )
}

async function main() {
  if (!API_KEY) {
    console.error('Set MAILGUN_API_KEY (Mailgun → Settings → API keys)')
    process.exit(1)
  }

  console.log('Inbound host:', INBOUND_HOST)
  console.log('Forward URL:', FORWARD_URL)
  console.log('Expression:', EXPRESSION)

  const { items: routes = [] } = await mg('/routes')
  const existing = routes.find(routeMatches)
  if (existing) {
    console.log('\n✓ Route already configured:', existing.id, existing.description || '')
    return
  }

  const match = await mg(`/routes/match?address=reply+test@example.com@${INBOUND_HOST}`)
  console.log('\nRoute match probe (sample address):', JSON.stringify(match, null, 2))

  if (values['check-only']) {
    console.log('\nNo matching route found. Run without --check-only to create one.')
    process.exit(1)
  }

  const params = new URLSearchParams({
    priority: '0',
    description: ROUTE_DESC,
    expression: EXPRESSION,
    action: `forward("${FORWARD_URL}")`,
  })
  const created = await mg('/routes', { method: 'POST', body: params })
  console.log('\n✓ Created route:', created.route?.id || created)
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
