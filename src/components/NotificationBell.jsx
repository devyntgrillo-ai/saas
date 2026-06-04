import { useRef, useState } from 'react'
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
  notificationMeta,
  TONE_BORDER,
} from '../lib/notifications'
import { timeAgo } from '../lib/consults'
import {
  useNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  useNotificationsRealtime,
} from '../lib/queries'

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
  const ref = useRef(null)

  const { data: items = [], isLoading: loading } = useNotifications(practiceId)
  useNotificationsRealtime(practiceId)
  const markReadMutation = useMarkNotificationRead()
  const markAllMutation = useMarkAllNotificationsRead()

  const unread = items.filter((n) => !n.read).length

  async function handleMarkRead(id) {
    await markReadMutation.mutateAsync({ id, practiceId })
  }

  async function handleMarkAll() {
    await markAllMutation.mutateAsync(practiceId)
  }

  function go(n) {
    setOpen(false)
    if (n.link) navigate(n.link)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-lg p-2 text-slate-400 transition hover:bg-surface-800 hover:text-slate-200"
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-surface-700 bg-surface-900 shadow-xl">
            <div className="flex items-center justify-between border-b border-surface-700 px-4 py-3">
              <h3 className="text-sm font-semibold text-white">Notifications</h3>
              {unread > 0 && (
                <button type="button" onClick={handleMarkAll} className="text-xs font-medium text-primary-400 hover:text-primary-300">
                  Mark all read
                </button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {loading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
                </div>
              ) : items.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-slate-500">No notifications yet.</p>
              ) : (
                items.map((n) => {
                  const meta = notificationMeta(n.type)
                  const Icon = ICONS[meta.icon] || Bell
                  return (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => { handleMarkRead(n.id); go(n) }}
                      className={`flex w-full gap-3 border-l-4 px-4 py-3 text-left transition hover:bg-surface-800/60 ${TONE_BORDER[meta.tone] || ''} ${n.read ? 'opacity-60' : ''}`}
                    >
                      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${meta.classes}`}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-200">{n.title}</p>
                        {n.message && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{n.message}</p>}
                        <p className="mt-1 text-[11px] text-slate-600">
                          {isToday(n.created_at) ? timeAgo(n.created_at) : new Date(n.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      {!n.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                    </button>
                  )
                })
              )}
            </div>
            <div className="border-t border-surface-700 px-4 py-2">
              <button
                type="button"
                onClick={() => { setOpen(false); navigate('/settings/notifications') }}
                className="flex w-full items-center justify-center gap-1.5 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-200"
              >
                <Settings className="h-3.5 w-3.5" /> Notification settings
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
