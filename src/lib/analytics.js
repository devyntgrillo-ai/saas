// Pure helpers that turn raw consults + messages into the analytics dashboard
// series. Kept framework-free so it's easy to reason about and test.
import { isClosedConsult, replyRatesByPosition } from './dashboard'

export const RANGES = [
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '90d', label: 'Last 90 days', days: 90 },
  { key: '6m', label: 'Last 6 months', days: 182 },
  { key: 'all', label: 'All time', days: null },
]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function parseDate(d) {
  if (!d) return null
  const [y, m, day] = String(d).split('-').map(Number)
  if (!y) return new Date(d)
  return new Date(y, m - 1, day)
}

function cutoffDate(days) {
  if (!days) return null
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - days)
  return d
}

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function monthLabel(d) {
  return `${MONTHS[d.getMonth()]}${d.getMonth() === 0 ? ` ’${String(d.getFullYear()).slice(2)}` : ''}`
}

// Monday-based week bucket.
function weekStart(d) {
  const x = new Date(d)
  const day = (x.getDay() + 6) % 7 // 0 = Monday
  x.setDate(x.getDate() - day)
  x.setHours(0, 0, 0, 0)
  return x
}
function weekLabel(d) {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}

const isWon = isClosedConsult
const money = (n) => Number(n) || 0

export function computeAnalytics(consults, messages, rangeKey, messageOutcomes = []) {
  const range = RANGES.find((r) => r.key === rangeKey) || RANGES[2]
  const cutoff = cutoffDate(range.days)

  const inRange = consults.filter((c) => {
    const d = parseDate(c.recording_date)
    return d && (!cutoff || d >= cutoff)
  })

  // --- Production recovered per month ---
  const prodMap = new Map()
  for (const c of inRange) {
    if (!isWon(c)) continue
    const d = parseDate(c.recording_date)
    const k = monthKey(d)
    if (!prodMap.has(k)) prodMap.set(k, { key: k, label: monthLabel(d), value: 0 })
    prodMap.get(k).value += money(c.case_value)
  }
  const production = [...prodMap.values()].sort((a, b) => a.key.localeCompare(b.key))

  // --- Consult volume per week ---
  const weekMap = new Map()
  for (const c of inRange) {
    const d = parseDate(c.recording_date)
    const ws = weekStart(d)
    const k = ws.toISOString().slice(0, 10)
    if (!weekMap.has(k)) weekMap.set(k, { key: k, label: weekLabel(ws), count: 0 })
    weekMap.get(k).count += 1
  }
  const volume = [...weekMap.values()].sort((a, b) => a.key.localeCompare(b.key))

  // --- Close rate per month (%) ---
  const closeMap = new Map()
  for (const c of inRange) {
    const d = parseDate(c.recording_date)
    const k = monthKey(d)
    if (!closeMap.has(k)) closeMap.set(k, { key: k, label: monthLabel(d), total: 0, won: 0 })
    const e = closeMap.get(k)
    e.total += 1
    if (isWon(c)) e.won += 1
  }
  const closeRate = [...closeMap.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((e) => ({ label: e.label, rate: e.total ? Math.round((e.won / e.total) * 100) : 0 }))

  // --- Objection breakdown ---
  const objMap = { price: 0, spouse: 0, fear: 0, timing: 0, other: 0 }
  for (const c of inRange) {
    const t = c.objection_type
    if (t && t in objMap) objMap[t] += 1
    else if (t) objMap.other += 1
  }
  const objections = Object.entries(objMap)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }))

  // --- Follow-up performance: replies by sequence position (message_outcomes) ---
  const followup = replyRatesByPosition(messageOutcomes, 8).map((r) => ({
    position: `Msg ${r.position}`,
    channel: '',
    replies: r.replied,
    sent: r.sent,
    replyRate: r.rate,
  }))

  // --- Stat cards ---
  const wonInRange = inRange.filter(isWon)
  const totalRecovered = wonInRange.reduce((s, c) => s + money(c.case_value), 0)
  const avgCaseValue = wonInRange.length ? Math.round(totalRecovered / wonInRange.length) : 0

  const now = new Date()
  const thisMonthKey = monthKey(now)
  const thisMonth = inRange.filter((c) => {
    const d = parseDate(c.recording_date)
    return d && monthKey(d) === thisMonthKey
  })
  const thisMonthWon = thisMonth.filter(isWon).length
  const closeRateThisMonth = thisMonth.length ? Math.round((thisMonthWon / thisMonth.length) * 100) : 0

  const best = [...followup].sort((a, b) => b.replies - a.replies)[0] || null
  const bestMessage = best ? `${best.position}${best.channel ? ` · ${best.channel.toUpperCase()}` : ''}` : '-'

  return {
    production,
    volume,
    closeRate,
    objections,
    followup,
    stats: { totalRecovered, avgCaseValue, closeRateThisMonth, bestMessage },
  }
}

export const OBJECTION_COLORS = {
  price: '#fb7185', // rose
  fear: '#fb923c', // orange
  spouse: '#a78bfa', // violet
  timing: '#38bdf8', // sky
  other: '#94a3b8', // slate
}

export function formatMoney(n) {
  const v = Number(n) || 0
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(abs % 1_000_000 === 0 ? 0 : 2)}M`
  if (abs >= 1000) return `$${(v / 1000).toFixed(abs % 1000 === 0 ? 0 : 1)}k`
  return `$${v.toLocaleString()}`
}
