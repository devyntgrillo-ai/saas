// Dashboard KPI helpers, single source of truth for practice-home metrics.
import { supabase } from './supabase'
import { isAcceptedConsult } from './attribution'
import { consultTxValue, isConfirmedSource } from './treatments'

export const SENT_MESSAGE_STATUSES = ['sent', 'delivered', 'opened', 'replied']

/** Consult actually converted (not merely "active" in a sequence). */
export function isClosedConsult(c) {
  return (
    ['closed_won', 'recovered'].includes(c?.status) ||
    ['accepted', 'closed_won'].includes(c?.outcome)
  )
}

function attributedToCaseLift(c, sentSet, repliedSet) {
  if (c.attribution_status === 'caselift_recovered' || c.attribution_status === 'caselift_assisted') {
    return true
  }
  if (repliedSet.has(c.id)) return true
  if (sentSet.has(c.id)) return true
  return false
}

/** Production $ from accepted, CaseLift-attributed consults (tx plan value chain). */
export function computeAttributedProduction(consults, practice, { sentSet, repliedSet }) {
  let confirmed = 0
  let pipeline = 0
  let attributedCount = 0
  for (const c of consults || []) {
    if (!isAcceptedConsult(c)) continue
    if (!attributedToCaseLift(c, sentSet, repliedSet)) continue
    const { value, source } = consultTxValue(c, practice)
    attributedCount += 1
    if (isConfirmedSource(source)) confirmed += value
    else pipeline += value
  }
  return {
    confirmed,
    pipeline,
    total: confirmed + pipeline,
    attributedCount,
    roi: confirmed > 0 ? Math.max(1, Math.round(confirmed / 997)) : 0,
  }
}

export function countSentMessages(messages) {
  return (messages || []).filter(
    (m) => m.status === 'sent' || (m.sent_at && SENT_MESSAGE_STATUSES.includes(m.status)),
  ).length
}

/** Reply rate by sequence position from message_outcomes (1-based positions). */
export function replyRatesByPosition(outcomes, maxPos = 6) {
  const pos = {}
  for (const r of outcomes || []) {
    const i = r.message_position
    if (i == null || i < 1) continue
    if (!pos[i]) pos[i] = { sent: 0, replied: 0 }
    pos[i].sent += 1
    if (r.replied) pos[i].replied += 1
  }
  return Array.from({ length: maxPos }, (_, idx) => {
    const position = idx + 1
    const bucket = pos[position]
    return {
      label: `${position}`,
      position,
      sent: bucket?.sent || 0,
      replied: bucket?.replied || 0,
      rate: bucket?.sent ? Math.round((bucket.replied / bucket.sent) * 100) : 0,
    }
  })
}

export function bestMessageFromOutcomes(outcomes) {
  const rates = replyRatesByPosition(outcomes, 12)
  return (
    [...rates].filter((r) => r.sent > 0).sort((a, b) => b.rate - a.rate || b.replied - a.replied)[0] ||
    null
  )
}

/** Close rate for consults in a month bucket: closed / total recorded that month. */
export function closeRateForRows(rows) {
  const total = rows.length
  const closed = rows.filter(isClosedConsult).length
  return total ? Math.round((closed / total) * 100) : 0
}

export async function fetchDashboardExtras(practiceId, weekStartIso) {
  const empty = {
    sentConsultIds: new Set(),
    repliedConsultIds: new Set(),
    inboundRepliesWeek: 0,
    messageOutcomes: [],
  }
  if (!practiceId) return empty

  const [{ data: sentMsgs }, { data: convs }, { data: outcomes }] = await Promise.all([
    supabase.from('messages').select('consult_id').eq('practice_id', practiceId).eq('status', 'sent'),
    supabase.from('conversations').select('id, consult_id').eq('practice_id', practiceId),
    supabase
      .from('message_outcomes')
      .select('message_position, message_channel, replied, closed_after')
      .eq('practice_id', practiceId),
  ])

  const sentConsultIds = new Set((sentMsgs || []).map((m) => m.consult_id).filter(Boolean))
  const convRows = convs || []
  const convIds = convRows.map((c) => c.id)
  const convToConsult = new Map(convRows.filter((c) => c.consult_id).map((c) => [c.id, c.consult_id]))
  const repliedConsultIds = new Set()

  let inboundRepliesWeek = 0
  if (convIds.length) {
    const [{ count }, { data: inbound }] = await Promise.all([
      supabase
        .from('conversation_messages')
        .select('id', { count: 'exact', head: true })
        .in('conversation_id', convIds)
        .eq('direction', 'inbound')
        .gte('sent_at', weekStartIso),
      supabase
        .from('conversation_messages')
        .select('conversation_id')
        .in('conversation_id', convIds)
        .eq('direction', 'inbound')
        .gte('sent_at', weekStartIso),
    ])
    inboundRepliesWeek = count || 0
    for (const r of inbound || []) {
      const cid = convToConsult.get(r.conversation_id)
      if (cid) repliedConsultIds.add(cid)
    }
  }

  return {
    sentConsultIds,
    repliedConsultIds,
    inboundRepliesWeek,
    messageOutcomes: outcomes || [],
  }
}
