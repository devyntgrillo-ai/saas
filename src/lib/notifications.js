// Notification helpers - fetch, create, mark-read, and realtime subscription.
import { supabase } from './supabase'

// Visual config + default copy per notification type. `tone` drives the colored
// left border in the bell: green = positive, amber = action, blue = info.
export const NOTIFICATION_TYPES = {
  consult_analyzed: { label: 'CaseLift analyzed a new consult', icon: 'PhoneCall', tone: 'amber', classes: 'bg-amber-500/10 text-amber-400' },
  patient_replied: { label: 'CaseLift got a reply', icon: 'MessageSquare', tone: 'green', classes: 'bg-emerald-500/10 text-emerald-400' },
  case_converted: { label: 'CaseLift recovered a case', icon: 'CheckCircle2', tone: 'green', classes: 'bg-emerald-500/10 text-emerald-400' },
  patient_waiting: { label: 'A patient is waiting on CaseLift', icon: 'Clock', tone: 'amber', classes: 'bg-amber-500/10 text-amber-400' },
  low_recording_rate: { label: 'CaseLift noticed your recording rate dropped', icon: 'PhoneCall', tone: 'amber', classes: 'bg-amber-500/10 text-amber-400' },
  call_due: { label: 'CaseLift has follow-ups due today', icon: 'PhoneCall', tone: 'amber', classes: 'bg-amber-500/10 text-amber-400' },
  ai_update: { label: 'CaseLift updated your sequences', icon: 'Sparkles', tone: 'blue', classes: 'bg-sky-500/10 text-sky-400' },
  sequence_started: { label: 'CaseLift started a follow-up sequence', icon: 'Send', tone: 'blue', classes: 'bg-[var(--accent-subtle)] text-[var(--accent)]' },
  sequence_paused: { label: 'CaseLift paused a sequence', icon: 'PauseCircle', tone: 'amber', classes: 'bg-amber-500/10 text-amber-400' },
  reactivation_reply: { label: 'CaseLift got a reactivation reply', icon: 'MessageSquare', tone: 'green', classes: 'bg-emerald-500/10 text-emerald-400' },
  info: { label: 'Notification', icon: 'Bell', tone: 'blue', classes: 'bg-slate-500/10 text-slate-400' },
}

// Tailwind left-border class per tone.
export const TONE_BORDER = { green: 'border-l-emerald-500', amber: 'border-l-amber-500', blue: 'border-l-sky-500' }

export function notificationMeta(type) {
  return NOTIFICATION_TYPES[type] || NOTIFICATION_TYPES.info
}

export async function fetchNotifications(practiceId, { limit = 30 } = {}) {
  if (!practiceId) return []
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('practice_id', practiceId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

export async function markRead(id) {
  return supabase.from('notifications').update({ read: true }).eq('id', id)
}

export async function markAllRead(practiceId) {
  return supabase
    .from('notifications')
    .update({ read: true })
    .eq('practice_id', practiceId)
    .eq('read', false)
}

// Insert a notification (used by client flows; server flows insert via service role).
export async function createNotification({ practiceId, userId = null, type = 'info', title, message = null, link = null }) {
  return supabase.from('notifications').insert({
    practice_id: practiceId,
    user_id: userId,
    type,
    title,
    message,
    link,
  })
}

// Subscribe to realtime INSERT/UPDATE for a practice. Returns an unsubscribe fn.
export function subscribeNotifications(practiceId, onChange) {
  if (!practiceId) return () => {}
  const channel = supabase
    .channel(`notifications:${practiceId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'notifications', filter: `practice_id=eq.${practiceId}` },
      (payload) => onChange?.(payload)
    )
    .subscribe()
  return () => {
    supabase.removeChannel(channel)
  }
}
