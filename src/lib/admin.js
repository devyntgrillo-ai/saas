// Admin data layer — loads real agency_accounts / practices; no silent demo blending.
// Use loadAdminDemoData() or VITE_ADMIN_SHOW_DEMO=true for local previews only.
import { isAcceptedConsult } from './attribution'
import { isActiveSubaccount, commissionRate, commissionOwed } from './resellerSaas'
import { supabase } from './supabase'

export const PRICING = {
  directPractice: 997, // $/month a direct (no-agency) practice pays CaseLift
  agencyPerLocation: 500, // default $/location an agency pays CaseLift
  trialDays: 14,
}

// Fixed monthly platform costs (USD). API/messaging costs are estimated from
// volume in estimateCosts().
export const FIXED_COSTS = { supabase: 25, mailgun: 35 }
export const COST_PER_CONSULT = 0.85 // rough Anthropic spend per analyzed consult
export const COST_PER_PRACTICE_MSGS = 4.5 // rough Twilio spend per active practice/mo

const DAY = 86_400_000
const iso = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString()

// ---- Demo dataset ----------------------------------------------------------

const DEMO_AGENCIES = [
  {
    id: 'demo-nw',
    name: 'Northwest Implant Group',
    owner_name: 'Marcus Webb',
    owner_email: 'agency@nwimplant.com',
    status: 'active',
    created_at: iso(45),
    last_activity: iso(0.1),
    commission_rate: 200, // flat $/mo per active referred practice
    notes: 'Founding partner. Expanding into Idaho in Q3 - likely +2 locations.',
    white_label: {
      brand_name: 'NW Recovery Suite',
      primary_color: '#0ea5e9',
      custom_domain: 'app.nwimplant.com',
      support_email: 'support@nwimplant.com',
    },
  },
  {
    id: 'demo-pac',
    name: 'Pacific Dental Partners',
    owner_name: 'Elena Park',
    owner_email: 'admin@pacificdental.com',
    status: 'active',
    created_at: iso(30),
    last_activity: iso(0.4),
    commission_rate: 250,
    notes: 'Onboarding their 3rd location next month.',
    white_label: null,
  },
]

const DEMO_PRACTICES = [
  { id: 'demo-perry', name: 'Perry Family Dentistry', doctor: 'James Perry', location: 'Spokane, WA', agency_id: 'demo-nw', subscription_status: 'active', days_on_platform: 45, consults_month: 19, recovered: 104000, last_recording_days: 1, sms_status: 'active' },
  { id: 'demo-cascade', name: 'Cascade Implant Center', doctor: 'Sarah Lindqvist', location: 'Tacoma, WA', agency_id: 'demo-nw', subscription_status: 'active', days_on_platform: 40, consults_month: 12, recovered: 67000, last_recording_days: 2, sms_status: 'active' },
  { id: 'demo-bluesky', name: 'Blue Sky Dental', doctor: 'Aaron Cole', location: 'Bellevue, WA', agency_id: 'demo-nw', subscription_status: 'active', days_on_platform: 33, consults_month: 8, recovered: 41000, last_recording_days: 3, sms_status: 'pending' },
  { id: 'demo-spokane', name: 'Spokane Implant Specialists', doctor: 'Nadia Brooks', location: 'Spokane, WA', agency_id: 'demo-pac', subscription_status: 'active', days_on_platform: 28, consults_month: 15, recovered: 89000, last_recording_days: 1, sms_status: 'active' },
  { id: 'demo-columbia', name: 'Columbia River Dental', doctor: 'Owen Hayes', location: 'Portland, OR', agency_id: 'demo-pac', subscription_status: 'trialing', days_on_platform: 9, consults_month: 3, recovered: 0, last_recording_days: 9, sms_status: 'none' },
]

// Recovered $ keyed by practice name - used to enrich real rows that lack a
// computed production-recovered figure.
const DEMO_RECOVERED = Object.fromEntries(DEMO_PRACTICES.map((p) => [p.name.toLowerCase(), p.recovered]))

const DEMO_CANCELLATIONS = [
  {
    id: 'demo-cancel-1',
    practice: 'Riverside Dental',
    agency: 'Northwest Implant Group',
    reason: 'too_expensive',
    reason_label: 'Too expensive',
    mrr_lost: 997,
    date: iso(14),
    tenure_days: 96,
  },
]

const DEMO_MRR_HISTORY = [
  { month: 'Dec', agency: 500, direct: 300 },
  { month: 'Jan', agency: 1000, direct: 200 },
  { month: 'Feb', agency: 1000, direct: 500 },
  { month: 'Mar', agency: 1500, direct: 400 },
  { month: 'Apr', agency: 1500, direct: 700 },
  { month: 'May', agency: 2000, direct: 500 },
].map((m) => ({ ...m, total: m.agency + m.direct }))

const DEMO_ACTIVITY = [
  { id: 'a1', type: 'conversion', tone: 'good', ts: iso(0.2), text: 'Linda Foster converted - $34k recovered at Perry Family Dentistry' },
  { id: 'a2', type: 'recording', tone: 'neutral', ts: iso(0.35), text: 'New consult recorded at Blue Sky Dental' },
  { id: 'a3', type: 'recording', tone: 'neutral', ts: iso(0.6), text: 'New consult recorded at Spokane Implant Specialists' },
  { id: 'a4', type: 'payment', tone: 'good', ts: iso(1), text: 'Pacific Dental Partners paid $1,000' },
  { id: 'a5', type: 'conversion', tone: 'good', ts: iso(1.2), text: 'Robert Nguyen converted - $22k recovered at Cascade Implant Center' },
  { id: 'a6', type: 'signup', tone: 'good', ts: iso(1.6), text: 'Columbia River Dental joined · via Pacific Dental Partners' },
  { id: 'a7', type: 'recording', tone: 'neutral', ts: iso(2), text: 'New consult recorded at Perry Family Dentistry' },
  { id: 'a8', type: 'payment', tone: 'good', ts: iso(2.1), text: 'Northwest Implant Group paid $1,500' },
  { id: 'a9', type: 'conversion', tone: 'good', ts: iso(2.5), text: 'Maria Gomez converted - $41k recovered at Spokane Implant Specialists' },
  { id: 'a10', type: 'cancellation', tone: 'bad', ts: iso(14), text: 'Riverside Dental cancelled - reason: too expensive ($997 MRR lost)' },
  { id: 'a11', type: 'recording', tone: 'neutral', ts: iso(3), text: 'New consult recorded at Cascade Implant Center' },
  { id: 'a12', type: 'signup', tone: 'good', ts: iso(28), text: 'Spokane Implant Specialists joined · via Pacific Dental Partners' },
  { id: 'a13', type: 'payment', tone: 'good', ts: iso(4), text: 'Perry Family Dentistry production recovered crossed $100k' },
  { id: 'a14', type: 'recording', tone: 'neutral', ts: iso(4.4), text: 'New consult recorded at Blue Sky Dental' },
  { id: 'a15', type: 'signup', tone: 'good', ts: iso(45), text: 'Perry Family Dentistry joined · via Northwest Implant Group' },
]

// ---- Shape helpers ---------------------------------------------------------

function agencyStatus(row) {
  if (row.status) return row.status
  if (row.active === false) return 'suspended'
  return 'active'
}

function computeAgencyLastActivityMap(rawPractices, consults) {
  const practiceAgency = Object.fromEntries(
    (rawPractices || []).filter((p) => p.agency_id).map((p) => [p.id, p.agency_id]),
  )
  const latest = {}
  const bump = (agencyId, ts) => {
    if (!agencyId || !ts) return
    if (!latest[agencyId] || new Date(ts) > new Date(latest[agencyId])) latest[agencyId] = ts
  }
  for (const p of rawPractices || []) bump(p.agency_id, p.created_at)
  for (const c of consults || []) bump(practiceAgency[c.practice_id], c.created_at)
  return latest
}

function shapeRealAgency(row, practices, { lastActivity, ownerEmails } = {}) {
  const mine = practices.filter((p) => p.agency_id === row.id)
  const active = mine.filter((p) => isActiveSubaccount(p.subscription_status)).length
  const status = agencyStatus(row)
  const rate = commissionRate(row)
  return {
    id: row.id,
    name: row.company_name || row.brand_name || row.name,
    owner_name: row.owner_name || null,
    owner_email: row.owner_email || ownerEmails?.[row.owner_user_id] || row.owner?.email || null,
    status,
    created_at: row.created_at,
    last_activity: lastActivity || row.last_activity || row.created_at,
    practiceCount: mine.length,
    activePracticeCount: active,
    active,
    // Referral-commission model: flat rate per active referred practice. These
    // two fields are the source of truth for the admin payout tally.
    commission_rate: rate,
    commissionOwed: commissionOwed({ rate, activeCount: active }),
    suspended: status === 'suspended' || row.active === false,
    white_label_enabled: Boolean(row.white_label_enabled),
    notes: row.admin_notes || row.notes || '',
    white_label:
      row.white_label_enabled || row.brand_name
        ? {
            brand_name: row.brand_name || row.name,
            primary_color: row.primary_color || '#6C63FF',
            custom_domain: row.custom_domain || null,
            support_email: row.support_email || null,
          }
        : null,
  }
}

function deriveDemoAgencies() {
  return DEMO_AGENCIES.map((a) => {
    const mine = DEMO_PRACTICES.filter((p) => p.agency_id === a.id)
    const active = mine.filter((p) => isActiveSubaccount(p.subscription_status)).length
    const rate = commissionRate(a)
    return {
      ...a,
      practiceCount: mine.length,
      activePracticeCount: active,
      active,
      commission_rate: rate,
      commissionOwed: commissionOwed({ rate, activeCount: active }),
    }
  })
}

function shapeRealPractice(row, consultCount, agencyName) {
  const doctor =
    [row.doctor_first, row.doctor_last].filter(Boolean).join(' ') || null
  const created = row.created_at ? new Date(row.created_at) : null
  const days = created ? Math.max(0, Math.round((Date.now() - created.getTime()) / DAY)) : null
  const sms = row.sms_enabled ? 'active' : row.a2p_status === 'pending' ? 'pending' : 'none'
  return {
    id: row.id,
    name: row.name,
    doctor,
    location: row.location || [row.city, row.state].filter(Boolean).join(', ') || null,
    agency_id: row.agency_id || null,
    agency_name: agencyName || null,
    subscription_status: row.subscription_status || 'active',
    plan_amount: Number(row.plan_amount) || PRICING.directPractice,
    created_at: row.created_at || null,
    days_on_platform: days ?? 0,
    consults_month: consultCount ?? 0,
    recovered: DEMO_RECOVERED[(row.name || '').toLowerCase()] ?? 0,
    last_recording_days: null,
    sms_status: sms,
    archived_at: row.archived_at || null,
  }
}

// ---- Loader ----------------------------------------------------------------

function emptyAdminPayload({ loadErrors = [], isEmpty = false } = {}) {
  return {
    isDemo: false,
    isEmpty,
    loadErrors,
    agencies: [],
    practices: [],
    cancellations: [],
    activity: [],
    mrrHistory: [],
  }
}

export async function loadAdminData() {
  const monthStart = new Date()
  monthStart.setDate(monthStart.getDate() - 30)
  const loadErrors = []

  const [agRes, prRes, coRes, cfRes, leRes, winRes] = await Promise.all([
    supabase.from('agency_accounts').select('*').limit(500),
    supabase.from('practices').select('*, agency:agency_accounts(name)').is('archived_at', null).limit(500),
    supabase
      .from('consults')
      .select('id, practice_id, status, outcome, case_value, patient_name, created_at')
      .gte('created_at', monthStart.toISOString())
      .order('created_at', { ascending: false }),
    supabase.from('cancellation_feedback').select('*').order('created_at', { ascending: false }).limit(500),
    supabase.from('ai_learning_events').select('*').order('created_at', { ascending: false }).limit(15),
    supabase
      .from('assisted_wins')
      .select('id, practice_id, patient_name, case_value, won_at, created_at, practice:practices(name)')
      .order('won_at', { ascending: false })
      .limit(15),
  ])

  if (agRes.error) loadErrors.push({ source: 'agencies', message: agRes.error.message })
  if (prRes.error) loadErrors.push({ source: 'practices', message: prRes.error.message })
  if (coRes.error) loadErrors.push({ source: 'consults', message: coRes.error.message })
  if (cfRes.error) loadErrors.push({ source: 'cancellations', message: cfRes.error.message })

  if (loadErrors.length) {
    return emptyAdminPayload({ loadErrors })
  }

  const realAgencies = agRes.data || []
  const realPractices = prRes.data || []

  if (realAgencies.length === 0 && realPractices.length === 0) {
    return emptyAdminPayload({ isEmpty: true })
  }

  const consultCounts = {}
  ;(coRes.data || []).forEach((c) => {
    consultCounts[c.practice_id] = (consultCounts[c.practice_id] || 0) + 1
  })

  const ownerIds = [...new Set(realAgencies.map((a) => a.owner_user_id).filter(Boolean))]
  let ownerEmails = {}
  if (ownerIds.length) {
    const { data: owners } = await supabase.from('users').select('id, email').in('id', ownerIds)
    ownerEmails = Object.fromEntries((owners || []).map((o) => [o.id, o.email]))
  }

  const lastActivityByAgency = computeAgencyLastActivityMap(realPractices, coRes.data)

  const practices = realPractices.map((p) =>
    shapeRealPractice(p, consultCounts[p.id] || 0, p.agency?.name),
  )
  const agencies = realAgencies.map((a) =>
    shapeRealAgency(a, practices, { lastActivity: lastActivityByAgency[a.id], ownerEmails }),
  )

  const cancellations = (cfRes.data || []).map((c, i) => {
    const practice = practices.find((p) => p.id === c.practice_id)
    return {
      id: c.id || `cancel-${i}`,
      practice_id: c.practice_id || null,
      practice: practice?.name || 'Former practice',
      agency: practice?.agency_name || null,
      reason: c.reason || 'unknown',
      reason_label: reasonLabel(c.reason),
      mrr_lost: Number(c.mrr_at_cancellation) || practice?.plan_amount || PRICING.directPractice,
      date: c.created_at,
      tenure_days: null,
    }
  })

  const activity = buildActivity({
    consults: coRes.data,
    cancellations,
    practices,
    learning: leRes?.error ? [] : leRes?.data,
    wins: winRes?.error ? [] : winRes?.data,
  })

  const mrrHistory = computeMrrHistory(practices, agencies, cancellations)

  return {
    isDemo: false,
    isEmpty: false,
    loadErrors: [],
    agencies,
    practices,
    cancellations,
    activity,
    mrrHistory,
  }
}

// Merge real consults / wins / signups / cancellations into one reverse-chron
// activity feed (max 15). Tones drive the dot color in the Overview feed:
// good = green (consult/conversion), bad = red (cancellation), neutral = blue
// (AI learning). Returns [] when there's nothing real to show.
function buildActivity({ consults, cancellations, practices, learning, wins }) {
  const nameFor = (pid) => practices.find((p) => String(p.id) === String(pid))?.name || 'a practice'
  const events = []

  ;(wins || []).forEach((w, i) => {
    const practiceName = w.practice?.name || nameFor(w.practice_id)
    const patient = w.patient_name || 'Patient'
    const value = Number(w.case_value) || 0
    events.push({
      id: `win-${w.id || i}`,
      type: 'conversion',
      tone: 'good',
      ts: w.won_at || w.created_at,
      text: value
        ? `${patient} converted — $${value.toLocaleString()} at ${practiceName}`
        : `${patient} converted at ${practiceName}`,
    })
  })

  ;(consults || []).forEach((c, i) => {
    if (isAcceptedConsult(c)) return
    events.push({
      id: `co-${c.id || i}`,
      type: 'recording',
      tone: 'neutral',
      ts: c.created_at,
      text: `New consult recorded at ${nameFor(c.practice_id)}`,
    })
  })

  const signupCutoff = Date.now() - 90 * DAY
  ;(practices || []).forEach((p) => {
    const ts = p.created_at
    if (!ts || new Date(ts).getTime() < signupCutoff) return
    events.push({
      id: `signup-${p.id}`,
      type: 'signup',
      tone: 'good',
      ts,
      text: `${p.name} joined${p.agency_name ? ` · via ${p.agency_name}` : ''}`,
    })
  })

  ;(cancellations || []).forEach((c, i) => {
    events.push({
      id: `cf-${c.id || i}`,
      type: 'cancellation',
      tone: 'bad',
      ts: c.date,
      text: `${c.practice} cancelled — ${(c.reason_label || 'unknown').toLowerCase()} ($${Number(c.mrr_lost || 0).toLocaleString()} MRR lost)`,
    })
  })

  ;(learning || []).forEach((e, i) => {
    const text = e.description || e.summary || e.message || e.detail || e.event_type || 'AI learning event'
    events.push({ id: `ai-${e.id || i}`, type: 'signup', tone: 'neutral', ts: e.created_at, text })
  })

  return events
    .filter((e) => e.ts)
    .sort((a, b) => new Date(b.ts) - new Date(a.ts))
    .slice(0, 15)
}

function demoData() {
  return {
    isDemo: true,
    isEmpty: false,
    loadErrors: [],
    agencies: deriveDemoAgencies(),
    practices: DEMO_PRACTICES,
    cancellations: DEMO_CANCELLATIONS,
    activity: DEMO_ACTIVITY,
    mrrHistory: DEMO_MRR_HISTORY,
  }
}

/** Opt-in demo dataset for local previews (set VITE_ADMIN_SHOW_DEMO=true). */
export function loadAdminDemoData() {
  return demoData()
}

// ---- Derived metrics -------------------------------------------------------

export function computeMonthlySignupsChurn(practices, cancellations) {
  const now = new Date()
  const months = []
  for (let i = 5; i >= 0; i -= 1) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1)
    const label = start.toLocaleString('en-US', { month: 'short' })
    const signups = (practices || []).filter((p) => {
      const created = p.created_at ? new Date(p.created_at) : null
      return created && created >= start && created < end
    }).length
    const churn = (cancellations || []).filter((c) => {
      const dt = c.date ? new Date(c.date) : null
      return dt && dt >= start && dt < end
    }).length
    months.push({ month: label, signups, churn })
  }
  return months
}

export function computeOverview(data) {
  const { agencies, practices, cancellations } = data
  const activePractices = practices.filter((p) => p.subscription_status === 'active')
  const directActive = activePractices.filter((p) => !p.agency_id)
  const agencyActivePractices = activePractices.filter((p) => p.agency_id)
  // Every practice — agency-referred or direct — bills CaseLift $997 directly.
  const planMrr = (p) => Number(p.plan_amount) || PRICING.directPractice
  const directRevenue = directActive.reduce((s, p) => s + planMrr(p), 0)
  const agencyFees = agencyActivePractices.reduce((s, p) => s + planMrr(p), 0)
  const totalMrr = agencyFees + directRevenue
  // Flat referral commission CaseLift pays out (a cost, not part of MRR).
  const commissionOwedTotal = agencies.reduce((s, a) => s + (a.commissionOwed || 0), 0)

  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const churnThisMonth = cancellations.filter((c) => c.date && new Date(c.date) >= monthStart).length
  const activeAgencies = agencies.filter(
    (a) => a.status !== 'suspended' && practices.some((p) => p.agency_id === a.id && p.subscription_status === 'active'),
  ).length

  return {
    totalMrr,
    agencyFees,
    directRevenue,
    commissionOwedTotal,
    activePractices: activePractices.length,
    activeAgencies,
    churnThisMonth,
    annualRunRate: totalMrr * 12,
  }
}

// Reconstruct stacked MRR (reseller vs direct) for the last 12 months from
// practice created_at + cancellation_feedback dates.
export function computeMrrHistory(practices, agencies, cancellations = []) {
  const cancelByPractice = {}
  for (const c of cancellations) {
    if (c.practice_id && c.date) cancelByPractice[c.practice_id] = c.date
  }

  const now = new Date()
  const months = []
  for (let i = 11; i >= 0; i -= 1) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999)
    const label = start.toLocaleString('en-US', { month: 'short' })

    let direct = 0
    let agency = 0
    for (const p of practices || []) {
      const created = p.created_at ? new Date(p.created_at) : null
      if (!created || created > end) continue
      const cancelled = cancelByPractice[p.id]
      if (cancelled && new Date(cancelled) < start) continue

      // Every active practice bills CaseLift $997 directly; split the stack by
      // whether it came via a referring agency or signed up direct.
      const mrr = Number(p.plan_amount) || PRICING.directPractice
      if (p.agency_id) agency += mrr
      else direct += mrr
    }
    months.push({ month: label, agency, direct, total: agency + direct })
  }
  return months
}

export function estimateCosts(data) {
  const consults = data.practices.reduce((s, p) => s + (p.consults_month || 0), 0)
  const activePractices = data.practices.filter((p) => p.subscription_status === 'active').length
  const anthropic = Math.round(consults * COST_PER_CONSULT)
  const twilio = Math.round(activePractices * COST_PER_PRACTICE_MSGS)
  const total = FIXED_COSTS.supabase + FIXED_COSTS.mailgun + anthropic + twilio
  return { supabase: FIXED_COSTS.supabase, mailgun: FIXED_COSTS.mailgun, anthropic, twilio, total }
}

// ---- Misc helpers ----------------------------------------------------------

export const REASON_LABELS = {
  too_expensive: 'Too expensive',
  not_using: 'Not using it enough',
  missing_features: 'Missing features',
  switching: 'Switching tools',
  closing: 'Practice closing',
  other: 'Other',
}
export function reasonLabel(r) {
  return REASON_LABELS[r] || (r ? r.replace(/_/g, ' ') : 'Unknown')
}

export const AGENCY_STATUS = {
  active: { label: 'Active', classes: 'bg-emerald-500/15 text-emerald-300' },
  trialing: { label: 'Trial', classes: 'bg-amber-500/15 text-amber-300' },
  trial: { label: 'Trial', classes: 'bg-amber-500/15 text-amber-300' },
  suspended: { label: 'Suspended', classes: 'bg-rose-500/15 text-rose-300' },
}
export function agencyStatusMeta(s) {
  return AGENCY_STATUS[s] || { label: s || '-', classes: 'bg-surface-700 text-slate-300' }
}

export const SMS_STATUS = {
  active: { label: 'Active', classes: 'text-emerald-300' },
  pending: { label: 'Pending', classes: 'text-amber-300' },
  none: { label: 'Not set up', classes: 'text-slate-500' },
}
export function smsStatusMeta(s) {
  return SMS_STATUS[s] || SMS_STATUS.none
}

/** PostgREST column name from "Could not find the 'foo' column …" errors. */
function missingColumnFromError(message) {
  if (!message) return null
  const m = message.match(/'([^']+)'\s+column/i) || message.match(/find the '([^']+)' column/i)
  return m?.[1] || null
}

// Insert agency_accounts, dropping optional columns the connected DB may lack.
export async function insertAgencyAccount(payload) {
  let body = { ...payload }
  for (let attempt = 0; attempt < 8; attempt++) {
    const { data, error } = await supabase.from('agency_accounts').insert(body).select('id').single()
    if (!error) return data
    const col = missingColumnFromError(error.message)
    if (col && Object.prototype.hasOwnProperty.call(body, col)) {
      const { [col]: _drop, ...next } = body
      body = next
      continue
    }
    throw error
  }
  throw new Error('Could not create reseller.')
}

// Best-effort audit log of an impersonation event. Never throws.
export async function logImpersonation({ actorId, targetType, targetId, targetName }) {
  try {
    const { error } = await supabase.from('audit_logs').insert({
      actor_id: actorId || null,
      action: 'impersonate',
      target_type: targetType,
      target_id: targetId,
      detail: targetName,
    })
    if (error) console.warn('[audit] logImpersonation failed:', error.message)
  } catch (e) {
    console.error('[audit] logImpersonation threw:', e)
  }
}

// Last 12 months of stacked MRR for the dashboard chart.
export function mrrSeries12(history) {
  return (history || []).filter(Boolean).slice(-12)
}

export const MRR_MILESTONES = [
  { value: 1000, label: '$1k' },
  { value: 5000, label: '$5k' },
  { value: 10000, label: '$10k' },
]
