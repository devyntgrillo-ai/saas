import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Smile, MessageSquare, Pencil, Trash2, X, Check, Paperclip, Pin } from 'lucide-react'
import EmojiPicker from './EmojiPicker'
import LinkPreview from './LinkPreview'
import AudioClip from './AudioClip'
import { groupReactions } from '../../hooks/useSupportChat'
import { initials, avatarColor, timeLabel, shortRelative } from './chatUtil'
import { renderRich, firstUrl } from './richtext'

// One avatar for everyone: a real profile photo when we have one, otherwise
// deterministic colored initials. Coaches (team) get the brand-accent circle.
export function Avatar({ name, url, team, size = 'h-9 w-9' }) {
  if (url) {
    return <img src={url} alt={name || ''} className={`${size} shrink-0 rounded-lg object-cover`} />
  }
  return (
    <span className={`${size} flex shrink-0 items-center justify-center rounded-lg text-xs font-semibold !text-white ${team ? 'bg-primary' : avatarColor(name)}`}>
      {initials(name)}
    </span>
  )
}

function reactionTitle(g) {
  if (g.mine && g.count === 1) return 'You reacted'
  if (g.mine) return `You and ${g.count - 1} other${g.count - 1 > 1 ? 's' : ''}`
  return `${g.count} ${g.count > 1 ? 'people' : 'person'} reacted`
}

export default function ChatMessage({
  message,
  reactions,
  myId,
  viewerType, // 'practice' | 'caselift_team' (the current user's side)
  canModerate = false,
  showHeader = true,
  replyCount = 0,
  lastReplyAt = null,
  inThread = false,
  mentionNames = [],
  onReact,
  onReply,
  onEdit,
  onDelete,
  onOpenThread,
  onTogglePin,
}) {
  const [showPicker, setShowPicker] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.message || '')

  const isTeam = message.sender_type === 'caselift_team'
  const mine = message.sender_id && message.sender_id === myId
  const rightAlign = viewerType === 'caselift_team' && isTeam
  const deleted = Boolean(message.deleted_at)
  const groups = groupReactions(reactions, message.id, myId)
  const canEdit = mine && !deleted
  const canDelete = (mine || canModerate) && !deleted

  async function saveEdit() {
    const v = draft.trim()
    if (v && v !== message.message) await onEdit?.(message.id, v)
    setEditing(false)
  }

  return (
    <div id={`msg-${message.id}`} className={`group relative flex scroll-mt-4 gap-2.5 px-4 py-1 hover:bg-surface-800/40 ${showHeader ? 'mt-2.5' : ''} ${message.pinned_at ? 'bg-amber-500/[0.06]' : ''} ${rightAlign ? 'flex-row-reverse' : ''}`}>
      {/* Avatar column (kept for spacing when grouped). Grouped rows show the
          timestamp here on hover, Slack-style. */}
      <div className="flex w-9 shrink-0 justify-center">
        {showHeader ? (
          <Avatar name={message.sender_name} url={message.sender_avatar} team={isTeam} />
        ) : (
          <span className="mt-1 select-none text-[10px] leading-none text-slate-500 opacity-0 transition group-hover:opacity-100">
            {timeLabel(message.created_at).replace(/\s?[AP]M$/i, '')}
          </span>
        )}
      </div>

      <div className={`min-w-0 flex-1 ${rightAlign ? 'flex flex-col items-end' : ''}`}>
        {showHeader && (
          <div className={`flex items-baseline gap-2 ${rightAlign ? 'flex-row-reverse' : ''}`}>
            <span className={`text-[13px] font-bold ${isTeam ? 'text-primary-300' : 'text-white'}`}>
              {message.sender_name}
            </span>
            {isTeam && (
              <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-300">
                Coach
              </span>
            )}
            <span className="text-[11px] text-slate-500">{timeLabel(message.created_at)}</span>
          </div>
        )}

        {/* Message body */}
        <div className={`mt-0.5 max-w-[680px] ${isTeam && !rightAlign ? 'border-l-2 border-primary/40 pl-2.5' : ''}`}>
          {message.pinned_at && !deleted && (
            <span className="mb-0.5 flex items-center gap-1 text-[10px] font-medium text-amber-400/80">
              <Pin className="h-3 w-3" /> Pinned
            </span>
          )}
          {deleted ? (
            <p className="text-sm italic text-slate-500">This message was deleted</p>
          ) : editing ? (
            <div className="w-full">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit() }
                  if (e.key === 'Escape') setEditing(false)
                }}
                autoFocus
                className="input min-h-[64px] w-full resize-y text-sm"
              />
              <div className="mt-1.5 flex gap-2">
                <button onClick={() => setEditing(false)} className="btn-ghost text-xs"><X className="h-3.5 w-3.5" /> Cancel</button>
                <button onClick={saveEdit} className="btn-primary text-xs"><Check className="h-3.5 w-3.5" /> Save</button>
              </div>
            </div>
          ) : (
            <>
              {message.message && (
                <p className={`whitespace-pre-wrap break-words text-[15px] leading-[1.5] text-slate-200 ${rightAlign ? 'rounded-2xl rounded-tr-sm bg-primary/15 px-3 py-2' : ''}`}>
                  {renderRich(message.message, mentionNames)}
                  {message.edited_at && <span className="ml-1.5 text-[11px] text-slate-500">(edited)</span>}
                </p>
              )}
              {message.message && firstUrl(message.message) && <LinkPreview url={firstUrl(message.message)} />}
              {message.attachment_url && message.attachment_type?.startsWith('audio/') && (
                <AudioClip url={message.attachment_url} durationSec={message.audio_duration} transcript={message.audio_transcript} seed={message.id} />
              )}
              {message.attachment_url && !message.attachment_type?.startsWith('audio/') && (
                message.attachment_type?.startsWith('image/') ? (
                  <a href={message.attachment_url} target="_blank" rel="noreferrer" className="mt-1 block w-fit">
                    <img src={message.attachment_url} alt={message.attachment_name || ''} className="max-h-72 max-w-xs rounded-lg border border-surface-700 object-cover" />
                  </a>
                ) : (
                  <a href={message.attachment_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-2 rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-sm text-slate-200 transition hover:border-surface-600">
                    <Paperclip className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="max-w-[220px] truncate">{message.attachment_name || 'Attachment'}</span>
                  </a>
                )
              )}
            </>
          )}
        </div>

        {/* Reactions bar */}
        {groups.length > 0 && !deleted && (
          <div className={`mt-1 flex flex-wrap gap-1 ${rightAlign ? 'justify-end' : ''}`}>
            <AnimatePresence>
              {groups.map((g) => (
                <motion.button
                  key={g.emoji}
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.5, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                  title={reactionTitle(g)}
                  onClick={() => onReact?.(message.id, g.emoji)}
                  className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition ${
                    g.mine
                      ? 'border-[color:var(--accent-border)] bg-[color:var(--accent-subtle)] text-[color:var(--accent)]'
                      : 'border-[color:var(--border)] bg-[color:var(--bg-elevated)] text-[color:var(--text-secondary)] hover:border-[color:var(--border-strong)]'
                  }`}
                >
                  <span className="text-sm leading-none">{g.emoji}</span>
                  <span className="font-medium tabular-nums">{g.count}</span>
                </motion.button>
              ))}
            </AnimatePresence>
          </div>
        )}

        {/* Thread indicator */}
        {!inThread && replyCount > 0 && (
          <button
            onClick={() => onOpenThread?.(message)}
            className={`mt-1 flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium text-primary-300 transition hover:bg-surface-800 ${rightAlign ? 'self-end' : 'self-start'}`}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            {replyCount} {replyCount > 1 ? 'replies' : 'reply'}
            {lastReplyAt && <span className="font-normal text-slate-500">· Last reply {shortRelative(lastReplyAt)} ago</span>}
          </button>
        )}
      </div>

      {/* Hover action bar */}
      {!deleted && !editing && (
        <div className={`absolute -top-3 z-10 flex items-center gap-0.5 rounded-lg border border-surface-700 bg-surface-900 p-0.5 opacity-0 shadow-lg transition group-hover:opacity-100 ${rightAlign ? 'left-4' : 'right-4'}`}>
          <div className="relative">
            <button onClick={() => setShowPicker((v) => !v)} className="flex h-7 w-7 items-center justify-center rounded text-slate-400 transition hover:bg-surface-800 hover:text-white" title="Add reaction">
              <Smile className="h-4 w-4" />
            </button>
            {showPicker && (
              <EmojiPicker
                align={rightAlign ? 'left' : 'right'}
                onSelect={(emoji) => onReact?.(message.id, emoji)}
                onClose={() => setShowPicker(false)}
              />
            )}
          </div>
          {!inThread && (
            <button onClick={() => onReply?.(message)} className="flex h-7 w-7 items-center justify-center rounded text-slate-400 transition hover:bg-surface-800 hover:text-white" title="Reply in thread">
              <MessageSquare className="h-4 w-4" />
            </button>
          )}
          {onTogglePin && (
            <button onClick={() => onTogglePin(message.id)} className={`flex h-7 w-7 items-center justify-center rounded transition hover:bg-surface-800 ${message.pinned_at ? 'text-amber-400' : 'text-slate-400 hover:text-white'}`} title={message.pinned_at ? 'Unpin' : 'Pin message'}>
              <Pin className="h-4 w-4" />
            </button>
          )}
          {canEdit && (
            <button onClick={() => { setDraft(message.message || ''); setEditing(true) }} className="flex h-7 w-7 items-center justify-center rounded text-slate-400 transition hover:bg-surface-800 hover:text-white" title="Edit">
              <Pencil className="h-4 w-4" />
            </button>
          )}
          {canDelete && (
            <button onClick={() => onDelete?.(message.id)} className="flex h-7 w-7 items-center justify-center rounded text-slate-400 transition hover:bg-surface-800 hover:text-rose-400" title="Delete">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
