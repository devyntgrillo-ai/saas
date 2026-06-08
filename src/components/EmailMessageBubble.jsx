import { useState } from 'react'
import {
  Bell,
  ChevronDown,
  CornerUpLeft,
  Mail,
  Maximize2,
  Minimize2,
  MoreVertical,
} from 'lucide-react'

function messageTime(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function cleanBody(text) {
  if (!text) return ''
  return String(text).replace(/\s*—\s*/g, ', ')
}

function bodyPreview(text, max = 96) {
  const flat = cleanBody(text).replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  return `${flat.slice(0, max).trim()}…`
}

function linkifyBody(text) {
  const parts = cleanBody(text).split(/(https?:\/\/[^\s]+)/g)
  return parts.map((part, i) => {
    if (/^https?:\/\//.test(part)) {
      return (
        <a key={i} href={part} target="_blank" rel="noreferrer" className="text-blue-600 underline hover:text-blue-700">
          {part}
        </a>
      )
    }
    return <span key={i}>{part}</span>
  })
}

/**
 * GoHighLevel-style email card for the Conversations thread.
 */
export default function EmailMessageBubble({
  inbound,
  subject,
  body,
  sentAt,
  senderName,
  senderEmail,
  recipientEmail,
  avatarClass,
  senderInitials,
  onReply,
}) {
  const [expanded, setExpanded] = useState(false)
  const displaySubject = cleanBody(subject) || '(No subject)'
  const preview = bodyPreview(body)

  return (
    <article
      className={`max-w-2xl overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm ${inbound ? '' : 'ml-auto'}`}
    >
      {/* Card header */}
      <div className="flex items-center gap-2 border-b border-gray-200 bg-gray-100 px-3 py-2.5">
        <Bell className="h-4 w-4 shrink-0 text-amber-500" />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-800">{displaySubject}</p>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? 'Collapse' : 'Expand'}
          aria-label={expanded ? 'Collapse email' : 'Expand email'}
          className="shrink-0 rounded p-1 text-gray-400 transition hover:bg-gray-200/80 hover:text-gray-600"
        >
          {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
      </div>

      {/* Sender row */}
      <div className="flex items-start gap-3 border-b border-gray-100 px-3 py-3">
        <div className="relative shrink-0">
          <div className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold text-white ${avatarClass}`}>
            {senderInitials}
          </div>
          <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 ring-2 ring-white">
            <Mail className="h-2.5 w-2.5 text-white" strokeWidth={2.5} />
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gray-900">{senderName}</p>
              {expanded && recipientEmail && (
                <p className="mt-0.5 flex items-center gap-1 text-xs text-gray-500">
                  <span>To:</span>
                  <span className="truncate">{recipientEmail}</span>
                  <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
                </p>
              )}
              {!expanded && preview && (
                <p className="mt-0.5 line-clamp-1 text-sm text-gray-500">{preview}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <span className="text-xs text-gray-400">{messageTime(sentAt)}</span>
              {onReply && (
                <button
                  type="button"
                  onClick={() => onReply({ subject: displaySubject, body })}
                  title="Reply"
                  aria-label="Reply"
                  className="rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                >
                  <CornerUpLeft className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                title="More"
                aria-label="More options"
                className="rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div className="px-4 py-4">
          {senderEmail && (
            <p className="mb-3 text-xs text-gray-500">
              <span className="font-medium text-gray-600">From:</span> {senderEmail}
            </p>
          )}
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
            {linkifyBody(body)}
          </div>
          {onReply && (
            <button
              type="button"
              onClick={() => onReply({ subject: displaySubject, body })}
              className="mt-4 inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              <CornerUpLeft className="h-4 w-4" />
              Reply
            </button>
          )}
        </div>
      )}
    </article>
  )
}
