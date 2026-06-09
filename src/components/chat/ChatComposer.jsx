import { useRef, useState } from 'react'
import {
  Bold, Italic, Strikethrough, Code, List, ListOrdered,
  Plus, Smile, AtSign, Mic, Send, X, FileText,
} from 'lucide-react'
import EmojiPicker from './EmojiPicker'
import AudioRecorder from './AudioRecorder'
import { renderEditorHighlight } from './editorHighlight'

// Slack-style composer: formatting toolbar, growing text area, a row of action
// icons (attach / emoji / mention / voice memo) and a send arrow. onSend(text,
// file, meta).
export default function ChatComposer({ placeholder = 'Message…', mentionables = [], onSend, onTyping, onStopTyping }) {
  const [text, setText] = useState('')
  const [file, setFile] = useState(null)
  const [showEmoji, setShowEmoji] = useState(false)
  const [sending, setSending] = useState(false)
  const [recording, setRecording] = useState(false)
  const [mentionQuery, setMentionQuery] = useState(null)
  const taRef = useRef(null)
  const fileRef = useRef(null)
  const overlayRef = useRef(null)

  const mentionMatches = mentionQuery == null
    ? []
    : mentionables.filter((n) => n && n.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 6)

  function autoSize() {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }
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
  function wrap(pre, post = pre) {
    const ta = taRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const sel = text.slice(start, end)
    setText(text.slice(0, start) + pre + sel + post + text.slice(end))
    requestAnimationFrame(() => {
      ta.focus()
      const caret = start + pre.length + sel.length
      ta.setSelectionRange(caret, caret)
      autoSize()
    })
  }
  function linePrefix(prefix) {
    const ta = taRef.current
    if (!ta) return
    const start = ta.selectionStart
    const lineStart = text.lastIndexOf('\n', start - 1) + 1
    setText(text.slice(0, lineStart) + prefix + text.slice(lineStart))
    requestAnimationFrame(() => { ta.focus(); autoSize() })
  }
  function insertAt() {
    setText((t) => `${t}@`)
    requestAnimationFrame(() => { taRef.current?.focus(); setMentionQuery('') })
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
    setText(''); setFile(null); onStopTyping?.()
    requestAnimationFrame(() => { if (taRef.current) taRef.current.style.height = 'auto' })
    setSending(true)
    try { await onSend?.(v, f) } catch { setText(v); setFile(f) }
    setSending(false)
  }

  async function sendAudio(blob, durationSec) {
    setRecording(false)
    const f = new File([blob], 'voice-memo.webm', { type: blob.type || 'audio/webm' })
    setSending(true)
    try { await onSend?.('', f, { audioDuration: durationSec }) } catch { /* dropped */ }
    setSending(false)
  }

  const toolBtn = 'flex h-7 w-7 items-center justify-center rounded text-slate-400 transition hover:bg-surface-700 hover:text-white'

  return (
    <div className="px-4 pb-4 pt-1">
      {mentionMatches.length > 0 && (
        <div className="mb-2 overflow-hidden rounded-xl border border-surface-700 bg-surface-900 shadow-xl">
          {mentionMatches.map((n) => (
            <button key={n} onMouseDown={(e) => { e.preventDefault(); applyMention(n) }} className="block w-full px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-surface-800">
              <span className="text-primary-300">@</span>{n}
            </button>
          ))}
        </div>
      )}

      {recording ? (
        <AudioRecorder onSend={sendAudio} onCancel={() => setRecording(false)} />
      ) : (
        <div className="rounded-lg border border-surface-700 bg-surface-800 transition focus-within:border-primary">
          {/* Formatting toolbar */}
          <div className="flex items-center gap-0.5 border-b border-surface-700 px-2 py-1">
            <button onClick={() => wrap('**')} className={toolBtn} title="Bold"><Bold className="h-4 w-4" /></button>
            <button onClick={() => wrap('*')} className={toolBtn} title="Italic"><Italic className="h-4 w-4" /></button>
            <button onClick={() => wrap('~~')} className={toolBtn} title="Strikethrough"><Strikethrough className="h-4 w-4" /></button>
            <button onClick={() => wrap('`')} className={toolBtn} title="Code"><Code className="h-4 w-4" /></button>
            <button onClick={() => linePrefix('- ')} className={toolBtn} title="Bulleted list"><List className="h-4 w-4" /></button>
            <button onClick={() => linePrefix('1. ')} className={toolBtn} title="Numbered list"><ListOrdered className="h-4 w-4" /></button>
          </div>

          {file && (
            <div className="mx-3 mt-2 inline-flex items-center gap-2 rounded-lg border border-surface-700 bg-surface-900 px-2.5 py-1.5 text-xs text-slate-300">
              <FileText className="h-4 w-4 shrink-0 text-slate-400" />
              <span className="max-w-[220px] truncate">{file.name}</span>
              <button onClick={() => setFile(null)} className="text-slate-500 transition hover:text-white"><X className="h-3.5 w-3.5" /></button>
            </div>
          )}

          <div className="relative">
            {/* Live formatting layer (bold shows bold, markers dimmed), aligned
                char-for-char behind the transparent-text textarea. */}
            <div ref={overlayRef} aria-hidden className="pointer-events-none absolute inset-0 max-h-36 overflow-hidden whitespace-pre-wrap break-words px-3 py-2 text-[15px] leading-6 text-slate-200">
              {renderEditorHighlight(text, mentionables)}
            </div>
            <textarea
              ref={taRef}
              value={text}
              onChange={(e) => { setText(e.target.value); detectMention(e.target.value, e.target.selectionStart); onTyping?.(); autoSize() }}
              onScroll={(e) => { if (overlayRef.current) overlayRef.current.scrollTop = e.currentTarget.scrollTop }}
              onKeyDown={(e) => {
                if (mentionMatches.length && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); applyMention(mentionMatches[0]); return }
                if (e.key === 'Escape' && mentionQuery != null) { setMentionQuery(null); return }
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
              }}
              rows={1}
              placeholder={placeholder}
              className="relative block max-h-36 min-h-[40px] w-full resize-none bg-transparent px-3 py-2 text-[15px] leading-6 text-transparent caret-slate-200 placeholder-slate-500 focus:outline-none"
            />
          </div>

          {/* Bottom action row */}
          <div className="flex items-center gap-0.5 px-2 py-1.5">
            <button onClick={() => fileRef.current?.click()} className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-surface-700 hover:text-white" title="Attach a file">
              <Plus className="h-5 w-5" />
            </button>
            <input ref={fileRef} type="file" className="hidden" onChange={pickFile} />
            <div className="relative">
              <button onClick={() => setShowEmoji((v) => !v)} className="flex h-7 w-7 items-center justify-center rounded text-slate-400 transition hover:bg-surface-700 hover:text-white" title="Emoji">
                <Smile className="h-5 w-5" />
              </button>
              {showEmoji && (
                <EmojiPicker align="left" onSelect={(e) => { setText((t) => t + e); onTyping?.(); requestAnimationFrame(autoSize) }} onClose={() => setShowEmoji(false)} />
              )}
            </div>
            <button onClick={insertAt} className="flex h-7 w-7 items-center justify-center rounded text-slate-400 transition hover:bg-surface-700 hover:text-white" title="Mention someone">
              <AtSign className="h-5 w-5" />
            </button>
            <button onClick={() => setRecording(true)} className="flex h-7 w-7 items-center justify-center rounded text-slate-400 transition hover:bg-surface-700 hover:text-white" title="Record a voice memo">
              <Mic className="h-5 w-5" />
            </button>

            {text.length > 500 && (
              <span className={`ml-auto self-center text-[11px] tabular-nums ${text.length > 4000 ? 'text-rose-400' : 'text-slate-500'}`}>{text.length}</span>
            )}
            <button
              onClick={send}
              disabled={(!text.trim() && !file) || sending}
              className={`flex h-7 w-7 items-center justify-center rounded transition ${text.trim() || file ? 'bg-primary !text-white hover:bg-primary-700' : 'text-slate-600'} ${text.length > 500 ? '' : 'ml-auto'}`}
              title="Send"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
