// Client helpers for the AI learning & optimization system.
import { supabase } from './supabase'

// Top network insights, optionally filtered to a patient type.
export async function fetchNetworkInsights({ objectionType, exitIntent, limit = 3 } = {}) {
  let q = supabase
    .from('network_insights')
    .select('*')
    .order('confidence_score', { ascending: false })
    .limit(limit)
  if (objectionType) q = q.eq('objection_type', objectionType)
  if (exitIntent) q = q.eq('exit_intent', exitIntent)
  const { data } = await q
  return data || []
}

// The practice's most common objection type (drives "what's working").
export async function fetchCommonObjection(practiceId) {
  if (!practiceId) return null
  const { data } = await supabase
    .from('consults')
    .select('objection_type')
    .eq('practice_id', practiceId)
    .not('objection_type', 'is', null)
    .limit(300)
  const counts = {}
  for (const c of data || []) counts[c.objection_type] = (counts[c.objection_type] || 0) + 1
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null
}

// Aggregate this practice's own outcomes (RLS-scoped) into headline metrics +
// best-performing message position.
export async function fetchPracticeOutcomeStats(practiceId) {
  if (!practiceId) return null
  const { data } = await supabase
    .from('message_outcomes')
    .select('message_position, message_channel, replied, closed_after, opened')
    .eq('practice_id', practiceId)
  const rows = data || []
  if (rows.length === 0) {
    return { sample: 0, replyRate: 0, closeRate: 0, best: null }
  }
  const replyRate = rows.filter((r) => r.replied).length / rows.length
  const closeRate = rows.filter((r) => r.closed_after).length / rows.length

  const pos = {}
  for (const r of rows) {
    const k = r.message_position
    if (!k) continue
    pos[k] = pos[k] || { n: 0, replied: 0, channel: {} }
    pos[k].n++
    if (r.replied) pos[k].replied++
    pos[k].channel[r.message_channel] = (pos[k].channel[r.message_channel] || 0) + 1
  }
  const best = Object.entries(pos)
    .map(([k, v]) => ({
      position: Number(k),
      rate: v.replied / v.n,
      sent: v.n,
      channel: Object.entries(v.channel).sort((a, b) => b[1] - a[1])[0]?.[0] || '',
    }))
    .sort((a, b) => b.rate - a.rate)[0] || null

  return { sample: rows.length, replyRate, closeRate, best }
}

// Practice vs network comparison shown on the Dashboard.
export async function fetchNetworkComparison(practiceId) {
  const [stats, insights] = await Promise.all([
    fetchPracticeOutcomeStats(practiceId),
    supabase.from('network_insights').select('avg_reply_rate, avg_close_rate, message_position, message_channel, finding'),
  ])
  const ni = insights.data || []
  const avg = (key) => {
    const vals = ni.map((x) => x[key]).filter((v) => v != null)
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
  }
  const networkReply = avg('avg_reply_rate')
  const networkClose = avg('avg_close_rate')

  // Network's best message position (highest avg reply rate).
  const byPos = {}
  for (const x of ni) {
    if (x.message_position == null) continue
    byPos[x.message_position] = byPos[x.message_position] || { n: 0, sum: 0, channel: {} }
    byPos[x.message_position].n++
    byPos[x.message_position].sum += x.avg_reply_rate || 0
    byPos[x.message_position].channel[x.message_channel] = (byPos[x.message_position].channel[x.message_channel] || 0) + 1
  }
  const networkBest = Object.entries(byPos)
    .map(([k, v]) => ({ position: Number(k), rate: v.sum / v.n, channel: Object.entries(v.channel).sort((a, b) => b[1] - a[1])[0]?.[0] || '' }))
    .sort((a, b) => b.rate - a.rate)[0] || null

  const sample = stats?.sample || 0
  const hasData = sample > 0
  // Don't score practices with no sequence outcomes — 0% vs the network avg reads as -100%.
  const replyDelta = hasData && networkReply
    ? Math.round(((stats.replyRate || 0) - networkReply) / networkReply * 100)
    : null

  return {
    practice: stats,
    network: { replyRate: networkReply, closeRate: networkClose, best: networkBest },
    score: replyDelta,
    hasData,
  }
}

// Invoke the optimize-message edge function for one message.
export async function optimizeMessage(messageId) {
  const { data, error } = await supabase.functions.invoke('optimize-message', {
    body: { message_id: messageId },
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data // { optimized, explanation, original }
}

// Invoke the training-recommendation edge function for a practice.
// Returns { based_on, recommendation, focus_area }.
export async function fetchTrainingRecommendation(practiceId) {
  // Preferred path: the Claude-backed edge function. If it isn't reachable
  // (not deployed, no API key, network error), fall back to a local heuristic
  // computed from the practice's own consults so the card still says something
  // useful instead of an error.
  try {
    const { data, error } = await supabase.functions.invoke('training-recommendation', {
      body: { practice_id: practiceId },
    })
    if (error) throw error
    if (data?.error) throw new Error(data.error)
    return { ...data, source: 'ai' }
  } catch {
    return await localTrainingRecommendation(practiceId)
  }
}

// Objection -> heuristic coaching line + the training track that addresses it.
const OBJECTION_GUIDANCE = {
  price: {
    focus_area: 'Sales & Objections',
    line: 'Price is the objection coming up most in your recent consults. Lead with financing and monthly options, and anchor on value before quoting the full number.',
  },
  fear: {
    focus_area: 'Sales & Objections',
    line: 'Anxiety and fear are showing up across your recent consults. Acknowledge the nerves first, then walk patients calmly through sedation and comfort options.',
  },
  spouse: {
    focus_area: 'Sales & Objections',
    line: 'Patients are deferring to a spouse before deciding. Loop the decision-maker in early, for example by offering a joint call so numbers are not relayed secondhand.',
  },
  timing: {
    focus_area: 'Sales & Objections',
    line: 'Timing is the pattern in your recent consults. Create gentle urgency and lock in a concrete next step so warm patients do not drift.',
  },
}

// Local fallback: read the last few analyzed consults (RLS-scoped to the signed-in
// user) and turn the dominant objection / outcome pattern into a recommendation.
async function localTrainingRecommendation(practiceId) {
  const { data, error } = await supabase
    .from('consults')
    .select('objection_type, primary_objection, outcome, status')
    .eq('practice_id', practiceId)
    .in('status', ['analyzed', 'followed_up', 'recovered', 'lost'])
    .order('recording_date', { ascending: false })
    .limit(10)
  if (error) throw error // even the fallback failed - let the page show its error state

  const consults = data || []
  if (consults.length === 0) {
    return {
      ok: true,
      based_on: 0,
      focus_area: null,
      source: 'heuristic',
      recommendation:
        'Record and analyze a few consults to unlock a personalized training recommendation. Once we have analyzed consults, this card will highlight the exact skills your team should focus on.',
    }
  }

  const tally = {}
  for (const c of consults) {
    const key = (c.objection_type || c.primary_objection || '').toString().trim().toLowerCase()
    if (key) tally[key] = (tally[key] || 0) + 1
  }
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]
  const lost = consults.filter((c) => c.outcome === 'not_converting' || c.status === 'lost').length
  const lostNote = lost >= 2 ? ` ${lost} of these did not convert, so this is where the next win is hiding.` : ''

  const guide = top && OBJECTION_GUIDANCE[top[0]]
  if (guide) {
    return { ok: true, based_on: consults.length, source: 'heuristic', focus_area: guide.focus_area, recommendation: guide.line + lostNote }
  }
  return {
    ok: true,
    based_on: consults.length,
    source: 'heuristic',
    focus_area: 'TC Certification',
    recommendation:
      'Keep sharpening the fundamentals across your recent consults: confirm the patient is ready, surface the real objection early, and always set a concrete next step before they leave.' + lostNote,
  }
}

// Persist an accepted optimization (updates the message + logs it).
export async function acceptOptimization({ messageId, practiceId, before, after, explanation }) {
  const { error: ue } = await supabase.from('messages').update({ body: after }).eq('id', messageId)
  if (ue) throw ue
  await supabase.from('message_optimizations').insert({
    message_id: messageId,
    practice_id: practiceId,
    before_body: before,
    after_body: after,
    explanation,
  })
}
