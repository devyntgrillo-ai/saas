// Shared display config + helpers for consult records.

// ----------------------------------------------------------------------------
// Consult workflow status
//   pending  - AI has analyzed; awaiting TC approval of the follow-up plan
//   approved - TC approved; patient confirmed and the sequence is queued/sending
//   active   - follow-up in progress / patient re-engaged in conversation
// (Legacy statuses kept so older rows still render with a sensible badge.)
// ----------------------------------------------------------------------------
// Badges are text-only on the subtle surface - semantic text color, no colored fill.
const BADGE = 'bg-surface-700 ring-white/[0.06]'
export const CONSULT_STATUS = {
  pending: { label: 'Pending', classes: `${BADGE} text-slate-400` },
  approved: { label: 'Approved', classes: `${BADGE} text-[#60a5fa]` },
  active: { label: 'Active', classes: `${BADGE} text-[#10b981]` },
  replied: { label: 'Replied', classes: `${BADGE} text-primary-300` },
  closed_won: { label: 'Converted', classes: `${BADGE} text-[#10b981]` },
  closed_lost: { label: 'Not converting', classes: `${BADGE} text-[#f87171]` },
  // legacy
  new: { label: 'New', classes: `${BADGE} text-slate-400` },
  analyzing: { label: 'Analyzing', classes: `${BADGE} text-[#60a5fa]` },
  transcribed: { label: 'Transcribed', classes: `${BADGE} text-[#60a5fa]` },
  transcription_error: { label: 'Transcription Error', classes: `${BADGE} text-[#f87171]` },
  analyzed: { label: 'Analyzed', classes: `${BADGE} text-primary-300` },
  followed_up: { label: 'Followed up', classes: `${BADGE} text-primary-300` },
  recovered: { label: 'Recovered', classes: `${BADGE} text-[#10b981]` },
  lost: { label: 'Lost', classes: `${BADGE} text-[#f87171]` },
}

export function statusMeta(status) {
  return CONSULT_STATUS[status] || CONSULT_STATUS.pending
}

// Statuses that count as a recovered / converted case for analytics.
export const WON_STATUSES = ['active', 'closed_won', 'recovered']
export const isWonStatus = (status) => WON_STATUSES.includes(status)

// Closed-won only (excludes in-sequence "active") — use for close-rate %.
export const CLOSED_WON_STATUSES = ['closed_won', 'recovered']
export const isClosedWonStatus = (status) => CLOSED_WON_STATUSES.includes(status)

// The statuses surfaced in filters / dashboards (in workflow order).
export const CONSULT_STATUS_ORDER = ['pending', 'approved', 'active', 'replied', 'closed_won', 'closed_lost']

// ----------------------------------------------------------------------------
// Primary objection (categorical badge)
// ----------------------------------------------------------------------------
// Objections render as neutral pills (subtle bg, muted text) - no bright colors.
export const OBJECTIONS = {
  price: { label: 'Price', classes: `${BADGE} text-slate-300` },
  spouse: { label: 'Spouse', classes: `${BADGE} text-slate-300` },
  fear: { label: 'Fear', classes: `${BADGE} text-slate-300` },
  timing: { label: 'Timing', classes: `${BADGE} text-slate-300` },
}

export function objectionMeta(type) {
  return (
    OBJECTIONS[type] || {
      label: type || 'Other',
      classes: `${BADGE} text-slate-300`,
    }
  )
}

export const OBJECTION_ORDER = ['price', 'spouse', 'fear', 'timing']

// ----------------------------------------------------------------------------
// Exit intent (how warm the patient was when they left)
// ----------------------------------------------------------------------------
export const EXIT_INTENTS = {
  hot: { label: 'Hot', classes: `${BADGE} text-slate-300`, dot: 'bg-slate-400' },
  warm: { label: 'Warm', classes: `${BADGE} text-slate-300`, dot: 'bg-slate-400' },
  long_term: { label: 'Long-term', classes: `${BADGE} text-slate-300`, dot: 'bg-slate-400' },
}

export function exitIntentMeta(level) {
  return (
    EXIT_INTENTS[level] || {
      label: level || 'Unknown',
      classes: `${BADGE} text-slate-300`,
      dot: 'bg-slate-400',
    }
  )
}

// ----------------------------------------------------------------------------
// Follow-up message status
// ----------------------------------------------------------------------------
// Message status: text-only semantic colors on the subtle surface.
export const MESSAGE_STATUS = {
  pending: { label: 'Pending', classes: `${BADGE} text-slate-400` },
  sent: { label: 'Sent', classes: `${BADGE} text-[#10b981]` },
  opened: { label: 'Opened', classes: `${BADGE} text-[#60a5fa]` },
  replied: { label: 'Replied', classes: `${BADGE} text-primary-300` },
  // legacy
  draft: { label: 'Draft', classes: `${BADGE} text-slate-400` },
  scheduled: { label: 'Scheduled', classes: `${BADGE} text-[#60a5fa]` },
  failed: { label: 'Failed', classes: `${BADGE} text-[#f87171]` },
}

export function messageStatusMeta(status) {
  return MESSAGE_STATUS[status] || MESSAGE_STATUS.pending
}

// ----------------------------------------------------------------------------
// Date / time formatting
// ----------------------------------------------------------------------------
export function formatDate(date) {
  if (!date) return '-'
  // date is a 'YYYY-MM-DD' string; parse as local to avoid TZ drift.
  const [y, m, d] = String(date).split('-').map(Number)
  if (!y) return '-'
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatTime(time) {
  if (!time) return '-'
  // time is 'HH:MM:SS'
  const [h, m] = String(time).split(':').map(Number)
  if (Number.isNaN(h)) return '-'
  const d = new Date()
  d.setHours(h, m || 0, 0, 0)
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function formatDuration(seconds) {
  if (!seconds) return null
  const mins = Math.round(seconds / 60)
  return `${mins} min`
}

export function formatDateTime(ts) {
  if (!ts) return '-'
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// Compact relative time for inbox/list views (e.g. "3h", "2d").
export function timeAgo(ts) {
  if (!ts) return ''
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.round(hrs / 24)
  if (days < 7) return `${days}d`
  const weeks = Math.round(days / 7)
  return `${weeks}w`
}
