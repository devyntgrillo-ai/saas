// Shared billing / subscription helpers for CaseLift (Chargebee).
//
// Subscription lifecycle (practices.subscription_status):
//   trial     - new signups; full access until trial_ends_at (14 days)
//   active    - paid Chargebee subscription
//   past_due  - a renewal payment failed
//   cancelled - subscription cancelled (access until end of paid period)
import { supabase } from './supabase'

export const PLAN_NAME = 'CaseLift'
export const PLAN_PRICE = '$997/month'

// Visual treatment for each subscription status badge.
export const SUBSCRIPTION_STATUS = {
  trial: { label: 'Trial', classes: 'bg-sky-500/15 text-sky-300 ring-sky-400/20' },
  active: { label: 'Active', classes: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/20' },
  paused: { label: 'Paused', classes: 'bg-[var(--bg-subtle)] text-[var(--text-muted)]' },
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

// Create a Chargebee hosted-page checkout for this practice and return the
// hosted-page URL for redirect.
// redirectPath lets a caller (e.g. the signup funnel) send the user somewhere
// other than the default billing settings page after a successful checkout.
export async function createCheckout({ practiceId, email, planAmount, redirectPath } = {}) {
  const redirect = `${window.location.origin}${redirectPath || '/settings/billing?success=true'}`
  const { data, error } = await supabase.functions.invoke('create-checkout', {
    body: {
      practice_id: practiceId,
      email,
      ...(planAmount != null ? { plan_amount: planAmount } : {}),
      redirect_url: redirect,
    },
  })
  if (error) throw new Error(await edgeErrorMessage(error))
  if (!data?.url) throw new Error('No checkout URL returned')
  return { url: data.url, planAmount: data.plan_amount ?? planAmount }
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

// Create a Chargebee customer-portal URL (update payment method / manage sub).
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
  // Production attributed to CaseLift (conservative attribution model); fall
  // back to all closed-won if attribution hasn't been computed yet.
  const attributed = consults
    .filter((c) => c.attribution_model === 'caselift_recovered')
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

// Downsell: keep them active and record the accepted retention offer. A real
// Chargebee discount is applied server-side via the billing portal; we lock in
// the intent here so the account stays active and the offer is auditable.
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

// Final cancel - calls the edge function (Chargebee) and falls back to a
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
export async function exportPracticeData(practiceId, practiceName = 'caselift') {
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
  a.download = `${String(practiceName).replace(/\s+/g, '-').toLowerCase()}-caselift-export.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
