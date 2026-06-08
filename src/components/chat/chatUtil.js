// Small shared helpers for the support-chat UI.
import { format, isToday, isYesterday } from 'date-fns'

export function initials(name) {
  const s = (name || '').trim()
  if (!s) return '?'
  const parts = s.split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return s.slice(0, 2).toUpperCase()
}

// Deterministic avatar color from a string (so a given practice/user is stable).
const COLORS = [
  'bg-rose-500', 'bg-orange-500', 'bg-amber-500', 'bg-emerald-500',
  'bg-teal-500', 'bg-sky-500', 'bg-indigo-500', 'bg-violet-500', 'bg-fuchsia-500',
]
export function avatarColor(key) {
  const s = key || ''
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return COLORS[Math.abs(h) % COLORS.length]
}

export function timeLabel(ts) {
  try { return format(new Date(ts), 'h:mm a') } catch { return '' }
}

// "Today" / "Yesterday" / "Monday, June 2" for date dividers.
export function dayLabel(ts) {
  const d = new Date(ts)
  if (isToday(d)) return 'Today'
  if (isYesterday(d)) return 'Yesterday'
  return format(d, 'EEEE, MMMM d')
}

export function dayKey(ts) {
  try { return format(new Date(ts), 'yyyy-MM-dd') } catch { return '' }
}

// Relative short label for inbox rows: "2m", "1h", "3d", or a date.
export function shortRelative(ts) {
  const then = new Date(ts).getTime()
  const diff = Date.now() - then
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  try { return format(new Date(ts), 'MMM d') } catch { return '' }
}

// Build the "Devyn, Laura, and 1 other" tooltip for a reaction group.
export function reactorTooltip(names) {
  const list = names.filter(Boolean)
  if (!list.length) return ''
  if (list.length === 1) return list[0]
  if (list.length === 2) return `${list[0]} and ${list[1]}`
  return `${list[0]}, ${list[1]}, and ${list.length - 2} other${list.length - 2 > 1 ? 's' : ''}`
}
