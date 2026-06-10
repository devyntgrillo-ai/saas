import { useMemo, useState } from 'react'
import { FileText, ChevronDown, ChevronRight, ShieldCheck, Search } from 'lucide-react'
import { formatDuration } from '../lib/consults'

// Highlight rules for key moments.
const OBJECTION_RE = /\b(cost|expensive|forty|price|afford|wife|husband|spouse|talk it over|timing|rush|nervous|scared|afraid)\b/i
const POSITIVE_RE = /\b(interested|worth it|helpful|sounds good|changes things|love|ready|makes sense)\b/i
const EXIT_RE = /\b(think about it|take.* home|next week|not.* rush|need to|come back)\b/i

function lineClass(text) {
  if (EXIT_RE.test(text)) return 'bg-rose-50'
  if (OBJECTION_RE.test(text)) return 'bg-amber-50'
  if (POSITIVE_RE.test(text)) return 'bg-emerald-50'
  return ''
}

// Color the speaker name by role. Light theme (the consult page is light).
function speakerColor(speaker) {
  const s = (speaker || '').toLowerCase()
  if (s === 'tc' || s === 'doctor' || s.startsWith('speaker 1')) return 'text-primary-600'
  if (s === 'patient' || s.startsWith('speaker 2')) return 'text-rose-600'
  return 'text-gray-700'
}

// Normalize a captured speaker token to a clean display label.
function normSpeaker(raw) {
  const s = (raw || '').trim()
  if (/^tc$/i.test(s)) return 'TC'
  if (/^patient$/i.test(s)) return 'Patient'
  if (/^doctor$/i.test(s)) return 'Doctor'
  return s.replace(/\s+/g, ' ')
}

// Parse a stored transcript into speaker turns. Handles several shapes so older
// plain-prose transcripts still render instead of showing blank:
//   [TC] 0:12, text   |   [Patient] text   |   [0:12] text   |   TC: text
// When nothing structured is found we fall back to rendering the raw prose.
function parseTranscript(raw) {
  if (!raw) return { notice: null, lines: [], prose: '' }
  const all = raw.split('\n').map((l) => l.trim()).filter(Boolean)
  const notice = all.find((l) => /de-identified/i.test(l)) || null
  const body = all.filter((l) => l !== notice)
  const lines = []
  for (const l of body) {
    let m = l.match(/^\[(TC|Patient|Doctor|Speaker\s*\d*)\]\s*(\d{1,2}:\d{2})?\s*[, –-]?\s*(.*)$/i)
    if (m && m[3]) { lines.push({ speaker: normSpeaker(m[1]), ts: m[2] || '', text: m[3] }); continue }
    m = l.match(/^\[(\d{1,2}:\d{2})\]\s*(.*)$/) // [m:ss] text, no speaker
    if (m && m[2]) { lines.push({ speaker: '', ts: m[1], text: m[2] }); continue }
    m = l.match(/^(TC|Patient|Doctor)\s*[:：]\s*(.*)$/i) // "Speaker: text"
    if (m && m[2]) { lines.push({ speaker: normSpeaker(m[1]), ts: '', text: m[2] }); continue }
  }
  // Prose fallback: split into paragraphs (blank-line separated, else one block).
  const prose = body.join('\n')
  return { notice, lines, prose }
}

export default function TranscriptViewer({ transcript, duration }) {
  const [open, setOpen] = useState(true)
  const [query, setQuery] = useState('')
  const { notice, lines, prose } = useMemo(() => parseTranscript(transcript), [transcript])

  if (!transcript) return null

  const q = query.trim().toLowerCase()
  const filtered = q ? lines.filter((l) => l.text.toLowerCase().includes(q)) : lines
  const hasTurns = lines.length > 0
  const proseParas = prose.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  const filteredParas = q ? proseParas.filter((p) => p.toLowerCase().includes(q)) : proseParas

  return (
    <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left">
        <span className="flex items-center gap-2.5">
          <FileText className="h-4 w-4 text-gray-400" />
          <span className="font-semibold text-gray-900">Recording Transcript</span>
        </span>
        <span className="flex items-center gap-2 text-sm text-gray-500">
          {formatDuration(duration) ? `${formatDuration(duration)} recording` : ''}
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
      </button>

      {open && (
        <div className="border-t border-gray-100 px-5 py-4">
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            {notice ? notice.replace(/[[\]]/g, '') : 'De-identified for HIPAA compliance'}
          </div>

          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search within transcript"
              className="h-9 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-sm text-gray-900 placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            />
          </div>

          {hasTurns ? (
            <div className="space-y-1 text-[15px] leading-relaxed">
              {filtered.map((l, i) => (
                <div key={i} className={`flex gap-2 rounded-md px-2 py-1.5 ${lineClass(l.text)}`}>
                  <span className="shrink-0 whitespace-nowrap">
                    {l.speaker && <span className={`font-semibold ${speakerColor(l.speaker)}`}>{l.speaker}</span>}
                    {l.ts && <span className="ml-2 text-xs text-gray-400">{l.ts}</span>}
                  </span>
                  <span className="text-gray-800">{l.text}</span>
                </div>
              ))}
              {filtered.length === 0 && <p className="py-4 text-center text-sm text-gray-400">No lines match “{query}”.</p>}
            </div>
          ) : (
            // Plain-prose fallback (older transcripts with no speaker labels).
            <div className="space-y-3 text-[15px] leading-relaxed text-gray-800">
              {filteredParas.length > 0 ? (
                filteredParas.map((p, i) => <p key={i} className="whitespace-pre-wrap">{p}</p>)
              ) : (
                <p className="py-4 text-center text-sm text-gray-400">No text matches “{query}”.</p>
              )}
            </div>
          )}

          {hasTurns && (
            <div className="mt-3 flex flex-wrap gap-3 border-t border-gray-100 pt-3 text-[11px] text-gray-500">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded bg-amber-200" /> Objection</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded bg-emerald-200" /> Positive signal</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded bg-rose-200" /> Exit intent</span>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
