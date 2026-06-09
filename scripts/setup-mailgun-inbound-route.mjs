#!/usr/bin/env node
/**
 * Ensure Mailgun Routes forward patient replies to CaseLift.
 *
 * Preferred (uses MAILGUN_API_KEY from Supabase Edge Function secrets):
 *   node scripts/setup-mailgun-inbound-route.mjs --via-supabase
 *   node scripts/setup-mailgun-inbound-route.mjs --via-supabase --check-only
 *
 * Direct Mailgun API (requires local MAILGUN_API_KEY):
 *   MAILGUN_API_KEY=key-... node scripts/setup-mailgun-inbound-route.mjs
 *
 * Creates high-priority routes (if missing):
 *   reply+.*@*.{root}  →  mailgun-webhook (subdomain Reply-To)
 *   reply+.*@{root}     →  mailgun-webhook (legacy root Reply-To)
 */
import { execFileSync } from 'node:child_process'
import { parseArgs } from 'node:util'

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'eymgqjeudrmeofytnwgs'
const PROJECT_URL = process.env.SUPABASE_URL || `https://${PROJECT_REF}.supabase.co`
const INBOUND_HOST = process.env.MAILGUN_INBOUND_DOMAIN || 'mysmileinbox.com'
const API_KEY = process.env.MAILGUN_API_KEY
const API_BASE = process.env.MAILGUN_API_BASE || 'https://api.mailgun.net/v3'

const { values } = parseArgs({
  options: {
    'check-only': { type: 'boolean', default: false },
    'via-supabase': { type: 'boolean', default: false },
    target: { type: 'string', default: 'mailgun-webhook' },
  },
})

const FORWARD_URL = `${PROJECT_URL}/functions/v1/${values.target}`
const ESCAPED_HOST = INBOUND_HOST.replace(/\./g, '\\.')

const ROUTES = [
  {
    description: `CaseLift patient replies on subdomains (*.${INBOUND_HOST})`,
    expression: `match_recipient("reply+.*@.*\\.${ESCAPED_HOST}")`,
  },
  {
    description: `CaseLift patient replies on root (${INBOUND_HOST}, legacy)`,
    expression: `match_recipient("reply+.*@${ESCAPED_HOST}")`,
  },
]

function serviceRoleFromSupabaseCli() {
  const raw = execFileSync(
    'npx',
    ['supabase', 'projects', 'api-keys', '--project-ref', PROJECT_REF, '-o', 'json'],
    { encoding: 'utf8' },
  )
  const keys = JSON.parse(raw)
  const row = keys.find((k) => k.id === 'service_role')
  if (!row?.api_key) throw new Error('Could not read service_role from supabase projects api-keys')
  return row.api_key
}

async function viaSupabaseEdgeFunction() {
  const serviceKey = serviceRoleFromSupabaseCli()
  const res = await fetch(`${PROJECT_URL}/functions/v1/setup-mailgun-inbound-route`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      check_only: values['check-only'],
      target: values.target,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || `Edge function failed (${res.status})`)
  }
  console.log(JSON.stringify(data, null, 2))
  if (values['check-only'] && !data.ok) process.exit(1)
}

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

function routeMatches(route, spec) {
  const actions = route.actions || []
  const expr = route.expression || ''
  return expr === spec.expression && actions.some((a) => String(a).includes(FORWARD_URL))
}

async function ensureRoute(spec, existingRoutes) {
  const existing = existingRoutes.find((r) => routeMatches(r, spec))
  if (existing) {
    console.log(`✓ Route already configured: ${existing.id} — ${spec.description}`)
    return true
  }

  if (values['check-only']) {
    console.log(`✗ Missing route: ${spec.description}`)
    console.log(`  Expression: ${spec.expression}`)
    return false
  }

  const params = new URLSearchParams({
    priority: '0',
    description: spec.description,
    expression: spec.expression,
    action: `forward("${FORWARD_URL}")`,
  })
  const created = await mg('/routes', { method: 'POST', body: params })
  console.log(`✓ Created route: ${created.route?.id || created} — ${spec.description}`)
  return true
}

async function viaMailgunApi() {
  if (!API_KEY) {
    console.error('Set MAILGUN_API_KEY or use --via-supabase (reads key from Supabase secrets)')
    process.exit(1)
  }

  console.log('Inbound host:', INBOUND_HOST)
  console.log('Forward URL:', FORWARD_URL)

  const { items: routes = [] } = await mg('/routes')
  let allOk = true
  for (const spec of ROUTES) {
    const ok = await ensureRoute(spec, routes)
    allOk = allOk && ok
  }

  if (values['check-only'] && !allOk) {
    process.exit(1)
  }
}

async function main() {
  if (values['via-supabase']) {
    await viaSupabaseEdgeFunction()
    return
  }
  await viaMailgunApi()
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
