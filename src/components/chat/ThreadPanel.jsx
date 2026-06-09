import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { X, Send } from 'lucide-react'
import ChatMessage from './ChatMessage'
import TypingIndicator from './TypingIndicator'

// Right-hand thread panel. Reuses the parent's message/reaction state; replies
// are messages whose thread_parent_id === parent.id.
export default function ThreadPanel({
  parent,
  messages,
  reactions,
  myId,
  viewerType,
  canModerate,
  typingUsers = [],
  mentionNames = [],
  onClose,
  onReact,
  onEdit,
  onDelete,
  onSendReply,
  onTyping,
  onStopTyping,
}) {
  const [text, setText] = useState('')
  const endRef = useRef(null)
  const replies = messages
    .filter((m) => m.thread_parent_id === parent.id)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [replies.length])

  async function send() {
    const v = text.trim()
    if (!v) return
    setText('')
    onStopTyping?.()
    try {
      await onSendReply?.(v)
    } catch {
      setText(v) // restore on failure so the reply isn't lost
    }
  }

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'tween', duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
      className="absolute right-0 top-0 z-20 flex h-full w-full max-w-[420px] flex-col border-l border-surface-700 bg-surface-900 shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-surface-700 px-4 py-3">
        <h3 className="text-sm font-semibold text-white">Thread</h3>
        <button onClick={onClose} className="rounded-md p-1.5 text-slate-400 transition hover:bg-surface-800 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-3">
        {/* Parent (slightly muted) */}
        <div className="opacity-90">
          <ChatMessage
            message={parent}
            reactions={reactions}
            myId={myId}
            viewerType={viewerType}
            canModerate={canModerate}
            inThread
            mentionNames={mentionNames}
            onReact={onReact}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </div>

        <div className="my-2 flex items-center gap-3 px-4">
          <span className="text-xs font-medium text-slate-500">{replies.length} {replies.length === 1 ? 'reply' : 'replies'}</span>
          <div className="h-px flex-1 bg-surface-700" />
        </div>

        {replies.map((m) => (
          <ChatMessage
            key={m.id}
            message={m}
            reactions={reactions}
            myId={myId}
            viewerType={viewerType}
            canModerate={canModerate}
            inThread
            mentionNames={mentionNames}
            onReact={onReact}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
        <div ref={endRef} />
      </div>

      <div className="border-t border-surface-700 p-3">
        <TypingIndicator users={typingUsers} />
        <div className="flex items-end gap-2 rounded-xl border border-surface-700 bg-surface-800 px-3 py-2 focus-within:border-primary">
          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); onTyping?.() }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            rows={1}
            placeholder="Reply in thread…"
            className="max-h-32 min-h-[24px] flex-1 resize-none bg-transparent text-sm text-slate-200 placeholder-slate-500 focus:outline-none"
          />
          <button onClick={send} disabled={!text.trim()} className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary !text-white transition enabled:hover:bg-primary-700 disabled:opacity-40">
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </motion.div>
  )
}
