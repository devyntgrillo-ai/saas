// ============================================================================
// Attribution model v2 - defensible "how did CaseLift help close this case?"
//
// Status (priority order):
//   caselift_recovered - patient replied to a sequence, then accepted treatment
//   caselift_assisted  - at least one follow-up was sent before acceptance
//   practice_direct     - accepted with no CaseLift sequence activity
//   unknown             - not yet determined
//
// The DB (attribution_events + triggers in migration 20260530010000) is the
// source of truth and keeps an auditable trail. These client helpers compute the
// same answer directly from messages / conversation_messages so reporting works
// regardless of whether the migration has been applied to the connected DB.
// ============================================================================
import { supabase } from './supabase'

export const ATTRIBUTION_STATUS = {
  caselift_recovered: {
    label: 'CaseLift Recovered',
    short: 'Patient replied to a sequence, then accepted treatment',
    badge: 'bg-emerald-100 text-emerald-700',
    check: true,
  },
  caselift_assisted: {
    label: 'CaseLift Assisted',
    short: 'A follow-up message was sent before treatment was accepted',
    badge: 'bg-blue-100 text-blue-700',
    check: true,
  },
  practice_direct: {
    label: 'Practice Direct',
    short: 'Accepted without any CaseLift sequence activity',
    badge: 'bg-gray-100 text-gray-600',
    check: false,
  },
  unknown: {
    label: 'Attribution pending',
    short: 'Attribution not yet determined',
    badge: 'bg-gray-100 text-gray-500',
    check: false,
  },
}

export function attributionStatusBadge(status) {
  return ATTRIBUTION_STATUS[status] || null
}

// A consult counts as a treatment acceptance via either the workflow `status`
// or the TC `outcome` column (manual close or PMS sync both land here).
export function isAcceptedConsult(c) {
  return (
    ['closed_won', 'recovered'].includes(c?.status) ||
    ['accepted', 'closed_won'].includes(c?.outcome)
  )
}

// Pure: derive the status from "did we send" / "did they reply".
export function computeAttributionStatus({ sent, replied }) {
  if (replied) return 'caselift_recovered'
  if (sent) return 'caselift_assisted'
  return 'practice_direct'
}

const EMPTY_PRODUCTION = {
  total: 0,
  assisted: 0,
  recovered: 0,
  direct: 0,
  closedCount: 0,
  touchedCount: 0,
  attributionRate: 0,
}

// Build the consult→{sent, replied} maps for a set of conversations + messages.
function buildTouchpoints(sentMsgs, convs, inbound) {
  const sentSet = new Set((sentMsgs || []).map((m) => m.consult_id).filter(Boolean))
  const convToConsult = new Map((convs || []).filter((c) => c.consult_id).map((c) => [c.id, c.consult_id]))
  const repliedSet = new Set()
  for (const r of inbound || []) {
    const cid = convToConsult.get(r.conversation_id)
    if (cid) repliedSet.add(cid)
  }
  return { sentSet, repliedSet }
}

// Production attribution for one practice (used on the Dashboard).
export async function fetchProductionAttribution(practiceId) {
  if (!practiceId) return { ...EMPTY_PRODUCTION }
  try {
    const [{ data: consults }, { data: sentMsgs }, { data: convs }] = await Promise.all([
      supabase.from('consults').select('id, status, outcome, case_value').eq('practice_id', practiceId),
      supabase.from('messages').select('consult_id').eq('practice_id', practiceId).eq('status', 'sent'),
      supabase.from('conversations').select('id, consult_id').eq('practice_id', practiceId).not('consult_id', 'is', null),
    ])
    const convIds = (convs || []).map((c) => c.id)
    let inbound = []
    if (convIds.length) {
      const { data } = await supabase
        .from('conversation_messages')
        .select('conversation_id')
        .eq('direction', 'inbound')
        .in('conversation_id', convIds)
      inbound = data || []
    }
    const { sentSet, repliedSet } = buildTouchpoints(sentMsgs, convs, inbound)

    let assisted = 0, recovered = 0, direct = 0, closedCount = 0, touchedCount = 0
    for (const c of consults || []) {
      if (!isAcceptedConsult(c)) continue
      closedCount += 1
      const v = Number(c.case_value) || 0
      if (repliedSet.has(c.id)) { recovered += v; touchedCount += 1 }
      else if (sentSet.has(c.id)) { assisted += v; touchedCount += 1 }
      else { direct += v }
    }
    return {
      total: assisted + recovered,
      assisted,
      recovered,
      direct,
      closedCount,
      touchedCount,
      attributionRate: closedCount ? Math.round((touchedCount / closedCount) * 100) : 0,
    }
  } catch {
    return { ...EMPTY_PRODUCTION }
  }
}

// Production attribution grouped by practice (used in the admin revenue view).
// Returns a map keyed by practice_id. Never throws.
export async function fetchAttributionByPractice() {
  try {
    const [{ data: consults }, { data: sentMsgs }, { data: convs }, { data: inbound }] = await Promise.all([
      supabase.from('consults').select('id, practice_id, status, outcome, case_value'),
      supabase.from('messages').select('consult_id').eq('status', 'sent'),
      supabase.from('conversations').select('id, consult_id').not('consult_id', 'is', null),
      supabase.from('conversation_messages').select('conversation_id').eq('direction', 'inbound'),
    ])
    const { sentSet, repliedSet } = buildTouchpoints(sentMsgs, convs, inbound)
    const byPractice = {}
    for (const c of consults || []) {
      if (!isAcceptedConsult(c)) continue
      const pid = c.practice_id
      if (!pid) continue
      const agg = (byPractice[pid] = byPractice[pid] || { ...EMPTY_PRODUCTION })
      agg.closedCount += 1
      const v = Number(c.case_value) || 0
      if (repliedSet.has(c.id)) { agg.recovered += v; agg.touchedCount += 1 }
      else if (sentSet.has(c.id)) { agg.assisted += v; agg.touchedCount += 1 }
      else { agg.direct += v }
    }
    for (const pid of Object.keys(byPractice)) {
      const a = byPractice[pid]
      a.total = a.assisted + a.recovered
      a.attributionRate = a.closedCount ? Math.round((a.touchedCount / a.closedCount) * 100) : 0
    }
    return byPractice
  } catch {
    return {}
  }
}

function daysBetween(a, b) {
  if (!a || !b) return null
  const d = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000)
  return Number.isNaN(d) || d < 0 ? null : d
}

function buildExplanation({ status, events, consult, messages }) {
  const eventDate = (type) => (events || []).find((e) => e.event_type === type)?.event_date || null
  const acceptDate = consult?.attribution_confirmed_at || consult?.outcome_set_at || eventDate('treatment_accepted')
  const sentMsgs = (messages || [])
    .filter((m) => m.status === 'sent')
    .sort((a, b) => new Date(a.sent_at || a.scheduled_for || a.created_at) - new Date(b.sent_at || b.scheduled_for || b.created_at))

  if (status === 'caselift_recovered') {
    const replyDate = eventDate('patient_replied')
    const trigger =
      (replyDate && [...sentMsgs].reverse().find((m) => new Date(m.sent_at || m.created_at) <= new Date(replyDate))) ||
      sentMsgs[sentMsgs.length - 1] ||
      null
    const dayLabel = trigger?.send_day
      ? `Day ${trigger.send_day} ${(trigger.channel || 'SMS').toUpperCase()}`
      : 'a follow-up message'
    const lag = daysBetween(replyDate, acceptDate)
    return `Patient replied to ${dayLabel} → accepted treatment${lag != null ? ` ${lag} day${lag === 1 ? '' : 's'} later` : ''}.`
  }
  if (status === 'caselift_assisted') {
    const n = sentMsgs.length
    if (!n) return 'A CaseLift follow-up sequence was active before the patient accepted treatment.'
    return `${n} follow-up ${n === 1 ? 'message' : 'messages'} sent before the patient accepted treatment.`
  }
  if (status === 'practice_direct') return 'Accepted without any CaseLift sequence activity.'
  return 'Attribution will be determined once this case is closed.'
}

// Full attribution context for a single consult (badge + human explanation).
// Resilient: prefers the stored status/events, falls back to live computation.
export async function fetchConsultAttribution(consult, messages = []) {
  if (!consult) return { status: 'unknown', explanation: '', events: [] }

  let events = []
  try {
    const { data, error } = await supabase
      .from('attribution_events')
      .select('event_type, event_date, source')
      .eq('consult_id', consult.id)
      .order('event_date', { ascending: true })
    if (!error && data) events = data
  } catch { /* table may not exist yet */ }

  const sent = (messages || []).some((m) => m.status === 'sent') || events.some((e) => e.event_type === 'message_sent')
  let replied = events.some((e) => e.event_type === 'patient_replied')
  if (!replied) {
    try {
      const { data: convs } = await supabase.from('conversations').select('id').eq('consult_id', consult.id)
      const ids = (convs || []).map((c) => c.id)
      if (ids.length) {
        const { count } = await supabase
          .from('conversation_messages')
          .select('id', { count: 'exact', head: true })
          .eq('direction', 'inbound')
          .in('conversation_id', ids)
        replied = (count || 0) > 0
      }
    } catch { /* ignore */ }
  }

  const accepted = isAcceptedConsult(consult)
  let status = consult.attribution_status || null
  if (!status) status = accepted ? computeAttributionStatus({ sent, replied }) : 'unknown'

  const explanation = buildExplanation({ status, events, consult, messages })
  return { status, explanation, events }
}

// Client-side close path: compute + persist attribution, log the event.
// Returns a patch to merge into the in-memory consult so the UI updates at once.
// Resilient to the v2 columns / table not yet existing in the connected DB.
export async function recordCloseAttribution(consult, { source = 'manual' } = {}) {
  if (!consult?.id || !consult?.practice_id) return {}
  let sent = false
  let replied = false
  try {
    const { data: sentMsgs } = await supabase.from('messages').select('id').eq('consult_id', consult.id).eq('status', 'sent')
    sent = (sentMsgs || []).length > 0
    const { data: convs } = await supabase.from('conversations').select('id').eq('consult_id', consult.id)
    const ids = (convs || []).map((c) => c.id)
    if (ids.length) {
      const { count } = await supabase
        .from('conversation_messages')
        .select('id', { count: 'exact', head: true })
        .eq('direction', 'inbound')
        .in('conversation_id', ids)
      replied = (count || 0) > 0
    }
  } catch { /* ignore */ }

  const status = computeAttributionStatus({ sent, replied })
  const patch = {
    attribution_status: status,
    attribution_confirmed_at: new Date().toISOString(),
    attribution_source: source,
    attribution_model: ['caselift_recovered', 'caselift_assisted'].includes(status)
      ? 'caselift_recovered'
      : 'practice_recovered',
  }

  // Persist. If the v2 columns are missing, fall back to the legacy column only.
  const { error } = await supabase.from('consults').update(patch).eq('id', consult.id)
  if (error) {
    await supabase
      .from('consults')
      .update({ attribution_model: patch.attribution_model })
      .eq('id', consult.id)
      .then(() => {}, () => {})
  }

  // Append the auditable treatment_accepted event (no-op if table absent).
  try {
    await supabase.from('attribution_events').insert({
      consult_id: consult.id,
      practice_id: consult.practice_id,
      event_type: 'treatment_accepted',
      source,
    })
  } catch { /* table may not exist yet */ }

  return patch
}
