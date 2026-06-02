import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bell,
  PhoneCall,
  MessageSquare,
  Send,
  PauseCircle,
  CheckCheck,
  Loader2,
  CheckCircle2,
  Clock,
  Sparkles,
  Settings,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import {
  fetchNotifications,
  markAllRead,
  markRead,
  notificationMeta,
  subscribeNotifications,
  TONE_BORDER,
} from '../lib/notifications'
import { timeAgo } from '../lib/consults'

const ICONS = { PhoneCall, MessageSquare, Send, PauseCircle, Bell, CheckCircle2, Clock, Sparkles }

function isToday(ts) {
  const d = new Date(ts)
  const n = new Date()
  return d.toDateString() === n.toDateString()
}

export default function NotificationBell() {
  const { practiceId } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const ref = useRef(null)

  const unread = items.filter((n) => !n.read).length

  // Initial load + realtime subscription.
  useEffect(() => {
    if (!practiceId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setItems([])
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    fetchNotifications(practiceId)
      .then((rows) => active && setItems(rows))
      .catch(() => active && setItems([]))
      .finally(() => active && setLoading(false))

    const unsub = subscribeNotifications(practiceId, (payload) => {
      setItems((prev) => {
        if (payload.eventType === 'INSERT') {
          if (prev.some((n) => n.id === payload.new.id)) return prev
          return [payload.new, ...prev].slice(0, 30)
        }
        if (payload.eventType === 'UPDATE') {
          return prev.map((n) => (n.id === payload.new.id ? payload.new : n))
        }
        if (payload.eventType === 'DELETE') {
          return prev.filter((n) => n.id !== payload.old.id)
        }
        return prev
      })
    })
    return () => {
      active = false
      unsub()
    }
  }, [practiceId])

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  async function handleClick(n) {
    if (!n.read) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
      markRead(n.id)
    }
    setOpen(false)
    if (n.link) navigate(n.link)
  }

  async function handleMarkAll() {
    setItems((prev) => prev.map((x) => ({ ...x, read: true })))
    if (practiceId) markAllRead(practiceId)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-lg p-2 text-slate-400 transition hover:bg-surface-800 hover:text-slate-100"
        aria-label="Notifications"
      >
        <Bell className="h-[18px] w-[18px]" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold !text-white ring-2 ring-surface-900">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[400px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-surface-700 bg-surface-900 shadow-2xl">
          <div className="flex items-center justify-between border-b border-surface-700 px-4 py-3">
            <p className="text-sm font-semibold text-white">Notifications</p>
            {unread > 0 && (
              <button
                onClick={handleMarkAll}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary-400 hover:text-primary-300"
              >
                <CheckCheck className="h-3.5 w-3.5" /> Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[500px] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-10 text-slate-500">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : items.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <Bell className="mx-auto h-8 w-8 text-slate-600" />
                <p className="mt-3 text-sm text-slate-400">You’re all caught up ✓</p>
              </div>
            ) : (
              ['today', 'earlier'].map((bucket) => {
                const rows = items.filter((n) => (bucket === 'today' ? isToday(n.created_at) : !isToday(n.created_at)))
                if (!rows.length) return null
                return (
                  <div key={bucket}>
                    <p className="bg-surface-800/40 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      {bucket === 'today' ? 'Today' : 'Earlier'}
                    </p>
                    <ul className="divide-y divide-surface-700">
                      {rows.map((n) => {
                        const meta = notificationMeta(n.type)
                        const Icon = ICONS[meta.icon] || Bell
                        const border = TONE_BORDER[meta.tone] || 'border-l-sky-500'
                        return (
                          <li key={n.id}>
                            <button
                              onClick={() => handleClick(n)}
                              className={`flex w-full gap-3 border-l-[3px] px-4 py-3 text-left transition hover:bg-surface-800/60 ${border} ${n.read ? 'border-l-transparent' : 'bg-primary/[0.04]'}`}
                            >
                              <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${meta.classes}`}>
                                <Icon className="h-4 w-4" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center justify-between gap-2">
                                  <span className={`truncate text-sm ${n.read ? 'font-medium text-slate-300' : 'font-semibold text-white'}`}>{n.title}</span>
                                  <span className="shrink-0 text-[11px] text-slate-500">{timeAgo(n.created_at)}</span>
                                </span>
                                {n.message && <span className="mt-0.5 block truncate text-xs text-slate-500">{n.message}</span>}
                              </span>
                              {!n.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )
              })
            )}
          </div>

          <button
            onClick={() => { setOpen(false); navigate('/settings/notifications') }}
            className="flex w-full items-center justify-center gap-1.5 border-t border-surface-700 px-4 py-2.5 text-xs font-medium text-slate-400 transition hover:bg-surface-800/60 hover:text-slate-200"
          >
            <Settings className="h-3.5 w-3.5" /> Notification settings →
          </button>
        </div>
      )}
    </div>
  )
}
