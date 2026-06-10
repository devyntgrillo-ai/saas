import { useEffect, useMemo, useRef } from 'react'
import ChatMessage, { Avatar } from './ChatMessage'
import TypingIndicator from './TypingIndicator'
import { dayKey, dayLabel } from './chatUtil'

const GROUP_GAP_MS = 5 * 60 * 1000

// Renders the main message stream: date dividers, grouped consecutive messages,
// unread divider, thread counts, read receipts, smart auto-scroll, typing.
export default function MessageList({
  messages,
  reactions,
  myId,
  viewerType,
  canModerate = false,
  typingUsers = [],
  hasMore = false,
  reads = [],
  previousReadAt = null,
  mentionNames = [],
  onLoadEarlier,
  onReact,
  onEdit,
  onDelete,
  onOpenThread,
  onTogglePin,
}) {
  const scrollRef = useRef(null)
  const nearBottomRef = useRef(true)
  const lastCountRef = useRef(0)

  // Precompute render rows (dividers / grouping / thread counts) without mutating
  // closure state during the JSX map.
  const rows = useMemo(() => {
    const top = messages
      .filter((m) => !m.thread_parent_id)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    const out = []
    let lastDay = null
    let prev = null
    let unreadMarked = false
    const prevRead = previousReadAt ? new Date(previousReadAt) : null
    for (const m of top) {
      const dk = dayKey(m.created_at)
      const showDivider = dk !== lastDay
      lastDay = dk
      const sameSender = prev && prev.sender_type === m.sender_type && prev.sender_id === m.sender_id
      const closeInTime = prev && new Date(m.created_at) - new Date(prev.created_at) < GROUP_GAP_MS
      const showHeader = showDivider || !sameSender || !closeInTime
      prev = m
      let firstUnread = false
      if (!unreadMarked && prevRead && m.sender_id !== myId && new Date(m.created_at) > prevRead) {
        firstUnread = true
        unreadMarked = true
      }
      const replies = messages.filter((x) => x.thread_parent_id === m.id)
      out.push({
        m,
        showDivider,
        showHeader,
        firstUnread,
        replyCount: replies.length,
        lastReplyAt: replies.length ? replies[replies.length - 1].created_at : null,
      })
    }
    return out
  }, [messages, previousReadAt, myId])

  // "Seen by", other users whose last read is at/after the latest message.
  const lastMsg = rows.length ? rows[rows.length - 1].m : null
  const seenBy = lastMsg
    ? reads.filter((r) => r.user_id !== myId && new Date(r.last_read_at) >= new Date(lastMsg.created_at))
    : []

  function onScroll(e) {
    const el = e.currentTarget
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
  }

  // Smart auto-scroll: only follow new messages if the user is already at the bottom.
  useEffect(() => {
    const grew = rows.length > lastCountRef.current
    lastCountRef.current = rows.length
    if (grew && nearBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [rows.length, typingUsers.length])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [])

  return (
    <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto py-3">
      {hasMore && (
        <div className="flex justify-center pb-2">
          <button onClick={onLoadEarlier} className="rounded-full border border-surface-700 bg-surface-800 px-3 py-1 text-xs text-slate-300 transition hover:bg-surface-700">
            Load earlier messages
          </button>
        </div>
      )}

      {rows.map(({ m, showDivider, showHeader, firstUnread, replyCount, lastReplyAt }) => (
        <div key={m.id}>
          {showDivider && (
            <div className="my-3 flex items-center gap-3 px-4">
              <div className="h-px flex-1 bg-surface-700" />
              <span className="rounded-full border border-surface-700 bg-surface-900 px-3 py-0.5 text-[11px] font-medium text-slate-400">
                {dayLabel(m.created_at)}
              </span>
              <div className="h-px flex-1 bg-surface-700" />
            </div>
          )}
          {firstUnread && (
            <div className="my-2 flex items-center gap-3 px-4">
              <div className="h-px flex-1 bg-rose-500/40" />
              <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-semibold text-rose-300">New</span>
              <div className="h-px flex-1 bg-rose-500/40" />
            </div>
          )}
          <ChatMessage
            message={m}
            reactions={reactions}
            myId={myId}
            viewerType={viewerType}
            canModerate={canModerate}
            showHeader={showHeader}
            replyCount={replyCount}
            lastReplyAt={lastReplyAt}
            mentionNames={mentionNames}
            onReact={onReact}
            onReply={onOpenThread}
            onEdit={onEdit}
            onDelete={onDelete}
            onOpenThread={onOpenThread}
            onTogglePin={onTogglePin}
          />
        </div>
      ))}

      {seenBy.length > 0 && (
        <div className="flex items-center justify-end gap-1.5 px-4 pt-1.5 text-[11px] text-slate-500">
          <span>Seen by</span>
          <div className="flex -space-x-1">
            {seenBy.slice(0, 4).map((r) => (
              <div key={r.user_id} className="rounded ring-2 ring-surface-900" title={r.user_name}>
                <Avatar name={r.user_name} url={r.user_avatar} team={r.sender_type === 'caselift_team'} size="h-4 w-4" />
              </div>
            ))}
          </div>
          {seenBy.length > 4 && <span>+{seenBy.length - 4}</span>}
        </div>
      )}

      <div className="px-4 pt-1">
        <TypingIndicator users={typingUsers} />
      </div>
    </div>
  )
}
