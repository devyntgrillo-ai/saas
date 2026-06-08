import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { Search, Loader2, CheckCircle2, ExternalLink, MessageSquareText } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { useSupportChat } from '../../hooks/useSupportChat'
import MessageList from '../../components/chat/MessageList'
import ChatComposer from '../../components/chat/ChatComposer'
import ThreadPanel from '../../components/chat/ThreadPanel'
import PresenceBar from '../../components/chat/PresenceBar'
import { Avatar } from '../../components/chat/ChatMessage'
import { initials, avatarColor, shortRelative } from '../../components/chat/chatUtil'

const ONLINE_MS = 5 * 60 * 1000
// Churned / dead subaccounts are hidden from the inbox — only active + trialing
// (live) clients show.
const CHURNED = new Set(['cancelled', 'canceled', 'expired', 'unpaid', 'inactive', 'churned'])

function practiceName(c) { return c.practice?.name || 'Unknown practice' }
function doctorLine(c) {
  const p = c.practice || {}
  const doc = [p.doctor_first, p.doctor_last].filter(Boolean).join(' ')
  const loc = [p.city, p.state].filter(Boolean).join(', ')
  return [doc, loc].filter(Boolean).join(' · ')
}

export default function AdminChats() {
  const { user, profile } = useAuth()
  const [params, setParams] = useSearchParams()
  const [chats, setChats] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState(params.get('practice') || null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all') // all | unread | resolved
  const [thread, setThread] = useState(null)
  const [now, setNow] = useState(0)
  const searchRef = useRef(null)

  // Ticking clock (state, not Date.now() in render) for the "online" dots.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now())
    const iv = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(iv)
  }, [])

  const currentUser = useMemo(
    () => ({ id: user?.id, name: user?.user_metadata?.full_name || profile?.email || user?.email || 'CaseLift Team', avatar: null }),
    [user, profile],
  )

  const loadChats = useCallback(async () => {
    const { data } = await supabase
      .from('support_chats')
      .select('*, practice:practices(id,name,doctor_first,doctor_last,city,state,subscription_status)')
      .order('last_message_at', { ascending: false })
    setChats((data || []).filter(
      (c) => c.practice_id && !CHURNED.has((c.practice?.subscription_status || '').toLowerCase()),
    ))
    setLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadChats()
  }, [loadChats])

  // Live-update the inbox list (preview / unread / ordering) as chats change.
  useEffect(() => {
    const ch = supabase
      .channel('admin-support-chats')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_chats' }, () => loadChats())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [loadChats])

  // Selected practice → resolve its chat id.
  const selectedChat = chats.find((c) => c.practice_id === selectedId) || null
  const chatId = selectedChat?.id || null

  const chat = useSupportChat({ chatId, practiceId: selectedId, senderType: 'caselift_team', currentUser })

  useEffect(() => {
    if (chatId && !chat.loading) chat.markAsRead()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, chat.loading, chat.messages.length])

  function select(practiceId) {
    setSelectedId(practiceId)
    setThread(null)
    const next = new URLSearchParams(params)
    if (practiceId) next.set('practice', practiceId)
    else next.delete('practice')
    setParams(next, { replace: true })
  }

  // Filtered + sorted list (unread first, then most recent).
  const list = useMemo(() => {
    const q = search.trim().toLowerCase()
    return chats
      .filter((c) => {
        if (filter === 'unread' && !(c.unread_count_admin > 0)) return false
        if (filter === 'resolved' && !c.resolved_at) return false
        if (filter === 'all' && c.resolved_at) return false
        if (q && !practiceName(c).toLowerCase().includes(q)) return false
        return true
      })
      .sort((a, b) => {
        const au = a.unread_count_admin > 0 ? 1 : 0
        const bu = b.unread_count_admin > 0 ? 1 : 0
        if (au !== bu) return bu - au
        return new Date(b.last_message_at) - new Date(a.last_message_at)
      })
  }, [chats, search, filter])

  const totalUnread = chats.reduce((n, c) => n + (c.unread_count_admin > 0 ? 1 : 0), 0)

  // Keyboard shortcuts: J/K move, Cmd+K search, Escape deselect.
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); searchRef.current?.focus(); return
      }
      const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)
      if (e.key === 'Escape') { if (thread) setThread(null); else select(null); return }
      if (typing) return
      if (e.key === 'j' || e.key === 'k') {
        const idx = list.findIndex((c) => c.practice_id === selectedId)
        let next = idx
        if (e.key === 'j') next = Math.min(list.length - 1, idx + 1)
        if (e.key === 'k') next = Math.max(0, idx - 1)
        if (list[next]) select(list[next].practice_id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, selectedId, thread])

  async function markResolved() {
    if (!chatId) return
    await supabase.from('support_chats').update({ resolved_at: new Date().toISOString() }).eq('id', chatId)
    loadChats()
  }

  const liveThread = thread ? chat.messages.find((m) => m.id === thread.id) || thread : null
  const mainTyping = chat.typingUsers.filter((t) => t.scope === 'main')
  const threadTyping = liveThread ? chat.typingUsers.filter((t) => t.scope === String(liveThread.id)) : []

  return (
    <div className="flex h-[calc(100vh-8rem)] overflow-hidden rounded-xl border border-surface-700 bg-surface-900">
      {/* LEFT: inbox list */}
      <div className="flex w-[320px] shrink-0 flex-col border-r border-surface-700">
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="text-sm font-bold text-white">Client Chats</h2>
          {totalUnread > 0 && <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold !text-white">{totalUnread}</span>}
        </div>
        <div className="px-3">
          <div className="flex items-center gap-2 rounded-lg border border-surface-700 bg-surface-800 px-2.5 py-1.5">
            <Search className="h-4 w-4 text-slate-500" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search practices…  (⌘K)"
              className="w-full bg-transparent text-sm text-slate-200 placeholder-slate-500 focus:outline-none"
            />
          </div>
        </div>
        <div className="flex gap-1 px-3 py-2">
          {['all', 'unread', 'resolved'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize transition ${filter === f ? 'bg-primary !text-white' : 'text-slate-400 hover:bg-surface-800'}`}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-500" /></div>
          ) : list.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-slate-500">No chats here.</p>
          ) : (
            list.map((c) => {
              const unread = c.unread_count_admin > 0
              const online = c.last_message_at && now - new Date(c.last_message_at).getTime() < ONLINE_MS
              const active = c.practice_id === selectedId
              return (
                <button
                  key={c.id}
                  onClick={() => select(c.practice_id)}
                  className={`flex w-full items-center gap-2.5 border-l-2 px-3 py-2.5 text-left transition ${active ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-surface-800'}`}
                >
                  <span className="relative">
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-semibold !text-white ${avatarColor(practiceName(c))}`}>
                      {initials(practiceName(c))}
                    </span>
                    {online && <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface-900 bg-emerald-400" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className={`truncate text-sm ${unread ? 'font-bold text-white' : 'font-medium text-slate-200'}`}>{practiceName(c)}</span>
                      <span className="shrink-0 text-[11px] text-slate-500">{c.last_message_at ? shortRelative(c.last_message_at) : ''}</span>
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-slate-500">{(c.last_message_preview || 'No messages yet').slice(0, 40)}</span>
                      {unread && <span className="shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold !text-white">{c.unread_count_admin}</span>}
                    </span>
                  </span>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* RIGHT: conversation */}
      <div className="flex min-w-0 flex-1">
        {!selectedChat ? (
          <div className="flex flex-1 flex-col items-center justify-center text-center text-slate-500">
            <MessageSquareText className="h-8 w-8" />
            <p className="mt-2 text-sm">Select a practice to view their chat</p>
            <p className="mt-1 text-xs text-slate-600">J / K to move · ⌘K to search · Esc to deselect</p>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Header */}
            <div className="flex items-center justify-between gap-3 border-b border-surface-700 px-5 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className={`flex h-9 w-9 items-center justify-center rounded-lg text-xs font-semibold !text-white ${avatarColor(practiceName(selectedChat))}`}>
                  {initials(practiceName(selectedChat))}
                </span>
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-bold text-white">{practiceName(selectedChat)}</h2>
                  <p className="truncate text-xs text-slate-400">{doctorLine(selectedChat) || 'Practice'}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <PresenceBar users={chat.presence} />
                <Link to={`/admin/practices/${selectedChat.practice_id}`} className="flex items-center gap-1 text-xs text-primary-300 hover:underline">
                  View practice <ExternalLink className="h-3.5 w-3.5" />
                </Link>
                {!selectedChat.resolved_at && (
                  <button onClick={markResolved} className="flex items-center gap-1 rounded-lg border border-surface-700 px-2.5 py-1 text-xs text-slate-300 transition hover:bg-surface-800">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Mark resolved
                  </button>
                )}
              </div>
            </div>

            <div className="flex min-h-0 flex-1">
              <div className="flex min-w-0 flex-1 flex-col">
                {chat.loading ? (
                  <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-500" /></div>
                ) : (
                  <MessageList
                    messages={chat.messages}
                    reactions={chat.reactions}
                    myId={currentUser.id}
                    viewerType="caselift_team"
                    canModerate
                    typingUsers={mainTyping}
                    hasMore={chat.hasMore}
                    onLoadEarlier={chat.loadEarlier}
                    onReact={chat.toggleReaction}
                    onEdit={chat.editMessage}
                    onDelete={chat.deleteMessage}
                    onOpenThread={(m) => setThread(m)}
                  />
                )}
                <div className="flex items-center gap-1.5 px-5 pt-1 text-[11px] text-slate-500">
                  <Avatar name={currentUser.name} url={currentUser.avatar} team size="h-5 w-5" />
                  Replying as {currentUser.name}
                </div>
                <ChatComposer
                  placeholder={`Reply to ${practiceName(selectedChat)}…`}
                  onSend={(t) => chat.sendMessage(t)}
                  onTyping={() => chat.startTyping()}
                  onStopTyping={() => chat.stopTyping()}
                />
              </div>

              <AnimatePresence>
                {liveThread && (
                  <ThreadPanel
                    key={liveThread.id}
                    parent={liveThread}
                    messages={chat.messages}
                    reactions={chat.reactions}
                    myId={currentUser.id}
                    viewerType="caselift_team"
                    canModerate
                    typingUsers={threadTyping}
                    onClose={() => setThread(null)}
                    onReact={chat.toggleReaction}
                    onEdit={chat.editMessage}
                    onDelete={chat.deleteMessage}
                    onSendReply={(t) => chat.sendMessage(t, liveThread.id)}
                    onTyping={() => chat.startTyping(liveThread.id)}
                    onStopTyping={() => chat.stopTyping(liveThread.id)}
                  />
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
