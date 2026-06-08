import { useRef, useState } from 'react'
import { Smile, Paperclip, Send } from 'lucide-react'
import EmojiPicker from './EmojiPicker'

// Slack-style message input: grows with content, Enter to send / Shift+Enter for
// newline, emoji inserter, disabled attachment button (phase 2), char count.
export default function ChatComposer({ placeholder = 'Message…', onSend, onTyping, onStopTyping }) {
  const [text, setText] = useState('')
  const [showEmoji, setShowEmoji] = useState(false)
  const taRef = useRef(null)

  function autoSize() {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  async function send() {
    const v = text.trim()
    if (!v) return
    setText('')
    onStopTyping?.()
    requestAnimationFrame(() => { if (taRef.current) taRef.current.style.height = 'auto' })
    try {
      await onSend?.(v)
    } catch {
      // Send failed (e.g. transient) — restore the text so it isn't lost.
      setText(v)
    }
  }

  return (
    <div className="px-4 pb-4 pt-1">
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

        <button disabled className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-600" title="Attachments — coming soon">
          <Paperclip className="h-5 w-5" />
        </button>

        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => { setText(e.target.value); onTyping?.(); autoSize() }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          rows={1}
          placeholder={placeholder}
          className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent py-1 text-sm text-slate-200 placeholder-slate-500 focus:outline-none"
        />

        {text.length > 500 && (
          <span className={`self-center text-[11px] tabular-nums ${text.length > 4000 ? 'text-rose-400' : 'text-slate-500'}`}>{text.length}</span>
        )}

        {text.trim() && (
          <button onClick={send} className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary !text-white transition hover:bg-primary-700" title="Send">
            <Send className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  )
}
