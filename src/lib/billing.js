// Shared billing / subscription helpers for Hope AI (Lemon Squeezy).
//
// Subscription lifecycle (practices.subscription_status):
//   trial     - new signups; full access until trial_ends_at (14 days)
//   active    - paid Lemon Squeezy subscription
//   past_due  - a renewal payment failed
//   cancelled - subscription cancelled (access until end of paid period)
import { supabase } from './supabase'

export const PLAN_NAME = 'Hope AI'
export const PLAN_PRICE = '$997/month'

// Visual treatment for each subscription status badge.
export const SUBSCRIPTION_STATUS = {
  trial: { label: 'Trial', classes: 'bg-sky-500/15 text-sky-300 ring-sky-400/20' },
  active: { label: 'Active', classes: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/20' },
  paused: { label: 'Paused', classes: 'bg-indigo-500/15 text-indigo-300 ring-indigo-400/20' },
  past_due: { label: 'Past Due', classes: 'bg-amber-500/15 text-amber-300 ring-amber-400/20' },
  unpaid: { label: 'Unpaid', classes: 'bg-rose-500/15 text-rose-300 ring-rose-400/20' },
  cancelled: { label: 'Cancelled', classes: 'bg-rose-500/15 text-rose-300 ring-rose-400/20' },
  // legacy value still present on older rows
  canceled: { label: 'Cancelled', classes: 'bg-rose-500/15 text-rose-300 ring-rose-400/20' },
  expired: { label: 'Expired', classes: 'bg-slate-500/15 text-slate-300 ring-slate-400/20' },
}

export function statusMeta(status) {
  return SUBSCRIPTION_STATUS[status] || SUBSCRIPTION_STATUS.trial
}

// Whole days left in the trial (0 once it has ended). Returns null if there's
// no trial window on the record.
export function trialDaysRemaining(practice) {
  if (!practice?.trial_ends_at) return null
  const ends = new Date(practice.trial_ends_at).getTime()
  if (Number.isNaN(ends)) return null
  const ms = ends - Date.now()
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)))
}

export function isTrialExpired(practice) {
  if (!practice?.trial_ends_at) return false
  return new Date(practice.trial_ends_at).getTime() <= Date.now()
}

// True when the soft paywall should show: the practice is not on an active paid
// subscription and its trial has run out (or it's past_due / cancelled).
export function needsPaywall(practice) {
  if (!practice) return false
  const status = practice.subscription_status
  if (status === 'active') return false
  if (status === 'paused') return false // intentional hold; no upgrade nag
  if (status === 'trial') return isTrialExpired(practice)
  // past_due / cancelled (and any legacy non-active state)
  return status === 'past_due' || status === 'cancelled' || status === 'canceled'
}

// Whether Lemon Squeezy is running in test mode is determined by the API key,
// and surfaced by create-checkout as `test_mode`. We cache the last-known value
// so the billing UI can decide whether to show the test-mode banner without
// blocking on a probe, and so it self-heals (flips to false) once live keys go in.
const LS_TEST_MODE_KEY = 'ciq_ls_test_mode'
const LS_TEST_MODE_TTL = 6 * 60 * 60 * 1000 // re-probe the mode at most every 6h

function readTestModeEntry() {
  try {
    const raw = localStorage.getItem(LS_TEST_MODE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return typeof parsed?.val === 'boolean' ? parsed : null
  } catch {
    return null
  }
}

export function getCachedBillingTestMode() {
  return readTestModeEntry()?.val ?? null
}

function setCachedBillingTestMode(val) {
  try {
    localStorage.setItem(LS_TEST_MODE_KEY, JSON.stringify({ val: val === true, ts: Date.now() }))
  } catch {
    /* ignore storage errors */
  }
}

// Create a Lemon Squeezy checkout for this practice and return the hosted URL
// plus whether it's a test-mode checkout (also cached for the banner).
export async function createCheckout({ practiceId, email }) {
  const { data, error } = await supabase.functions.invoke('create-checkout', {
    body: {
      practice_id: practiceId,
      email,
      redirect_url: `${window.location.origin}/settings/billing?success=true`,
    },
  })
  if (error) throw new Error(await edgeErrorMessage(error))
  if (!data?.url) throw new Error('No checkout URL returned')
  if (typeof data.test_mode === 'boolean') setCachedBillingTestMode(data.test_mode)
  return { url: data.url, testMode: data.test_mode === true }
}

// Probe Lemon Squeezy for the current key's mode without starting a real
// checkout flow. Returns true/false (and refreshes the cache), or the cached
// value if the probe can't be reached (function not deployed, no key, offline).
export async function detectBillingTestMode({ practiceId, email }) {
  // Fresh cache → skip the probe entirely (no throwaway checkout created).
  const entry = readTestModeEntry()
  if (entry && Date.now() - entry.ts < LS_TEST_MODE_TTL) return entry.val
  try {
    const { data, error } = await supabase.functions.invoke('create-checkout', {
      body: { mode_check: true, practice_id: practiceId, email },
    })
    if (error || typeof data?.test_mode !== 'boolean') return getCachedBillingTestMode()
    setCachedBillingTestMode(data.test_mode)
    return data.test_mode
  } catch {
    return getCachedBillingTestMode()
  }
}

// supabase-js surfaces non-2xx edge responses as a generic
// "Edge Function returned a non-2xx status code". Pull the real `error` field
// out of the response body so callers can show something actionable.
async function edgeErrorMessage(error) {
  try {
    const body = await error?.context?.json?.()
    if (body?.error) return body.error
  } catch {
    /* body wasn't JSON or already consumed */
  }
  return error?.message || 'Request failed'
}

// Authoritative subscription status for a practice (via the get-billing-status
// edge function). Returns { plan, status, trial_ends_at, subscription_id }.
export async function getBillingStatus(practiceId) {
  const { data, error } = await supabase.functions.invoke('get-billing-status', {
    body: { practice_id: practiceId },
  })
  if (error) throw new Error(await edgeErrorMessage(error))
  return data
}

// Create a Lemon Squeezy customer-portal URL (update payment method / manage sub).
export async function createPortalSession(practiceId) {
  const { data, error } = await supabase.functions.invoke('create-portal-session', {
    body: { practice_id: practiceId },
  })
  if (error) throw new Error(await edgeErrorMessage(error))
  if (!data?.url) throw new Error('No portal URL returned')
  return data.url
}

// Statuses that should hard-block access to the core app (paywall overlay).
const BLOCKING_STATUSES = new Set(['past_due', 'unpaid', 'cancelled', 'canceled', 'expired'])
export function isBillingBlocked(practice) {
  return Boolean(practice) && BLOCKING_STATUSES.has(practice.subscription_status)
}

// ============================================================================
// Cancellation / retention flow
// ============================================================================
export const PLAN_PRICE_NUMERIC = 997
export const DOWNSELL = { price: 499, months: 3, percentOff: 50 }
export const MINUTES_PER_MESSAGE = 8

export const CANCELLATION_REASONS = [
  { value: 'too_expensive', label: 'Too expensive' },
  { value: 'not_enough_consults', label: 'Not enough consults to justify it' },
  { value: 'missing_feature', label: 'Missing a feature I need' },
  { value: 'switching', label: 'Switching to a different solution' },
  { value: 'circumstances', label: 'Practice circumstances changed' },
]

// Pull real account data for the personalized impact screen.
export async function fetchCancellationImpact(practiceId) {
  if (!practiceId) return null
  const [consultsRes, msgWrittenRes, msgSentRes, activeRes] = await Promise.all([
    supabase.from('consults').select('status, case_value, attribution_model').eq('practice_id', practiceId),
    supabase.from('messages').select('id', { count: 'exact', head: true }).eq('practice_id', practiceId),
    supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('practice_id', practiceId)
      .in('status', ['sent', 'opened', 'replied']),
    supabase
      .from('consults')
      .select('id', { count: 'exact', head: true })
      .eq('practice_id', practiceId)
      .in('status', ['active', 'approved']),
  ])
  const consults = consultsRes.data || []
  // Production attributed to Hope AI (conservative attribution model); fall
  // back to all closed-won if attribution hasn't been computed yet.
  const attributed = consults
    .filter((c) => c.attribution_model === 'consultiq_recovered')
    .reduce((s, c) => s + (Number(c.case_value) || 0), 0)
  const production = attributed || consults
    .filter((c) => c.status === 'closed_won' || c.status === 'recovered')
    .reduce((s, c) => s + (Number(c.case_value) || 0), 0)
  const messagesWritten = msgWrittenRes.count || 0
  const messagesSent = msgSentRes.count || messagesWritten
  return {
    production,
    consultsAnalyzed: consults.length,
    messagesWritten,
    messagesSent,
    hoursSaved: Math.round((messagesSent * MINUTES_PER_MESSAGE) / 60),
    activePatients: activeRes.count || 0,
  }
}

// Pause: no charge, sequences paused, data preserved.
export async function pauseSubscription(practiceId, months) {
  const ends = new Date()
  ends.setMonth(ends.getMonth() + months)
  const iso = ends.toISOString()
  const { error } = await supabase
    .from('practices')
    .update({ subscription_status: 'paused', pause_ends_at: iso })
    .eq('id', practiceId)
  if (error) throw error
  return iso
}

// Downsell: keep them active and record the accepted retention offer. A real LS
// discount is applied server-side via the billing portal; we lock in the intent
// here so the account stays active and the offer is auditable.
export async function acceptDownsell(practiceId) {
  const { error } = await supabase
    .from('practices')
    .update({ subscription_status: 'active', downsell_accepted_at: new Date().toISOString() })
    .eq('id', practiceId)
  if (error) throw error
}

export async function submitCancellationFeedback({ practiceId, reason, elaboration, impact }) {
  const { error } = await supabase.from('cancellation_feedback').insert({
    practice_id: practiceId,
    reason,
    elaboration: elaboration || null,
    mrr_at_cancellation: PLAN_PRICE_NUMERIC,
    production_recovered: impact?.production ?? null,
    consults_analyzed: impact?.consultsAnalyzed ?? null,
    messages_sent: impact?.messagesSent ?? null,
  })
  if (error) throw error
}

// Final cancel - calls the edge function (Lemon Squeezy) and falls back to a
// direct status flip so the flow always completes.
export async function cancelSubscription(practiceId) {
  try {
    const { data, error } = await supabase.functions.invoke('cancel-subscription', {
      body: { practice_id: practiceId },
    })
    if (error) throw error
    return data
  } catch {
    await supabase.from('practices').update({ subscription_status: 'cancelled' }).eq('id', practiceId)
    return { ok: true, fallback: true }
  }
}

// Client-side export of the practice's data (preserved for 90 days regardless).
export async function exportPracticeData(practiceId, practiceName = 'hopeai') {
  const [c, m, conv] = await Promise.all([
    supabase.from('consults').select('*').eq('practice_id', practiceId),
    supabase.from('messages').select('*').eq('practice_id', practiceId),
    supabase.from('conversations').select('*').eq('practice_id', practiceId),
  ])
  const payload = {
    exported_at: new Date().toISOString(),
    practice: practiceName,
    consults: c.data || [],
    messages: m.data || [],
    conversations: conv.data || [],
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${String(practiceName).replace(/\s+/g, '-').toLowerCase()}-hopeai-export.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
