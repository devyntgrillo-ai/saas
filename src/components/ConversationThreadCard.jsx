import { useState } from 'react'
import {
  Bell,
  ChevronDown,
  CornerUpLeft,
  Mail,
  Maximize2,
  MessageSquare,
  Minimize2,
  MoreVertical,
} from 'lucide-react'
import { displayEmailSubject } from '../lib/conversationThread'
import ConvAttachment from './ConvAttachment'

function messageTime(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function messageDateLabel(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000)
  if (diffDays === 0) return messageTime(ts)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function cleanBody(text) {
  if (!text) return ''
  return String(text).replace(/\s*, \s*/g, ', ')
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

function resolveSender(message, channel, { activeConv, practice, user, tcName, avatarColor, emailInitials, initials }) {
  const inbound = message.direction === 'inbound'
  const seed = inbound
    ? (channel === 'email'
      ? (activeConv.patient_email || `${activeConv.patient_first || ''}${activeConv.patient_last || ''}`)
      : `${activeConv.patient_first || ''}${activeConv.patient_last || ''}`)
    : `${practice?.name || tcName}`
  const senderName = inbound
    ? (`${activeConv.patient_first || ''} ${activeConv.patient_last || ''}`.trim() || activeConv.patient_email || 'Patient')
    : (practice?.name || tcName)
  const senderEmail = channel === 'email'
    ? (inbound ? activeConv.patient_email : (practice?.email || user?.email))
    : null
  const recipientEmail = channel === 'email'
    ? (inbound ? (practice?.email || user?.email) : activeConv.patient_email)
    : null
  const senderInitials = inbound
    ? (channel === 'email' && activeConv.patient_email
      ? emailInitials(activeConv.patient_email)
      : initials(activeConv.patient_first, activeConv.patient_last))
    : emailInitials(practice?.email || user?.email || tcName)

  return {
    inbound,
    senderName,
    senderEmail,
    recipientEmail,
    avatarClass: avatarColor(seed),
    senderInitials,
  }
}

function ThreadMessageRow({
  message,
  channel,
  expanded,
  onToggleExpand,
  onReply,
  subject,
  sender,
  showBorder = false,
}) {
  const ts = message.sent_at || message.created_at
  const preview = bodyPreview(message.body)
  const outbound = message.direction === 'outbound'
  const ChannelIcon = channel === 'email' ? Mail : MessageSquare
  const badgeClass = channel === 'email' ? 'bg-blue-600' : 'bg-emerald-600'

  return (
    <div className={showBorder ? 'border-b border-gray-100' : ''}>
      <div
        className="flex cursor-pointer items-start gap-3 px-3 py-3 transition hover:bg-gray-50/80"
        onClick={onToggleExpand}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggleExpand()
          }
        }}
        role="button"
        tabIndex={0}
      >
        <div className="relative shrink-0">
          <div className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold text-white ${sender.avatarClass}`}>
            {sender.senderInitials}
          </div>
          <span className={`absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full ring-2 ring-white ${badgeClass}`}>
            <ChannelIcon className="h-2.5 w-2.5 text-white" strokeWidth={2.5} />
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gray-900">{sender.senderName}</p>
              {channel === 'email' && expanded && sender.recipientEmail && (
                <p className="mt-0.5 flex items-center gap-1 text-xs text-gray-500">
                  <span>To:</span>
                  <span className="truncate">{sender.recipientEmail}</span>
                  <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
                </p>
              )}
              {!expanded && preview && (
                <p className="mt-0.5 line-clamp-1 text-sm text-gray-500">{preview}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <span className="text-xs text-gray-400">{messageDateLabel(ts)}</span>
              {channel === 'email' && onReply && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onReply({ subject, body: message.body })
                  }}
                  title="Reply"
                  aria-label="Reply"
                  className="rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                >
                  <CornerUpLeft className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleExpand()
                }}
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

      {expanded && (
        <div className="border-t border-gray-100 px-4 py-4">
          {channel === 'email' && sender.senderEmail && (
            <p className="mb-3 text-xs text-gray-500">
              <span className="font-medium text-gray-600">From:</span> {sender.senderEmail}
            </p>
          )}
          {message.meta?.attachment ? (
            <ConvAttachment attachment={message.meta.attachment} outbound={outbound} radius="rounded-xl" />
          ) : (
            <div className={`whitespace-pre-wrap text-sm leading-relaxed ${channel === 'sms' ? 'rounded-xl bg-gray-50 px-3 py-2 text-gray-800' : 'text-gray-800'}`}>
              {linkifyBody(message.body)}
            </div>
          )}
          {message.meta?.attachment && channel === 'sms' && (
            <p className="mt-2 text-[10px] text-gray-400">(MMS — carrier charges may apply)</p>
          )}
          {channel === 'email' && onReply && (
            <button
              type="button"
              onClick={() => onReply({ subject, body: message.body })}
              className="mt-4 inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              <CornerUpLeft className="h-4 w-4" />
              Reply
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Consolidated email or SMS thread. Parent aligns left (patient started) or right (practice started).
 */
export default function ConversationThreadCard({
  channel,
  messages,
  activeConv,
  practice,
  user,
  tcName,
  avatarColor,
  emailInitials,
  initials,
  onReply,
}) {
  const [showEarlier, setShowEarlier] = useState(false)
  const [expandedIds, setExpandedIds] = useState(() => new Set())

  if (!messages?.length) return null

  const isEmail = channel === 'email'
  const headerTitle = isEmail
    ? displayEmailSubject(messages[0].meta?.subject || messages[0].subject)
    : messages.length === 1
      ? 'Text message'
      : `Text conversation (${messages.length})`
  const HeaderIcon = isEmail ? Bell : MessageSquare
  const subject = isEmail ? headerTitle : null

  const earlier = messages.slice(0, -1)
  const latest = messages[messages.length - 1]
  const hasEarlier = earlier.length > 0
  const anyExpanded = messages.some((m) => expandedIds.has(m.id))

  function toggleMessage(id) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleThreadExpand() {
    if (anyExpanded) {
      setExpandedIds(new Set())
      return
    }
    setExpandedIds(new Set([latest.id]))
  }

  const context = { activeConv, practice, user, tcName, avatarColor, emailInitials, initials }

  return (
    <article className="w-full max-w-md overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-gray-200 bg-gray-100 px-3 py-2.5">
        <HeaderIcon className={`h-4 w-4 shrink-0 ${isEmail ? 'text-amber-500' : 'text-emerald-600'}`} />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-800">{headerTitle}</p>
        <button
          type="button"
          onClick={toggleThreadExpand}
          title={anyExpanded ? 'Collapse thread' : 'Expand latest'}
          aria-label={anyExpanded ? 'Collapse thread' : 'Expand latest'}
          className="shrink-0 rounded p-1 text-gray-400 transition hover:bg-gray-200/80 hover:text-gray-600"
        >
          {anyExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
        <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
      </div>

      {hasEarlier && !showEarlier && (
        <div className="flex items-center px-3 py-2">
          <div className="h-px flex-1 bg-gray-200" />
          <button
            type="button"
            onClick={() => setShowEarlier(true)}
            className="mx-3 shrink-0 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-600 transition hover:border-gray-300 hover:bg-gray-50"
          >
            + {earlier.length} {earlier.length === 1 ? 'message' : 'messages'} earlier
          </button>
          <div className="h-px flex-1 bg-gray-200" />
        </div>
      )}

      {hasEarlier && showEarlier && (
        <div className="border-b border-gray-100">
          {earlier.map((m) => (
            <ThreadMessageRow
              key={m.id}
              message={m}
              channel={channel}
              expanded={expandedIds.has(m.id)}
              onToggleExpand={() => toggleMessage(m.id)}
              onReply={isEmail ? onReply : undefined}
              subject={subject}
              sender={resolveSender(m, channel, context)}
              showBorder
            />
          ))}
          <div className="flex justify-center border-t border-gray-100 px-3 py-1.5">
            <button
              type="button"
              onClick={() => setShowEarlier(false)}
              className="text-xs font-medium text-gray-500 transition hover:text-gray-700"
            >
              Hide earlier messages
            </button>
          </div>
        </div>
      )}

      <ThreadMessageRow
        message={latest}
        channel={channel}
        expanded={expandedIds.has(latest.id)}
        onToggleExpand={() => toggleMessage(latest.id)}
        onReply={isEmail ? onReply : undefined}
        subject={subject}
        sender={resolveSender(latest, channel, context)}
      />
    </article>
  )
}
