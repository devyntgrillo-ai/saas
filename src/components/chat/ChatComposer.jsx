import { useRef, useState } from 'react'
import { Smile, Paperclip, Send, X, Loader2, FileText } from 'lucide-react'
import EmojiPicker from './EmojiPicker'

// Slack-style message input: grows with content, Enter to send / Shift+Enter for
// newline, emoji inserter, file attachment (with a pending chip), char count.
export default function ChatComposer({ placeholder = 'Message…', mentionables = [], onSend, onTyping, onStopTyping }) {
  const [text, setText] = useState('')
  const [file, setFile] = useState(null)
  const [showEmoji, setShowEmoji] = useState(false)
  const [sending, setSending] = useState(false)
  const [mentionQuery, setMentionQuery] = useState(null) // null = not mentioning
  const taRef = useRef(null)
  const fileRef = useRef(null)

  const mentionMatches = mentionQuery == null
    ? []
    : mentionables.filter((n) => n && n.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 6)

  function detectMention(value, caret) {
    const m = value.slice(0, caret).match(/(?:^|\s)@([\w]{0,30})$/)
    setMentionQuery(m ? m[1] : null)
  }
  function applyMention(name) {
    const caret = taRef.current?.selectionStart ?? text.length
    const before = text.slice(0, caret).replace(/@([\w]{0,30})$/, `@${name} `)
    setText(before + text.slice(caret))
    setMentionQuery(null)
    requestAnimationFrame(() => { taRef.current?.focus(); autoSize() })
  }

  function autoSize() {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  function pickFile(e) {
    const f = e.target.files?.[0]
    if (f && f.size > 25 * 1024 * 1024) { e.target.value = ''; return }
    if (f) setFile(f)
    e.target.value = ''
  }

  async function send() {
    const v = text.trim()
    if ((!v && !file) || sending) return
    const f = file
    setText('')
    setFile(null)
    onStopTyping?.()
    requestAnimationFrame(() => { if (taRef.current) taRef.current.style.height = 'auto' })
    setSending(true)
    try {
      await onSend?.(v, f)
    } catch {
      setText(v)
      setFile(f) // restore on failure
    }
    setSending(false)
  }

  return (
    <div className="px-4 pb-4 pt-1">
      {file && (
        <div className="mb-2 inline-flex items-center gap-2 rounded-lg border border-surface-700 bg-surface-800 px-2.5 py-1.5 text-xs text-slate-300">
          <FileText className="h-4 w-4 shrink-0 text-slate-400" />
          <span className="max-w-[220px] truncate">{file.name}</span>
          <button onClick={() => setFile(null)} className="text-slate-500 transition hover:text-white" title="Remove">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {mentionMatches.length > 0 && (
        <div className="mb-2 overflow-hidden rounded-xl border border-surface-700 bg-surface-900 shadow-xl">
          {mentionMatches.map((n) => (
            <button
              key={n}
              onMouseDown={(e) => { e.preventDefault(); applyMention(n) }}
              className="block w-full px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-surface-800"
            >
              <span className="text-primary-300">@</span>{n}
            </button>
          ))}
        </div>
      )}
      <div className="relative flex items-end gap-2 rounded-2xl border border-surface-700 bg-surface-800 px-3 py-2 transition focus-within:border-primary">
        <div className="relative">
          <button
            onClick={() => setShowEmoji((v) => !v)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-surface-700 hover:text-white"
            title="Emoji"
          >
            <Smile className="h-5 w-5" />
          </button>
          {showEmoji && (
            <EmojiPicker
              align="left"
              onSelect={(e) => { setText((t) => t + e); onTyping?.(); requestAnimationFrame(autoSize) }}
              onClose={() => setShowEmoji(false)}
            />
          )}
        </div>

        <button
          onClick={() => fileRef.current?.click()}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-surface-700 hover:text-white"
          title="Attach a file"
        >
          <Paperclip className="h-5 w-5" />
        </button>
        <input ref={fileRef} type="file" className="hidden" onChange={pickFile} />

        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => { setText(e.target.value); detectMention(e.target.value, e.target.selectionStart); onTyping?.(); autoSize() }}
          onKeyDown={(e) => {
            if (mentionMatches.length && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); applyMention(mentionMatches[0]); return }
            if (e.key === 'Escape' && mentionQuery != null) { setMentionQuery(null); return }
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
          }}
          rows={1}
          placeholder={placeholder}
          className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent py-1 text-sm text-slate-200 placeholder-slate-500 focus:outline-none"
        />

        {text.length > 500 && (
          <span className={`self-center text-[11px] tabular-nums ${text.length > 4000 ? 'text-rose-400' : 'text-slate-500'}`}>{text.length}</span>
        )}

        {(text.trim() || file || sending) && (
          <button
            onClick={send}
            disabled={sending}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary !text-white transition hover:bg-primary-700 disabled:opacity-60"
            title="Send"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        )}
      </div>
    </div>
  )
}
