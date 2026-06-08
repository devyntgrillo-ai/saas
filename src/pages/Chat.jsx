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
import { isCoachingOnline } from '../components/chat/chatUtil'

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Channel header */}
      <div className="flex items-center gap-3 border-b border-surface-700 px-5 py-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-sm font-bold !text-white">C</span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-bold text-white">Private 7-Figure Coaching Channel</h1>
            {online ? (
              <span className="flex items-center gap-1 text-[11px] text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Online
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[11px] text-slate-500">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-500" /> Offline
              </span>
            )}
          </div>
          <p className="truncate text-xs text-slate-400">
            {online
              ? 'Your direct line to the coaching team. Ask us anything.'
              : "We're offline right now — but feel free to send a message and we'll reply soon."}
          </p>
        </div>
        <div className="ml-auto shrink-0">
          <PresenceBar users={chat.presence} />
        </div>
      </div>

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
              onLoadEarlier={chat.loadEarlier}
              onReact={chat.toggleReaction}
              onEdit={chat.editMessage}
              onDelete={chat.deleteMessage}
              onOpenThread={(m) => setThread(m)}
            />
          )}

          {!loadingChat && (
            <ChatComposer
              placeholder="Message CaseLift Team…"
              onSend={(t) => chat.sendMessage(t)}
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
