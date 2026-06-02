import { useMemo, useState } from 'react'
import { FileText, ChevronDown, ChevronRight, ShieldCheck, Search } from 'lucide-react'
import { formatDuration } from '../lib/consults'

// Highlight rules for key moments.
const OBJECTION_RE = /\b(cost|expensive|forty|price|afford|wife|husband|spouse|talk it over|timing|rush|nervous|scared|afraid)\b/i
const POSITIVE_RE = /\b(interested|worth it|helpful|sounds good|changes things|love|ready|makes sense)\b/i
const EXIT_RE = /\b(think about it|take.* home|next week|not.* rush|need to|come back)\b/i

function lineClass(text) {
  if (EXIT_RE.test(text)) return 'bg-rose-500/10'
  if (OBJECTION_RE.test(text)) return 'bg-amber-500/10'
  if (POSITIVE_RE.test(text)) return 'bg-emerald-500/10'
  return ''
}

const SPEAKER_COLOR = {
  TC: 'text-primary-300',
  Patient: 'text-slate-200',
  Doctor: 'text-violet-300',
}

function parseTranscript(raw) {
  if (!raw) return { notice: null, lines: [] }
  const all = raw.split('\n').map((l) => l.trim()).filter(Boolean)
  const notice = all.find((l) => /de-identified/i.test(l)) || null
  const lines = []
  for (const l of all) {
    const m = l.match(/^\[(TC|Patient|Doctor)\]\s*([\d:]+)?\s*[—-]?\s*(.*)$/)
    if (m) lines.push({ speaker: m[1], ts: m[2] || '', text: m[3] })
  }
  return { notice, lines }
}

export default function TranscriptViewer({ transcript, duration }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const { notice, lines } = useMemo(() => parseTranscript(transcript), [transcript])

  if (!transcript) return null

  const filtered = query.trim()
    ? lines.filter((l) => l.text.toLowerCase().includes(query.trim().toLowerCase()))
    : lines

  return (
    <section className="card overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left">
        <span className="flex items-center gap-2.5">
          <FileText className="h-4 w-4 text-slate-400" />
          <span className="font-semibold text-white">Recording Transcript</span>
        </span>
        <span className="flex items-center gap-2 text-sm text-slate-500">
          {formatDuration(duration) || ''} recording · Tap to read
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
      </button>

      {open && (
        <div className="border-t border-surface-700 px-5 py-4">
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2 text-xs text-emerald-200">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            {notice ? notice.replace(/[[\]]/g, '') : 'De-identified for HIPAA compliance'}
          </div>

          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search within transcript" className="input pl-9 text-sm" />
          </div>

          <div className="space-y-1 font-sans text-[15px] leading-relaxed">
            {filtered.map((l, i) => (
              <div key={i} className={`rounded-md px-2 py-1.5 ${lineClass(l.text)}`}>
                <span className={`font-semibold ${SPEAKER_COLOR[l.speaker] || 'text-slate-300'}`}>[{l.speaker}]</span>
                {l.ts && <button className="ml-2 text-xs text-slate-500 hover:text-primary-300" title="Jump to moment">{l.ts}</button>}
                <span className="ml-2 text-slate-300">{l.text}</span>
              </div>
            ))}
            {filtered.length === 0 && <p className="py-4 text-center text-sm text-slate-500">No lines match “{query}”.</p>}
          </div>

          <div className="mt-3 flex flex-wrap gap-3 border-t border-surface-700 pt-3 text-[11px] text-slate-500">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded bg-amber-500/30" /> Objection</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded bg-emerald-500/30" /> Positive signal</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded bg-rose-500/30" /> Exit intent</span>
          </div>
        </div>
      )}
    </section>
  )
}
