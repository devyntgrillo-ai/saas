// Follow-up sequence configuration. Message COPY is AI-generated per patient
// (by analyze-consult) - this config only controls timing, channel, delivery
// rules, and the activation hold. Stored in practices.sequence_config (jsonb).

// Default 12-month tapering cadence. (day is days-after-consult; 0 = same day.)
export const DEFAULT_TOUCHPOINTS = [
  { day: 0, channel: 'sms', enabled: true },
  { day: 3, channel: 'sms', enabled: true },
  { day: 7, channel: 'email', enabled: true },
  { day: 14, channel: 'sms', enabled: true },
  { day: 30, channel: 'email', enabled: true },
  { day: 60, channel: 'sms', enabled: true },
  { day: 90, channel: 'email', enabled: true },
  { day: 150, channel: 'sms', enabled: true },
  { day: 180, channel: 'email', enabled: true },
  { day: 240, channel: 'sms', enabled: true },
  { day: 300, channel: 'email', enabled: true },
  { day: 365, channel: 'sms', enabled: true },
]

export const DEFAULT_RULES = {
  quietHours: true,
  quietStart: '08:00',
  quietEnd: '18:00',
  weekendDelivery: true,
  holdHours: 24,
  timezone: 'America/Chicago',
  stopOnReply: true,
  stopOnBooking: true,
  stopOnNotConverting: true,
  reengagement: false,
}

/** Smart-timing presets (mirrors supabase/functions/_shared/sequence.ts). */
export const TIMING_PRESETS = {
  hot: { label: 'Hot', days: [0, 1, 3, 5, 7, 14], channels: ['sms', 'email', 'sms', 'sms', 'email', 'sms'] },
  warm: { label: 'Warm', days: [0, 3, 7, 14, 30, 60], channels: ['sms', 'email', 'sms', 'email', 'sms', 'email'] },
  long_term: { label: 'Long-term', days: [0, 7, 14, 30, 60, 90], channels: ['sms', 'email', 'sms', 'email', 'sms', 'email'] },
}

const clone = (arr) => arr.map((x) => ({ ...x }))

// Auto-generate a human label from the day offset.
export function labelForDay(day) {
  const d = Number(day) || 0
  if (d === 0) return 'Same-day check-in'
  if (d < 7) return `${d}-day follow-up`
  if (d < 14) return '1-week follow-up'
  if (d < 30) return `${Math.round(d / 7)}-week nurture`
  if (d === 30) return '30-day re-engagement'
  if (d < 365) return `${Math.round(d / 30)}-month check-in`
  return '12-month final touch'
}

// Parse the stored config into { touchpoints, rules }, tolerating the legacy
// step-array format (migrates timing/channel; drops the old template copy).
export function parseSequenceConfig(config) {
  let obj = config
  if (typeof config === 'string') {
    try { obj = JSON.parse(config) } catch { obj = null }
  }
  const defaults = () => ({ touchpoints: clone(DEFAULT_TOUCHPOINTS), rules: { ...DEFAULT_RULES } })
  if (!obj) return defaults()

  const normTp = (t) => ({ day: Math.max(0, Number(t.day) || 0), channel: t.channel === 'email' ? 'email' : 'sms', enabled: t.enabled !== false })

  if (obj.touchpoints || obj.rules) {
    const tps = Array.isArray(obj.touchpoints) && obj.touchpoints.length ? obj.touchpoints.map(normTp) : clone(DEFAULT_TOUCHPOINTS)
    return { touchpoints: tps, rules: { ...DEFAULT_RULES, ...(obj.rules || {}) } }
  }
  if (Array.isArray(obj) && obj.length) {
    return { touchpoints: obj.map(normTp), rules: { ...DEFAULT_RULES } }
  }
  return defaults()
}

export function serializeSequenceConfig(touchpoints, rules) {
  return JSON.stringify({ version: 2, touchpoints, rules })
}

export function rulesFromConfig(config, practiceTimezone) {
  const { rules } = parseSequenceConfig(config)
  return {
    ...DEFAULT_RULES,
    ...rules,
    timezone: rules.timezone || practiceTimezone || DEFAULT_RULES.timezone,
  }
}

/** Enabled touchpoints (max 12), merged with smart-timing preset when set. */
export function resolveTouchpoints(config, timingPreset) {
  const { touchpoints } = parseSequenceConfig(config)
  const enabled = touchpoints.filter((t) => t.enabled !== false).slice(0, 12)
  const preset = timingPreset && TIMING_PRESETS[timingPreset]
  if (!preset) return enabled

  const out = []
  for (let i = 0; i < preset.days.length && i < 12; i++) {
    const day = preset.days[i]
    const raw = preset.channels[i] ?? 'sms'
    out.push({ day, channel: raw === 'email' ? 'email' : 'sms', enabled: true })
  }
  return out
}

function tzOffsetMs(at, timeZone) {
  const utc = new Date(at.toLocaleString('en-US', { timeZone: 'UTC' }))
  const zoned = new Date(at.toLocaleString('en-US', { timeZone }))
  return zoned.getTime() - utc.getTime()
}

function localParts(at, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = Object.fromEntries(
    fmt.formatToParts(at).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value])
  )
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  }
}

function localToUtc(year, month, day, hour, minute, timeZone) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0))
  return new Date(guess.getTime() - tzOffsetMs(guess, timeZone))
}

/** Compute send time for a touchpoint (practice timezone + hold + quiet hours). */
export function computeScheduledFor(createdAtIso, day, rules) {
  const tz = rules.timezone || DEFAULT_RULES.timezone
  const created = new Date(createdAtIso).getTime()
  const holdMs = (rules.holdHours || 24) * 3600 * 1000
  let at = new Date(Math.max(created + day * 86400000, created + holdMs))

  const [qs, qsm] = String(rules.quietStart || '08:00').split(':').map(Number)
  const [qe, qem] = String(rules.quietEnd || '18:00').split(':').map(Number)

  const applyQuiet = () => {
    if (rules.quietHours === false) return
    let lp = localParts(at, tz)
    if (lp.hour < qs || (lp.hour === qs && lp.minute < (qsm || 0))) {
      at = localToUtc(lp.year, lp.month, lp.day, qs, qsm || 0, tz)
    } else if (lp.hour > qe || (lp.hour === qe && lp.minute >= (qem || 0))) {
      at = new Date(at.getTime() + 86400000)
      lp = localParts(at, tz)
      at = localToUtc(lp.year, lp.month, lp.day, qs, qsm || 0, tz)
    }
  }

  const applyWeekend = () => {
    if (rules.weekendDelivery !== false) return
    let lp = localParts(at, tz)
    const noon = localToUtc(lp.year, lp.month, lp.day, 12, 0, tz)
    const dow = noon.getUTCDay()
    if (dow === 6) at = new Date(at.getTime() + 2 * 86400000)
    else if (dow === 0) at = new Date(at.getTime() + 86400000)
    lp = localParts(at, tz)
    at = localToUtc(lp.year, lp.month, lp.day, qs, qsm || 0, tz)
  }

  applyQuiet()
  applyWeekend()
  applyQuiet()
  return at.toISOString()
}

/** Recompute scheduled_for for unsent messages on a consult (TC approve / timing edit). */
export async function scheduleConsultMessages(supabase, { consultId, createdAt, sequenceConfig, practiceTimezone, timingPreset }) {
  const rules = rulesFromConfig(sequenceConfig, practiceTimezone)
  const touchpoints = resolveTouchpoints(sequenceConfig, timingPreset)
  const { data: msgs } = await supabase
    .from('messages')
    .select('id, status, channel')
    .eq('consult_id', consultId)
    .in('status', ['draft', 'scheduled', 'pending'])
    .order('created_at', { ascending: true })

  const unsent = msgs || []
  for (let i = 0; i < unsent.length && i < touchpoints.length; i++) {
    const tp = touchpoints[i]
    const scheduled_for = computeScheduledFor(createdAt, tp.day, rules)
    await supabase
      .from('messages')
      .update({ send_day: tp.day, scheduled_for, status: 'scheduled' })
      .eq('id', unsent[i].id)
  }

  await supabase
    .from('consults')
    .update({ followup_approved_at: new Date().toISOString() })
    .eq('id', consultId)
}
