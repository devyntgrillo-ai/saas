import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { useSupportChat } from '../hooks/useSupportChat'
import MessageList from '../components/chat/MessageList'
import ChatComposer from '../components/chat/ChatComposer'
import ThreadPanel from '../components/chat/ThreadPanel'
import PresenceBar from '../components/chat/PresenceBar'
import ChatSearch from '../components/chat/ChatSearch'
import PinnedBar from '../components/chat/PinnedBar'
import { isCoachingOnline } from '../components/chat/chatUtil'

function jumpToMessage(id) {
  const el = document.getElementById(`msg-${id}`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('ring-2', 'ring-primary/50')
  setTimeout(() => el.classList.remove('ring-2', 'ring-primary/50'), 1600)
}

const STARTERS = [
  'Help me review a consult',
  'How do I handle a price objection?',
  'What should my first sequence say?',
]

export default function Chat() {
  const { practiceId, user, profile } = useAuth()
  const [chatId, setChatId] = useState(null)
  const [loadingChat, setLoadingChat] = useState(true)
  const [thread, setThread] = useState(null)
  const [members, setMembers] = useState([])
  const [, setTick] = useState(0) // minute ticker so the online/offline status flips on time

  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), 60000)
    return () => clearInterval(iv)
  }, [])
  const online = isCoachingOnline()

  const currentUser = useMemo(
    () => ({
      id: user?.id,
      name: profile?.display_name || user?.user_metadata?.full_name || user?.email || 'You',
      avatar: profile?.avatar_url || user?.user_metadata?.avatar_url || null,
    }),
    [user, profile],
  )

  // Resolve (or lazily create) this practice's channel.
  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!practiceId) return
      setLoadingChat(true)
      let { data } = await supabase.from('support_chats').select('id').eq('practice_id', practiceId).maybeSingle()
      if (!data) {
        const ins = await supabase.from('support_chats').insert({ practice_id: practiceId }).select('id').maybeSingle()
        data = ins.data
      }
      if (!cancelled) { setChatId(data?.id || null); setLoadingChat(false) }
    }
    load()
    return () => { cancelled = true }
  }, [practiceId])

  // Practice member roster → mentionable names.
  useEffect(() => {
    if (!practiceId) return
    supabase.from('users').select('display_name, email').eq('practice_id', practiceId)
      .then(({ data }) => setMembers(data || []))
  }, [practiceId])

  const chat = useSupportChat({ chatId, practiceId, senderType: 'practice', currentUser })

  // Mark read whenever the channel updates while open.
  useEffect(() => {
    if (chatId && !chat.loading) chat.markAsRead()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, chat.loading, chat.messages.length])

  const liveThread = thread ? chat.messages.find((m) => m.id === thread.id) || thread : null
  const mainTyping = chat.typingUsers.filter((t) => t.scope === 'main')
  const threadTyping = liveThread ? chat.typingUsers.filter((t) => t.scope === String(liveThread.id)) : []
  const isEmpty = !chat.loading && chat.messages.length === 0

  // Mentionable names: the practice roster + coaching team + anyone present/posted.
  const mentionNames = useMemo(() => {
    const set = new Set(['CaseLift Team'])
    members.forEach((m) => set.add(m.display_name || m.email))
    chat.presence.forEach((u) => u.name && set.add(u.name))
    chat.messages.forEach((m) => m.sender_name && set.add(m.sender_name))
    if (currentUser.name) set.add(currentUser.name)
    return [...set].filter(Boolean)
  }, [members, chat.presence, chat.messages, currentUser])

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Channel header (Slack-style # channel + icon row) */}
      <div className="border-b border-surface-700 px-4 py-2">
        <div className="flex items-center gap-2">
          <h1 className="flex items-center gap-1 text-[15px] font-bold text-white">
            <span className="text-slate-500">#</span> Private 1-on-1 Coaching Channel
          </h1>
          {online ? (
            <span className="flex items-center gap-1 text-[11px] text-emerald-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Online</span>
          ) : (
            <span className="flex items-center gap-1 text-[11px] text-slate-500"><span className="h-1.5 w-1.5 rounded-full bg-slate-500" /> Offline</span>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <PresenceBar users={chat.presence} />
            <ChatSearch chatId={chatId} onJump={jumpToMessage} />
          </div>
        </div>
        <p className="mt-0.5 truncate text-xs text-slate-400">
          {online
            ? 'Your private 7-figure coaching channel — ask us anything.'
            : "We're offline right now — send a message and we'll reply soon."}
        </p>
      </div>

      <PinnedBar pins={chat.pins} onJump={jumpToMessage} onUnpin={chat.togglePin} />

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col">
          {loadingChat || chat.loading ? (
            <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-500" /></div>
          ) : isEmpty ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
              <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-xl font-bold !text-white">C</span>
              <h2 className="text-lg font-bold text-white">Welcome to CaseLift Chat</h2>
              <p className="mt-2 max-w-md text-sm text-slate-400">
                This is your direct line to our team. Ask anything — consult reviews, objection coaching, sequence strategy, or anything else.
              </p>
              <p className="mt-1 text-xs text-slate-500">We typically respond within a few hours.</p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {STARTERS.map((s) => (
                  <button key={s} onClick={() => chat.sendMessage(s)} className="rounded-full border border-surface-700 bg-surface-800 px-3.5 py-1.5 text-sm text-slate-200 transition hover:border-primary hover:text-white">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <MessageList
              messages={chat.messages}
              reactions={chat.reactions}
              myId={currentUser.id}
              viewerType="practice"
              typingUsers={mainTyping}
              hasMore={chat.hasMore}
              reads={chat.reads}
              previousReadAt={chat.previousReadAt}
              mentionNames={mentionNames}
              onLoadEarlier={chat.loadEarlier}
              onReact={chat.toggleReaction}
              onEdit={chat.editMessage}
              onDelete={chat.deleteMessage}
              onOpenThread={(m) => setThread(m)}
              onTogglePin={chat.togglePin}
            />
          )}

          {!loadingChat && (
            <ChatComposer
              placeholder="Message your coaching channel…"
              mentionables={mentionNames}
              onSend={(t, f, meta) => chat.sendMessage(t, null, f, meta)}
              onTyping={() => chat.startTyping()}
              onStopTyping={() => chat.stopTyping()}
            />
          )}
        </div>

        <AnimatePresence>
          {liveThread && (
            <ThreadPanel
              key={liveThread.id}
              parent={liveThread}
              messages={chat.messages}
              reactions={chat.reactions}
              myId={currentUser.id}
              viewerType="practice"
              typingUsers={threadTyping}
              mentionNames={mentionNames}
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
  )
}
