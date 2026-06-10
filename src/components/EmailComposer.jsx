import { useState } from 'react'
import {
  Bold,
  ChevronDown,
  FileText,
  Image,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Mail,
  Maximize2,
  Minimize2,
  Paperclip,
  Send,
  Smile,
  Sparkles,
  Trash2,
  Type,
  Video,
  X,
  Zap,
} from 'lucide-react'
import ChannelToggle from './ChannelToggle'

// Wrap/insert markdown around the textarea's current selection. The email send
// path (mailgun-send) renders this markdown to HTML, so bold/italic/lists show
// up formatted in the delivered email.
function applyMarkdown(textareaRef, draft, onDraftChange, kind) {
  const el = textareaRef?.current
  const start = el?.selectionStart ?? draft.length
  const end = el?.selectionEnd ?? draft.length
  const selected = draft.slice(start, end)
  const before = draft.slice(0, start)
  const after = draft.slice(end)
  const atLineStart = !before || before.endsWith('\n')
  let insert
  if (kind === 'bold') insert = `**${selected || 'bold text'}**`
  else if (kind === 'italic') insert = `_${selected || 'italic text'}_`
  else if (kind === 'bullet') {
    const lines = (selected || 'List item').split('\n').map((l) => (l.trim() ? `- ${l.replace(/^[-\d.]+\s*/, '')}` : l))
    insert = `${atLineStart ? '' : '\n'}${lines.join('\n')}`
  } else if (kind === 'number') {
    const lines = (selected || 'List item').split('\n').map((l, i) => (l.trim() ? `${i + 1}. ${l.replace(/^[-\d.]+\s*/, '')}` : l))
    insert = `${atLineStart ? '' : '\n'}${lines.join('\n')}`
  } else return
  const next = before + insert + after
  onDraftChange(next)
  // Re-focus and place the cursor at the end of the inserted text.
  requestAnimationFrame(() => {
    if (!el) return
    el.focus()
    const pos = (before + insert).length
    try { el.setSelectionRange(pos, pos) } catch { /* noop */ }
  })
}

function ToolbarIcon({ title, onClick, disabled, active, children }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={`rounded p-1.5 transition hover:bg-gray-200/80 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40 ${active ? 'bg-gray-200/80 text-gray-700' : 'text-gray-500'}`}
    >
      {children}
    </button>
  )
}

/**
 * GoHighLevel-style email composer for the Conversations thread (no From/To rows).
 */
export default function EmailComposer({
  draft,
  onDraftChange,
  emailSubject,
  onEmailSubjectChange,
  textareaRef,
  onSubmit,
  sending,
  suggesting,
  aiSuggested,
  onSuggestReply,
  onDiscard,
  onSwitchChannel,
  expanded,
  onToggleExpanded,
  channelMenuOpen,
  onChannelMenuOpenChange,
  emojiOpen,
  onEmojiOpenChange,
  snippetsOpen,
  onSnippetsOpenChange,
  quickEmojis,
  snippets,
  onInsertEmoji,
  onFillSnippet,
  onAttachClick,
  uploading,
  missingPatientEmail,
  patientFirst,
  practiceDoctor,
}) {
  const [formatOpen, setFormatOpen] = useState(false)
  const fmt = (kind) => { applyMarkdown(textareaRef, draft, onDraftChange, kind); setFormatOpen(false) }
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      {/* Tab bar */}
      <div className="flex items-center justify-between border-b border-gray-200 px-2 py-1.5">
        <ChannelToggle channel="email" onSwitch={onSwitchChannel} />
        <div className="flex items-center gap-0.5 text-gray-400">
          <button
            type="button"
            title={expanded ? 'Collapse composer' : 'Expand composer'}
            aria-label={expanded ? 'Collapse composer' : 'Expand composer'}
            onClick={onToggleExpanded}
            className="rounded p-1.5 transition hover:bg-gray-100 hover:text-gray-600"
          >
            {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {aiSuggested && draft.trim() && (
        <div className="flex items-center gap-1.5 border-b border-gray-100 bg-blue-50/50 px-4 py-1.5 text-[11px] font-medium text-blue-600">
          <Sparkles className="h-3 w-3" /> CaseLift recommended
        </div>
      )}

      {missingPatientEmail && (
        <p className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          Add a patient email on this conversation before sending.
        </p>
      )}

      {/* Subject */}
      <input
        type="text"
        value={emailSubject}
        onChange={(e) => onEmailSubjectChange(e.target.value)}
        placeholder="Subject: Enter subject"
        className="w-full border-0 border-b border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-0"
      />

      {/* Body */}
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        rows={expanded ? 14 : 8}
        placeholder="Type a message"
        className={`w-full resize-none border-0 bg-white px-4 py-3 text-sm leading-relaxed text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0 ${expanded ? 'min-h-[280px]' : 'min-h-[160px]'}`}
      />

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 border-t border-gray-200 bg-gray-50 px-2 py-1.5">
        <div className="relative flex flex-wrap items-center gap-0.5">
          <div className="relative">
            <ToolbarIcon
              title="Formatting"
              active={formatOpen}
              onClick={() => { setFormatOpen((v) => !v); onEmojiOpenChange(false); onSnippetsOpenChange(false) }}
            >
              <Type className="h-4 w-4" />
            </ToolbarIcon>
            {formatOpen && (
              <div className="absolute bottom-full left-0 z-20 mb-2 flex items-center gap-0.5 rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => fmt('bold')} title="Bold" className="rounded p-1.5 text-gray-600 transition hover:bg-gray-100"><Bold className="h-4 w-4" /></button>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => fmt('italic')} title="Italic" className="rounded p-1.5 text-gray-600 transition hover:bg-gray-100"><Italic className="h-4 w-4" /></button>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => fmt('bullet')} title="Bulleted list" className="rounded p-1.5 text-gray-600 transition hover:bg-gray-100"><List className="h-4 w-4" /></button>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => fmt('number')} title="Numbered list" className="rounded p-1.5 text-gray-600 transition hover:bg-gray-100"><ListOrdered className="h-4 w-4" /></button>
              </div>
            )}
          </div>

          <div className="relative">
            <ToolbarIcon
              title="Emoji"
              active={emojiOpen}
              onClick={() => { onEmojiOpenChange((v) => !v); onSnippetsOpenChange(false) }}
            >
              <Smile className="h-4 w-4" />
            </ToolbarIcon>
            {emojiOpen && (
              <div className="absolute bottom-full left-0 z-20 mb-2 grid grid-cols-4 gap-1 rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
                {quickEmojis.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => onInsertEmoji(e)}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-xl transition hover:bg-gray-100"
                  >
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>

          <ToolbarIcon title="Insert link (coming soon)" disabled>
            <Link2 className="h-4 w-4" />
          </ToolbarIcon>

          <ToolbarIcon title="Attach file" onClick={onAttachClick} disabled={uploading}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
          </ToolbarIcon>

          <div className="relative">
            <ToolbarIcon
              title="Snippets"
              active={snippetsOpen}
              onClick={() => { onSnippetsOpenChange((v) => !v); onEmojiOpenChange(false) }}
            >
              <Zap className="h-4 w-4" />
            </ToolbarIcon>
            {snippetsOpen && (
              <div className="absolute bottom-full left-0 z-20 mb-2 w-72 rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
                <div className="flex items-center justify-between px-1 pb-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Snippets</span>
                  <button
                    type="button"
                    onClick={() => onSnippetsOpenChange(false)}
                    aria-label="Close snippets"
                    className="rounded p-0.5 text-gray-400 hover:bg-gray-100"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                {snippets.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onFillSnippet(s)}
                    className="block w-full rounded-lg px-2 py-2 text-left text-xs leading-snug text-gray-600 hover:bg-gray-50"
                  >
                    {s
                      .replace(/\[name\]/g, patientFirst || 'name')
                      .replace(/\[doctor\]/g, practiceDoctor || 'doctor')}
                  </button>
                ))}
              </div>
            )}
          </div>

          <ToolbarIcon title="Documents (coming soon)" disabled>
            <FileText className="h-4 w-4" />
          </ToolbarIcon>
          <ToolbarIcon title="Insert image (coming soon)" disabled>
            <Image className="h-4 w-4" />
          </ToolbarIcon>
          <ToolbarIcon title="Insert video (coming soon)" disabled>
            <Video className="h-4 w-4" />
          </ToolbarIcon>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onSuggestReply}
            disabled={suggesting}
            title="Ask CaseLift to suggest a reply"
            className="hidden rounded-md p-1.5 text-gray-500 transition hover:bg-gray-200/80 hover:text-gray-700 disabled:opacity-50 sm:inline-flex"
          >
            {suggesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          </button>

          <button
            type="button"
            onClick={onDiscard}
            title="Discard draft"
            aria-label="Discard draft"
            className="rounded-md p-1.5 text-gray-500 transition hover:bg-gray-200/80 hover:text-gray-700"
          >
            <Trash2 className="h-4 w-4" />
          </button>

          {/* Split send button */}
          <div className="inline-flex overflow-hidden rounded-md bg-blue-600 shadow-sm">
            <button
              type="submit"
              disabled={!draft.trim() || sending || missingPatientEmail}
              onClick={onSubmit}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold !text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
            <button
              type="button"
              disabled
              title="More send options (coming soon)"
              className="border-l border-blue-500/50 px-1.5 !text-white opacity-60"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
