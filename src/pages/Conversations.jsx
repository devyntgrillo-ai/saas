import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import {
  MessagesSquare,
  Mail,
  MailOpen,
  Send,
  ArrowLeft,
  Phone,
  PhoneCall,
  PhoneOff,
  Mic,
  MicOff,
  Circle,
  Search,
  Sparkles,
  Loader2,
  FileText,
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  PauseCircle,
  Star,
  Trash2,
  SlidersHorizontal,
  Smile,
  Paperclip,
  Download,
  ScrollText,
  X,
  Pencil,
  GitBranch,
  CheckCircle2,
  XCircle,
  StickyNote,
  Play,
  Pause,
  Megaphone,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useRecorder } from '../context/RecorderContext'
import { supabase } from '../lib/supabase'
import { stripEmDashes } from '../lib/sanitize'
import { timeAgo, formatDate, formatDuration } from '../lib/consults'
import { auditConversationViewed, auditPatientAccessed, auditMessageSent } from '../lib/audit'
import { SkeletonList } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import { formatMoney } from '../lib/analytics'
import { formatCallTime, useTwilioVoiceDevice } from '../lib/voice'
import CallMessageBubble from '../components/CallMessageBubble'

function initials(first, last) {
  return `${(first || '?')[0]}${(last || '')[0] || ''}`.toUpperCase()
}

// Deterministic avatar color so each patient keeps a stable colored circle.
const AVATAR_COLORS = [
  'bg-rose-500',
  'bg-orange-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-teal-500',
  'bg-sky-500',
  'bg-indigo-500',
  'bg-violet-500',
  'bg-fuchsia-500',
]
function avatarColor(seed) {
  const s = seed || '?'
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

// Time-only label shown under a bubble, e.g. "2:45 PM".
function messageTime(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

// Day label for the centered separator pills: "Today" / "Yesterday" / "May 26".
function dayLabel(ts) {
  const d = new Date(ts)
  const now = new Date()
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

// Seed/demo bodies contain em dashes; iMessage-style text uses none. Strip them
// before rendering, replacing with a comma so the sentence still reads cleanly.
function cleanBody(text) {
  if (!text) return ''
  return String(text).replace(/\s*—\s*/g, ', ')
}

// Messages from the same sender within this window group into one cluster
// (tighter spacing, single shared timestamp) like iMessage.
const CLUSTER_GAP_MS = 5 * 60 * 1000

// ---- Patient context panel -------------------------------------------------

// True when a value is present and not a "none"/"n/a" sentinel from analysis.
function hasValue(v) {
  const s = (v ?? '').toString().trim().toLowerCase()
  return Boolean(s) && s !== 'none' && s !== 'n/a' && s !== 'null'
}

// "long_term" -> "Long Term", "price" -> "Price".
function titleCase(s) {
  return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// Exit-intent pill styling per level (bright, since the panel sits on white).
const EXIT_PILL = {
  hot: { label: '🔥 Hot', cls: 'bg-red-100 text-red-700' },
  warm: { label: 'Warm', cls: 'bg-yellow-100 text-yellow-700' },
  long_term: { label: 'Long-term', cls: 'bg-blue-100 text-blue-700' },
}

// Collapse the consult + its drafted sequence messages into one status line.
function sequenceStatusText(consult, msgs, paused) {
  if (!consult) return null
  if (consult.outcome === 'accepted' || ['closed_won', 'recovered'].includes(consult.status)) {
    return 'Accepted, no sequence running'
  }
  if (consult.outcome === 'not_converting' || ['closed_lost', 'lost'].includes(consult.status)) {
    return 'Stopped, marked not converting'
  }
  if (paused) return 'Paused, patient replied'
  const live = (msgs || []).filter((m) => m.status !== 'cancelled')
  const total = live.length
  if (!total) return 'No sequence scheduled yet'
  const sent = live.filter((m) => m.status === 'sent').length
  const dayN = Math.min(sent + 1, total)
  const next = live
    .filter((m) => m.status !== 'sent' && m.scheduled_for)
    .sort((a, b) => new Date(a.scheduled_for) - new Date(b.scheduled_for))[0]
  if (!next) return sent >= total ? 'Sequence complete' : `Day ${dayN} of ${total}`
  const days = Math.max(0, Math.round((new Date(next.scheduled_for).getTime() - Date.now()) / 86400000))
  const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`
  return `Day ${dayN} of ${total} · Next: ${(next.channel || 'sms').toUpperCase()} ${when}`
}

function SectionLabel({ children }) {
  return <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{children}</p>
}

// Pulsing placeholder bars used while a consult loads or is still analyzing.
function SkeletonLines({ lines = 2 }) {
  return (
    <div className="space-y-1.5">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-2.5 animate-pulse rounded bg-gray-200" style={{ width: `${92 - i * 18}%` }} />
      ))}
    </div>
  )
}

function ContextSkeleton() {
  return (
    <div className="space-y-5 px-4 py-4">
      {['Consult summary', 'Objections', 'Exit intent', 'Next step', 'Sequence'].map((s) => (
        <div key={s}>
          <SectionLabel>{s}</SectionLabel>
          <SkeletonLines lines={s === 'Consult summary' ? 3 : 1} />
        </div>
      ))}
    </div>
  )
}

// Collapsible sidebar section: xs uppercase label + chevron, 16px padding,
// gray-100 divider, white background. Collapsed shows just the label + chevron.
function PanelSection({ label, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-gray-100">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-2.5 text-left">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</span>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-gray-400" /> : <ChevronRight className="h-3.5 w-3.5 text-gray-400" />}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  )
}

// Summary text clamped to ~3 lines with an inline "Read more" toggle.
function ReadMore({ text }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-2">
      <p className={`text-[13px] leading-relaxed text-gray-700 ${open ? '' : 'line-clamp-3'}`}>{text}</p>
      {text && text.length > 130 && (
        <button type="button" onClick={() => setOpen((o) => !o)} className="mt-0.5 text-xs font-medium text-primary-600 hover:underline">
          {open ? 'Show less' : 'Read more'}
        </button>
      )}
    </div>
  )
}

// Right-hand panel: everything the TC needs to reply without leaving the thread.
function PatientContextPanel({ consult, conv, msgs, loading, paused, onCollapse, onStartRecording, onConsultChange, onConvChange, onAddThreadMessage }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState('')
  const [showConvert, setShowConvert] = useState(false)
  const [convertValue, setConvertValue] = useState('')
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm({
      patient_first: conv?.patient_first || '', patient_last: conv?.patient_last || '',
      patient_phone: conv?.patient_phone || '', patient_email: conv?.patient_email || '',
    })
    setEditing(false)
  }, [conv?.id])

  const analyzing =
    consult &&
    !hasValue(consult.what_happened) &&
    !['closed_won', 'closed_lost', 'recovered', 'lost'].includes(consult.status)

  const primaryObjection = consult && (hasValue(consult.objection_type) ? titleCase(consult.objection_type) : consult.primary_objection)
  const objDot = { price: 'bg-amber-500', fear: 'bg-red-500', spouse: 'bg-purple-500', timing: 'bg-blue-500' }[consult?.objection_type] || 'bg-gray-400'
  const exitLevel = consult?.exit_intent_level
  const exitPill = exitLevel ? EXIT_PILL[exitLevel] : null
  const seqText = sequenceStatusText(consult, msgs, paused)
  const sentCount = (msgs || []).filter((m) => ['sent', 'opened', 'replied'].includes(m.status)).length
  const seqTotal = (msgs || []).length
  const seqStatus = consult?.sequence_status || 'active'
  const seqPaused = seqStatus === 'paused'
  const converted = consult && (consult.outcome === 'accepted' || ['closed_won', 'recovered'].includes(consult.status))

  const fullName = [conv?.patient_first, conv?.patient_last].filter(Boolean).join(' ') || 'Patient'

  async function savePatient() {
    if (!conv?.id) return
    setBusy('patient')
    const patch = { patient_first: form.patient_first || null, patient_last: form.patient_last || null, patient_phone: form.patient_phone || null, patient_email: form.patient_email || null }
    await supabase.from('conversations').update(patch).eq('id', conv.id)
    onConvChange?.(patch)
    setBusy(''); setEditing(false)
  }

  async function toggleSequence() {
    if (!consult?.id) return
    setBusy('seq')
    // Pause keeps pending messages intact so they resume cleanly - no cancelling.
    const patch = seqPaused
      ? { sequence_status: 'active', sequence_paused_reason: null, sequence_cancelled_at: null, sequence_cancelled_reason: null }
      : { sequence_status: 'paused', sequence_paused_reason: 'manual' }
    await supabase.from('consults').update(patch).eq('id', consult.id)
    onConsultChange?.(patch)
    setBusy('')
  }

  async function markConverted() {
    if (!consult?.id) return
    setBusy('convert')
    const val = Number(String(convertValue).replace(/[^0-9.]/g, '')) || null
    const patch = { outcome: 'closed_won', status: 'closed_won', case_value: val, closed_at: new Date().toISOString(), attribution_status: 'caselift_recovered', sequence_status: 'cancelled' }
    await supabase.from('messages').update({ status: 'cancelled' }).eq('consult_id', consult.id).in('status', ['draft', 'scheduled', 'pending'])
    await supabase.from('consults').update(patch).eq('id', consult.id)
    if (consult.practice_id) {
      supabase.from('notifications').insert({
        practice_id: consult.practice_id, type: 'case_converted', event: 'case_converted',
        title: 'Case converted', message: `${fullName} accepted treatment${val ? ` - ${formatMoney(val)} recovered` : ''}`,
        link: `/consults/${consult.id}`,
      }).then(() => {}, () => {})
    }
    onConsultChange?.(patch)
    setBusy(''); setShowConvert(false); setConvertValue('')
  }

  async function markNotConverting() {
    if (!consult?.id) return
    setBusy('notconv')
    const patch = { outcome: 'not_converting', sequence_status: 'cancelled' }
    await supabase.from('messages').update({ status: 'cancelled' }).eq('consult_id', consult.id).in('status', ['draft', 'scheduled', 'pending'])
    await supabase.from('consults').update(patch).eq('id', consult.id)
    onConsultChange?.(patch)
    setBusy('')
  }

  async function addNote() {
    const body = note.trim()
    if (!body || !conv?.id) return
    setBusy('note')
    const { data } = await supabase.from('conversation_messages')
      .insert({ conversation_id: conv.id, direction: 'outbound', channel: 'note', body, sent_at: new Date().toISOString() })
      .select().single()
    if (data) onAddThreadMessage?.(data)
    setBusy(''); setNote(''); setNoteOpen(false)
  }

  return (
    <aside className="hidden w-[280px] shrink-0 flex-col border-l border-gray-200 bg-white lg:flex">
      <div className="flex shrink-0 items-center justify-end border-b border-gray-100 px-2 py-1.5">
        <button onClick={onCollapse} title="Collapse panel" aria-label="Collapse contact details"
          className="rounded-md p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* SECTION 1 - Patient */}
        <PanelSection label="Patient">
          <div className="flex items-start gap-3">
            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-semibold text-white ${avatarColor(fullName)}`}>
              {initials(conv?.patient_first, conv?.patient_last)}
            </div>
            <div className="min-w-0 flex-1">
              {editing ? (
                <div className="space-y-1.5">
                  <div className="flex gap-1.5">
                    <input value={form.patient_first} onChange={(e) => setForm((f) => ({ ...f, patient_first: e.target.value }))} placeholder="First" className="w-full rounded border border-gray-200 px-2 py-1 text-sm" />
                    <input value={form.patient_last} onChange={(e) => setForm((f) => ({ ...f, patient_last: e.target.value }))} placeholder="Last" className="w-full rounded border border-gray-200 px-2 py-1 text-sm" />
                  </div>
                  <input value={form.patient_phone} onChange={(e) => setForm((f) => ({ ...f, patient_phone: e.target.value }))} placeholder="Phone" className="w-full rounded border border-gray-200 px-2 py-1 text-sm" />
                  <input value={form.patient_email} onChange={(e) => setForm((f) => ({ ...f, patient_email: e.target.value }))} placeholder="Email" className="w-full rounded border border-gray-200 px-2 py-1 text-sm" />
                  <div className="flex justify-end gap-2 pt-1">
                    <button onClick={() => setEditing(false)} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
                    <button onClick={savePatient} disabled={busy === 'patient'} className="text-xs font-semibold text-primary-600 hover:text-primary-700">Save</button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="truncate text-[15px] font-bold text-gray-900">{fullName}</p>
                  {conv?.patient_phone && (
                    <a href={`tel:${conv.patient_phone}`} className="mt-0.5 block truncate text-[13px] text-blue-600 hover:underline">{conv.patient_phone}</a>
                  )}
                  {conv?.patient_email && (
                    <a href={`mailto:${conv.patient_email}`} className="block truncate text-[13px] text-blue-600 hover:underline">{conv.patient_email}</a>
                  )}
                </>
              )}
            </div>
            {!editing && (
              <button onClick={() => setEditing(true)} title="Edit patient" className="rounded-md p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600">
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </PanelSection>

        {loading || analyzing ? (
          <ContextSkeleton />
        ) : !consult ? (
          <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 text-gray-400"><FileText className="h-6 w-6" /></div>
            <p className="mt-3 text-sm font-medium text-gray-600">No consult on file</p>
            <button onClick={onStartRecording} className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary-600 transition hover:text-primary-700 hover:underline">
              <Mic className="h-3.5 w-3.5" /> Start Recording
            </button>
          </div>
        ) : (
          <>
            {/* SECTION 2 - Last consult */}
            <PanelSection label="Last consult">
              <p className="text-xs text-gray-500">
                {hasValue(consult.recording_date) ? formatDate(consult.recording_date) : 'Recent'}
                {formatDuration(consult.duration) && formatDuration(consult.duration) !== '0 min' ? ` · ${formatDuration(consult.duration)}` : ''}
              </p>
              {hasValue(consult.what_happened) && <ReadMore text={stripEmDashes(consult.what_happened)} />}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {hasValue(primaryObjection) && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700"><span className={`h-1.5 w-1.5 rounded-full ${objDot}`} /> {primaryObjection}</span>
                )}
                {(exitPill || hasValue(consult.exit_intent)) && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700"><span className="h-1.5 w-1.5 rounded-full bg-gray-400" /> {exitPill ? exitPill.label : titleCase(consult.exit_intent)}</span>
                )}
              </div>
              <Link to={`/consults/${consult.id}`} className="mt-2 inline-block text-xs font-medium text-primary-600 hover:underline">View full analysis →</Link>
            </PanelSection>

            {/* SECTION 3 - Coaching */}
            {hasValue(consult.coaching_insight) && (
              <PanelSection label="Coaching">
                <div className="rounded-r-lg border-l-[3px] border-amber-400 bg-amber-50 px-3 py-2 text-[13px] leading-relaxed text-amber-800">{stripEmDashes(consult.coaching_insight)}</div>
              </PanelSection>
            )}

            {/* SECTION 4 - Sequence */}
            <PanelSection label="Sequence">
              {seqTotal > 0 && <p className="text-[13px] font-bold text-gray-800">Message {Math.min(sentCount + 1, seqTotal)} of {seqTotal}</p>}
              {seqText && <p className="mt-0.5 text-xs text-gray-500">{seqText}</p>}
              <div className="mt-2 flex items-center gap-3">
                <button onClick={toggleSequence} disabled={busy === 'seq'} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-50">
                  {busy === 'seq' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : seqPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                  {seqPaused ? 'Resume' : 'Pause'}
                </button>
                <Link to="/sequences" className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:underline"><GitBranch className="h-3 w-3" /> View sequence →</Link>
              </div>
            </PanelSection>

            {/* SECTION 5 - PMS (closed by default) */}
            <PanelSection label="PMS" defaultOpen={false}>
              {consult.case_value > 0 ? (
                <div className="space-y-1 text-[13px] text-gray-700">
                  <div className="flex items-center justify-between gap-2">
                    <span>Tx Plan: <span className="font-semibold text-gray-900">{formatMoney(consult.case_value)}</span></span>
                    <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-700">Auto-synced</span>
                  </div>
                  <p className="text-gray-500">Status: {converted ? 'Accepted' : 'Pending acceptance'}</p>
                </div>
              ) : (
                <p className="text-xs text-gray-400">No PMS data for this patient yet.</p>
              )}
            </PanelSection>

            {/* SECTION 6 - Quick actions (always visible) */}
            <div className="px-4 py-4">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Quick actions</p>
              <div className="space-y-1.5">
                {converted ? (
                  <div className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Converted{consult.case_value ? ` · ${formatMoney(consult.case_value)}` : ''}</div>
                ) : (
                  <>
                    {showConvert ? (
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2">
                        <input value={convertValue} onChange={(e) => setConvertValue(e.target.value)} placeholder="Treatment value e.g. 32000" className="w-full rounded border border-emerald-200 px-2 py-1 text-sm" />
                        <div className="mt-2 flex justify-end gap-2">
                          <button onClick={() => setShowConvert(false)} className="text-xs text-gray-500">Cancel</button>
                          <button onClick={markConverted} disabled={busy === 'convert'} className="text-xs font-semibold text-emerald-700">Save</button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => setShowConvert(true)} className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-emerald-700 transition hover:bg-emerald-50"><CheckCircle2 className="h-4 w-4" /> Mark as converted</button>
                    )}
                    <button onClick={markNotConverting} disabled={busy === 'notconv'} className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50"><XCircle className="h-4 w-4" /> Not converting</button>
                  </>
                )}
                {noteOpen ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-2">
                    <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Internal note…" rows={2} className="w-full resize-none rounded border border-amber-200 px-2 py-1 text-sm" />
                    <div className="mt-2 flex justify-end gap-2">
                      <button onClick={() => { setNoteOpen(false); setNote('') }} className="text-xs text-gray-500">Cancel</button>
                      <button onClick={addNote} disabled={busy === 'note'} className="text-xs font-semibold text-amber-700">Save note</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setNoteOpen(true)} className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50"><StickyNote className="h-4 w-4" /> Add note</button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  )
}

// Quick-insert emojis for the composer (no external picker dependency).
const QUICK_EMOJIS = ['😊', '👍', '❤️', '🙏', '💪', '✅', '📅', '💰']

// Pre-written message templates. [name] / [doctor] are filled at insert time.
const SNIPPETS = [
  'Hi [name], just checking in! Do you have any questions about your implant options?',
  'Hi [name], Dr. [doctor] wanted me to follow up. We have openings this week if you’d like to come in.',
  'Hi [name], we have financing options starting at $X/month. Want me to send you the details?',
  'Hi [name], just a friendly reminder that your consultation offer is still available.',
]

// Inline "log a call" form shown under the composer.
const CALL_OUTCOMES = ['Answered', 'No answer', 'Left voicemail', 'Scheduled appointment']
function LogCallForm({ onSave, onCancel }) {
  const [direction, setDirection] = useState('outbound')
  const [duration, setDuration] = useState('')
  const [outcome, setOutcome] = useState(CALL_OUTCOMES[0])
  const [notes, setNotes] = useState('')
  const sel = 'rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:border-blue-400 focus:outline-none'
  return (
    <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <select value={direction} onChange={(e) => setDirection(e.target.value)} className={sel}>
          <option value="outbound">Outbound</option>
          <option value="inbound">Inbound</option>
        </select>
        <input type="number" min="0" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="Min" className={`${sel} w-20`} />
        <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className={sel}>
          {CALL_OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Call notes (optional)" className="mt-2 w-full resize-none rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-gray-900 focus:border-blue-400 focus:outline-none" />
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="text-xs font-medium text-gray-500 hover:text-gray-700">Cancel</button>
        <button type="button" onClick={() => onSave({ direction, durationMin: Number(duration) || null, outcome, notes })} className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-gray-700">Log call</button>
      </div>
    </div>
  )
}

export default function Conversations() {
  const { practiceId, practice, user, profile } = useAuth()
  const [searchParams] = useSearchParams()
  const deepLinkId = searchParams.get('c')
  const [conversations, setConversations] = useState([])
  const [activeId, setActiveId] = useState(deepLinkId || null)
  const [thread, setThread] = useState([])
  const [callRecordings, setCallRecordings] = useState({}) // call_log_id -> { recording_url, ... }
  const [loadingList, setLoadingList] = useState(true)
  const [loadingThread, setLoadingThread] = useState(false)
  const [draft, setDraft] = useState('')
  const [aiSuggested, setAiSuggested] = useState(false)
  const [channel, setChannel] = useState('sms')
  const [emailSubject, setEmailSubject] = useState('')
  const [sending, setSending] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all') // all | unread | active
  const [suggesting, setSuggesting] = useState(false)
  // Patient-context panel state.
  const { openRecorder } = useRecorder()
  const [consult, setConsult] = useState(null)
  const [consultMsgs, setConsultMsgs] = useState([])
  const [loadingContext, setLoadingContext] = useState(false)
  const [panelCollapsed, setPanelCollapsed] = useState(() => {
    try { return localStorage.getItem('conv:contextCollapsed') === '1' } catch { return false }
  })
  const scrollRef = useRef(null)
  const taRef = useRef(null)

  // Lightweight transient toast (no external dep).
  const [toast, setToast] = useState('')
  const toastTimer = useRef(null)
  const showToast = useCallback((msg) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2500)
  }, [])

  // Compose-toolbar popovers + archive confirmation.
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [snippetsOpen, setSnippetsOpen] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [logCallOpen, setLogCallOpen] = useState(false)
  const fileInputRef = useRef(null)

  // Display name for the practice-side sender, shown above outbound clusters.
  const tcName = useMemo(() => {
    const full = profile?.full_name || profile?.name
    if (full) return String(full).split(' ')[0]
    const local = (user?.email || '').split('@')[0]
    if (local) return local.charAt(0).toUpperCase() + local.slice(1)
    return 'You'
  }, [profile, user])

  function togglePanel() {
    setPanelCollapsed((v) => {
      const nv = !v
      try { localStorage.setItem('conv:contextCollapsed', nv ? '1' : '0') } catch { /* ignore */ }
      return nv
    })
  }

  useEffect(() => {
    if (!practiceId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoadingList(false)
      return
    }
    let active = true
    ;(async () => {
      // Embed the linked consult's triage flags (starred/archived) so the list
      // can sort/filter on them. Falls back to a plain select if those columns
      // don't exist yet (migration not applied) so the list never breaks.
      let { data, error } = await supabase
        .from('conversations')
        .select('*, consult:consults(id, starred, archived)')
        .eq('practice_id', practiceId)
        .order('last_message_at', { ascending: false, nullsFirst: false })
      if (error) {
        const res = await supabase
          .from('conversations')
          .select('*')
          .eq('practice_id', practiceId)
          .order('last_message_at', { ascending: false, nullsFirst: false })
        data = res.data
      }
      if (!active) return
      const rows = data || []
      setConversations(rows)
      setActiveId((cur) => (deepLinkId && rows.some((r) => r.id === deepLinkId) ? deepLinkId : cur || rows[0]?.id || null))
      setLoadingList(false)
    })()
    return () => {
      active = false
    }
  }, [practiceId])

  useEffect(() => {
    if (!activeId) return
    let active = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingThread(true)
    supabase
      .from('conversation_messages')
      .select('*')
      .eq('conversation_id', activeId)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (!active) return
        setThread(data || [])
        setLoadingThread(false)
      })
    // Recordings for this conversation's calls, so call entries can play inline.
    supabase.from('call_logs').select('id, recording_url, duration_seconds, disposition').eq('conversation_id', activeId)
      .then(({ data }) => {
        if (!active) return
        const map = {}
        for (const r of data || []) map[r.id] = r
        setCallRecordings(map)
      })
    auditConversationViewed(activeId)
    auditPatientAccessed(activeId)
    const conv = conversations.find((c) => c.id === activeId)
    if (conv && conv.unread_count > 0) {
      supabase.from('conversations').update({ unread_count: 0 }).eq('id', activeId).then(() => {
        setConversations((prev) => prev.map((c) => (c.id === activeId ? { ...c, unread_count: 0 } : c)))
      })
    }
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  // Live updates when inbound SMS arrives via twilio-inbound webhook.
  useEffect(() => {
    if (!practiceId) return
    const channel = supabase
      .channel(`conversations:${practiceId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'conversation_messages' },
        (payload) => {
          const msg = payload.new
          if (!msg?.conversation_id) return
          if (msg.conversation_id === activeId) {
            setThread((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]))
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'conversations', filter: `practice_id=eq.${practiceId}` },
        (payload) => {
          const row = payload.new
          if (!row?.id) return
          setConversations((prev) => {
            if (prev.some((c) => c.id === row.id)) return prev
            return [row, ...prev].sort(
              (a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0),
            )
          })
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'conversations', filter: `practice_id=eq.${practiceId}` },
        (payload) => {
          const row = payload.new
          if (!row?.id) return
          setConversations((prev) =>
            [...prev.map((c) => (c.id === row.id ? { ...c, ...row } : c))].sort(
              (a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0),
            ),
          )
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [practiceId, activeId])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [thread, loadingThread])

  // Auto-grow the compose box (starts at 2 lines, grows up to ~5), including when
  // AI fills it in.
  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [draft])

  // Load the consult tied to the active conversation's patient (+ its sequence
  // messages) for the right-hand context panel. Prefer the linked consult_id;
  // fall back to matching the patient by phone/email within the practice.
  useEffect(() => {
    const conv = conversations.find((c) => c.id === activeId)
    if (!conv || !practiceId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setConsult(null)
      setConsultMsgs([])
      setLoadingContext(false)
      return
    }
    let active = true
    setLoadingContext(true)
    ;(async () => {
      let row = null
      if (conv.consult_id) {
        const { data } = await supabase.from('consults').select('*').eq('id', conv.consult_id).maybeSingle()
        row = data || null
      }
      if (!row) {
        const ors = []
        if (conv.patient_phone) ors.push(`patient_phone.eq.${conv.patient_phone}`)
        if (conv.patient_email) ors.push(`patient_email.eq.${conv.patient_email}`)
        if (ors.length) {
          const { data } = await supabase
            .from('consults')
            .select('*')
            .eq('practice_id', practiceId)
            .or(ors.join(','))
            .order('created_at', { ascending: false })
            .limit(1)
          row = data?.[0] || null
        }
      }
      if (!active) return
      setConsult(row)
      if (row) {
        const { data: msgs } = await supabase
          .from('messages')
          .select('status, channel, scheduled_for, sent_at, send_day')
          .eq('consult_id', row.id)
        if (!active) return
        setConsultMsgs(msgs || [])
      } else {
        setConsultMsgs([])
      }
      setLoadingContext(false)
    })()
    return () => {
      active = false
    }
  }, [activeId, conversations, practiceId])

  const activeConv = conversations.find((c) => c.id === activeId) || null

  const voice = useTwilioVoiceDevice({ enabled: Boolean(practiceId && activeConv?.patient_phone) })

  useEffect(() => {
    if (voice.callState === 'idle') return
    voice.hangup()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- end call when switching threads
  }, [activeId])
  const lastInbound = [...thread].reverse().find((m) => m.direction === 'inbound')
  const paused = lastInbound && (!thread.length || thread[thread.length - 1].direction === 'inbound')
  const consultPath = activeConv
    ? activeConv.consult_id
      ? `/consults/${activeConv.consult_id}`
      : '/consults'
    : '/consults'

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = conversations.filter((c) => {
      const archived = Boolean(c.consult?.archived)
      // Archived rows only appear under the Archived filter; hidden everywhere else.
      if (filter === 'archived') { if (!archived) return false }
      else if (archived) return false
      if (filter === 'unread' && !(c.unread_count > 0)) return false
      if (q) {
        const hay = `${c.patient_first || ''} ${c.patient_last || ''} ${c.patient_phone || ''} ${c.patient_email || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    // Starred conversations float to the top; stable sort preserves the
    // last_message_at order from the query within each group.
    return [...list].sort((a, b) => (b.consult?.starred ? 1 : 0) - (a.consult?.starred ? 1 : 0))
  }, [conversations, search, filter])

  function updateDraft(value) {
    setDraft(value)
    setAiSuggested(false)
  }

  const isNote = channel === 'note'

  async function resumeSequence() {
    if (!consult?.id) return
    const patch = { sequence_status: 'active', sequence_paused_reason: null, sequence_cancelled_at: null, sequence_cancelled_reason: null }
    await supabase.from('consults').update(patch).eq('id', consult.id)
    setConsult((prev) => (prev ? { ...prev, ...patch } : prev))
    showToast('Sequence resumed')
  }

  // ── Header / row actions ────────────────────────────────────────────────
  // Insert a conversation_message, retrying without `meta` if that column isn't
  // present yet (migration not applied) so call/attachment logging never breaks.
  async function insertConvMessage(row) {
    let res = await supabase.from('conversation_messages').insert(row).select().single()
    if (res.error && row.meta && /meta|column/i.test(res.error.message || '')) {
      const { meta, ...rest } = row // eslint-disable-line no-unused-vars
      res = await supabase.from('conversation_messages').insert(rest).select().single()
    }
    return res
  }

  function bumpConversation(iso, preview) {
    supabase.from('conversations').update({ last_message_at: iso, ...(preview ? { last_message_preview: preview } : {}) }).eq('id', activeId).then(() => {})
    setConversations((prev) =>
      [...prev].map((c) => (c.id === activeId ? { ...c, last_message_at: iso, ...(preview ? { last_message_preview: preview } : {}) } : c))
        .sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0)))
  }

  async function logOutboundVoiceCall({ callSid, seconds: dur }) {
    const nowIso = new Date().toISOString()
    const dateLabel = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    const durLabel = dur > 0 ? ` · ${formatCallTime(dur)}` : ''
    let callLogId = null
    if (callSid) {
      const { data: cl } = await supabase.from('call_logs').select('id, recording_url').eq('twilio_call_sid', callSid).maybeSingle()
      callLogId = cl?.id || null
      await supabase.from('call_logs').update({
        conversation_id: activeId,
        duration_seconds: dur || null,
      }).eq('twilio_call_sid', callSid)
      if (callLogId && cl?.recording_url) {
        setCallRecordings((prev) => ({ ...prev, [callLogId]: { id: callLogId, recording_url: cl.recording_url, duration_seconds: dur } }))
      }
    }
    const body = `📞 Called ${dateLabel}${durLabel}`
    const { data } = await insertConvMessage({
      conversation_id: activeId,
      direction: 'outbound',
      channel: 'call',
      body,
      sent_at: nowIso,
      call_log_id: callLogId,
      meta: { kind: 'call', direction: 'outbound', actor: tcName, duration_sec: dur || null },
    })
    if (data) {
      setThread((prev) => [...prev, data])
      bumpConversation(nowIso, body)
    }
  }

  // In-app Twilio Voice when configured; otherwise device dialer (tel:).
  async function callPatient() {
    const phone = activeConv?.patient_phone
    if (!phone) return showToast('No phone number on file')
    if (voice.callState !== 'idle') return

    if (voice.voiceState !== 'ready') {
      const result = await voice.ensureReady(true)
      if (!result?.ok) {
        const hint = result?.code === 'twilio_voice_not_configured'
          ? 'Set TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, TWILIO_TWIML_APP_SID, and TWILIO_CALLER_ID in Supabase Edge Function secrets.'
          : (result?.error || 'Voice not configured')
        showToast(hint)
        window.open(`tel:${phone}`)
        return
      }
    }

    const started = await voice.placeCall({
      to: phone,
      practiceId,
      consultId: activeConv.consult_id || undefined,
      conversationId: activeId,
      onEnded: logOutboundVoiceCall,
    })
    if (!started) {
      window.open(`tel:${phone}`)
      showToast('Could not place call — try your phone app')
    }
  }

  // Mail icon → Mark as read / unread (reuses conversations.unread_count).
  async function toggleRead() {
    if (!activeConv) return
    const makeUnread = !(activeConv.unread_count > 0)
    const next = makeUnread ? Math.max(1, activeConv.unread_count || 0) : 0
    setConversations((prev) => prev.map((c) => (c.id === activeId ? { ...c, unread_count: next } : c)))
    await supabase.from('conversations').update({ unread_count: next }).eq('id', activeId)
    showToast(makeUnread ? 'Marked as unread' : 'Marked as read')
  }

  // Paperclip: upload a file and post it as a downloadable attachment bubble.
  async function uploadAttachment(file) {
    if (!file || !activeId) return
    if (file.size > 10 * 1024 * 1024) return showToast('File must be under 10MB')
    setUploading(true)
    try {
      const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
      const path = `${activeId}/${Date.now()}.${ext}`
      const up = await supabase.storage.from('conversation-attachments').upload(path, file, { contentType: file.type || undefined, upsert: false })
      if (up.error) throw up.error
      const { data: pub } = supabase.storage.from('conversation-attachments').getPublicUrl(path)
      const nowIso = new Date().toISOString()
      const { data, error } = await insertConvMessage({
        conversation_id: activeId, direction: 'outbound', channel, body: file.name, sent_at: nowIso,
        meta: { attachment: { url: pub.publicUrl, name: file.name, type: file.type || ext } },
      })
      if (error) throw error
      if (data) { setThread((prev) => [...prev, data]); bumpConversation(nowIso, `📎 ${file.name}`) }
      if (!isNote && channel === 'sms') {
        const target = activeConv?.patient_phone
        if (target) supabase.functions.invoke('twilio-send', { body: { practice_id: practiceId, to: target, body: file.name, media_url: pub.publicUrl, conversation_message_id: data?.id } }).catch(() => {})
      }
    } catch (e) {
      showToast(/bucket|not found/i.test(e?.message || '') ? 'Attachments need the conversation-attachments bucket - apply the migration.' : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  // "+ Log call note" inline form save.
  async function logCallNote({ direction, durationMin, outcome, notes }) {
    if (!activeId) return
    const nowIso = new Date().toISOString()
    const summary = [direction === 'inbound' ? 'Inbound call' : 'Outbound call', outcome, durationMin ? `${durationMin} min` : null].filter(Boolean).join(' · ')
    const { data } = await insertConvMessage({
      conversation_id: activeId, direction, channel: 'call', body: notes?.trim() || summary, sent_at: nowIso,
      meta: { kind: 'call', direction, actor: direction === 'inbound' ? (activeConv?.patient_first || 'Patient') : tcName, outcome: outcome || null, duration_min: durationMin || null, note: notes?.trim() || null },
    })
    if (data) { setThread((prev) => [...prev, data]); bumpConversation(nowIso, summary) }
    setLogCallOpen(false)
    showToast('Call logged')
  }

  // Toggle the starred flag on the linked consult (optimistic). Reflects in both
  // the active-consult state and the conversation list (for sort-to-top).
  async function toggleStar(consultId, current) {
    if (!consultId) return showToast('No consult linked to star')
    const next = !current
    setConsult((prev) => (prev && prev.id === consultId ? { ...prev, starred: next } : prev))
    setConversations((prev) => prev.map((c) => (c.consult?.id === consultId ? { ...c, consult: { ...c.consult, starred: next } } : c)))
    await supabase.from('consults').update({ starred: next }).eq('id', consultId)
  }

  async function archiveActive() {
    const cid = consult?.id
    if (!cid) { setConfirmArchive(false); return showToast('No consult linked') }
    const nextConv = visible.find((c) => c.id !== activeId)
    await supabase.from('consults').update({ archived: true }).eq('id', cid)
    setConversations((prev) => prev.map((c) => (c.consult?.id === cid ? { ...c, consult: { ...c.consult, archived: true } } : c)))
    setConsult((prev) => (prev ? { ...prev, archived: true } : prev))
    setActiveId(nextConv ? nextConv.id : null)
    setConfirmArchive(false)
    showToast('Conversation archived')
  }

  function insertEmoji(emoji) {
    setDraft((d) => d + emoji)
    setEmojiOpen(false)
    setAiSuggested(false)
    taRef.current?.focus()
  }

  function fillSnippet(text) {
    const first = activeConv?.patient_first || 'there'
    const doctor = practice?.doctor_last || practice?.doctor_first || 'the doctor'
    setDraft(text.replace(/\[name\]/g, first).replace(/\[doctor\]/g, doctor))
    setSnippetsOpen(false)
    setAiSuggested(false)
    taRef.current?.focus()
  }

  async function handleSend(e) {
    e?.preventDefault?.()
    const body = draft.trim()
    if (!body || !activeId || sending) return
    const isEmail = channel === 'email'
    if (isEmail && !activeConv?.patient_email) {
      showToast('Add a patient email on this conversation or linked consult first.')
      return
    }
    setSending(true)
    const nowIso = new Date().toISOString()
    const subject = isEmail
      ? (emailSubject.trim() || `Message from ${practice?.name || 'your care team'}`)
      : null
    const meta = isEmail ? { subject } : {}
    const { data, error } = await supabase
      .from('conversation_messages')
      .insert({
        conversation_id: activeId,
        direction: 'outbound',
        channel,
        body,
        sent_at: nowIso,
        meta,
      })
      .select()
      .single()
    if (!error && data) {
      setThread((prev) => [...prev, { ...data, status: 'sent' }])
      setDraft('')
      setEmailSubject('')
      setAiSuggested(false)
      auditMessageSent(activeId)
      // Internal notes are practice-only: never dispatched to the patient.
      if (!isNote) {
        // Fire the real sender (no-op/queued if Twilio/Mailgun unconfigured).
        const fn = isEmail ? 'mailgun-send' : 'twilio-send'
        const target = isEmail ? activeConv?.patient_email : activeConv?.patient_phone
        if (target) {
          supabase.functions.invoke(fn, {
            body: {
              practice_id: practiceId,
              to: target,
              body,
              subject,
              conversation_message_id: data.id,
              consult_id: activeConv?.consult_id,
            },
          }).catch(() => showToast('Could not send — check messaging settings.'))
        }
      }
      await supabase.from('conversations').update({ last_message_at: nowIso }).eq('id', activeId)
      setConversations((prev) =>
        [...prev].map((c) => (c.id === activeId ? { ...c, last_message_at: nowIso } : c)).sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0))
      )
    }
    setSending(false)
  }

  function suggestReply() {
    setSuggesting(true)
    // Lightweight context-aware suggestion (no network dependency required).
    setTimeout(() => {
      const name = activeConv?.patient_first || 'there'
      const text = lastInbound
        ? `Thanks so much for getting back to me, ${name}! I'd love to find a time that works. Would a quick call this week help, or would you prefer I text you a couple of openings?`
        : `Hi ${name}, just checking in to see if any questions came up about your treatment plan. Happy to help however I can.`
      setDraft(text)
      setAiSuggested(true)
      setSuggesting(false)
      taRef.current?.focus()
    }, 700)
  }

  if (!loadingList && conversations.length === 0) {
    return (
      <div className="h-full space-y-6 overflow-y-auto p-4 sm:p-6 lg:p-8">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">Conversations</h1>
        <EmptyState
          icon={MessagesSquare}
          title="No conversations yet"
          description="CaseLift will create one when a patient replies. New threads open here automatically."
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* List */}
      <aside className={`${activeId ? 'hidden md:flex' : 'flex'} w-full shrink-0 flex-col border-r border-gray-200 bg-white md:w-[300px]`}>
        <div className="shrink-0 border-b border-gray-200 p-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search"
                className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-3 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <Link
              to="/conversations/dialer"
              title="Power Dialer"
              aria-label="Power Dialer"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-2.5 py-2 text-xs font-semibold !text-white transition hover:bg-primary-700"
            >
              <Phone className="h-4 w-4" /> Dialer
            </Link>
            <button
              type="button"
              title="Sort and filter"
              aria-label="Sort and filter"
              className="shrink-0 rounded-lg border border-gray-200 p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
            >
              <SlidersHorizontal className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-2 flex gap-1">
            {[['all', 'All'], ['unread', 'Unread'], ['active', 'Active'], ['archived', 'Archived']].map(([k, label]) => (
              <button key={k} onClick={() => setFilter(k)} className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition ${filter === k ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Select-all (bulk actions placeholder) */}
        <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 px-3 py-2">
          <input type="checkbox" aria-label="Select all conversations" className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500/30" />
          <span className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Select all</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loadingList ? (
            <SkeletonList rows={6} />
          ) : (
            visible.map((c) => {
              const isActive = c.id === activeId
              const unread = c.unread_count > 0
              const rowBg = isActive
                ? 'border-blue-500 bg-blue-50'
                : 'border-transparent hover:bg-gray-50'
              return (
                <div
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setActiveId(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setActiveId(c.id)
                    }
                  }}
                  className={`group flex w-full cursor-pointer items-center gap-2.5 border-l-[3px] px-3 py-3 text-left transition ${rowBg}`}
                >
                  {/* Bulk-action checkbox (non-functional placeholder) */}
                  <input
                    type="checkbox"
                    aria-label="Select conversation"
                    onClick={(e) => e.stopPropagation()}
                    className="h-3.5 w-3.5 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500/30"
                  />
                  <div className="relative shrink-0">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-full text-xs font-semibold text-white ${avatarColor(`${c.patient_first || ''}${c.patient_last || ''}`)}`}>
                      {initials(c.patient_first, c.patient_last)}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <Link
                          to={c.consult_id ? `/consults/${c.consult_id}` : '/consults'}
                          onClick={(e) => e.stopPropagation()}
                          className={`truncate text-sm hover:underline ${unread ? 'font-bold text-gray-900' : 'font-semibold text-gray-800'}`}
                        >
                          {c.patient_first} {c.patient_last}
                        </Link>
                        {c.reactivation_campaign_id && (
                          <span title="Replied to a reactivation campaign" className="inline-flex shrink-0 items-center rounded-full bg-primary/10 p-0.5 text-primary">
                            <Megaphone className="h-3 w-3" />
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs text-gray-400">{timeAgo(c.last_message_at)}</span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <p className={`truncate text-sm ${unread ? 'font-medium text-gray-700' : 'text-gray-500'}`}>
                        {c.last_message_preview || c.patient_phone || c.patient_email}
                      </p>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {/* Favorite - solid + always visible when starred. */}
                        <button
                          type="button"
                          title={c.consult?.starred ? 'Unstar conversation' : 'Star conversation'}
                          aria-label="Star conversation"
                          aria-pressed={Boolean(c.consult?.starred)}
                          onClick={(e) => { e.stopPropagation(); toggleStar(c.consult?.id, Boolean(c.consult?.starred)) }}
                          className={`transition ${c.consult?.starred ? 'text-amber-400 opacity-100' : 'text-gray-300 opacity-0 hover:text-amber-400 group-hover:opacity-100'}`}
                        >
                          <Star className={`h-4 w-4 ${c.consult?.starred ? 'fill-current' : ''}`} />
                        </button>
                        {unread && (
                          <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-blue-600 px-1.5 text-[11px] font-semibold !text-white">
                            {c.unread_count}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </aside>

      {/* Thread */}
      <section className={`${activeId ? 'flex' : 'hidden md:flex'} min-h-0 min-w-0 flex-1 flex-col bg-white`}>
        {activeConv ? (
          <>
            <div className="shrink-0 border-b border-gray-200 bg-white px-4 py-3">
              <div className="flex items-center gap-3">
                <button onClick={() => setActiveId(null)} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 md:hidden">
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <div className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white ${avatarColor(`${activeConv.patient_first || ''}${activeConv.patient_last || ''}`)}`}>
                  {initials(activeConv.patient_first, activeConv.patient_last)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link to={consultPath} className="truncate text-lg font-semibold text-gray-900 underline-offset-2 hover:underline">
                      {activeConv.patient_first} {activeConv.patient_last}
                    </Link>
                    {activeConv.reactivation_campaign_id && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary-700">
                        <Megaphone className="h-3 w-3" /> Reactivation
                      </span>
                    )}
                  </div>
                  <p className="flex items-center gap-1.5 truncate text-sm text-gray-500">
                    <Phone className="h-3.5 w-3.5" /> {activeConv.patient_phone || activeConv.patient_email}
                  </p>
                </div>

                {/* Action buttons */}
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={callPatient}
                    disabled={voice.callState !== 'idle'}
                    title={voice.voiceState === 'unavailable' ? 'Call (device phone)' : 'Call in browser'}
                    aria-label="Call"
                    className="hidden rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 disabled:opacity-40 sm:inline-flex"
                  >
                    {voice.callState !== 'idle' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleStar(consult?.id, Boolean(consult?.starred))}
                    title={consult?.starred ? 'Unstar' : 'Star'}
                    aria-label="Star"
                    aria-pressed={Boolean(consult?.starred)}
                    className={`hidden rounded-md p-1.5 transition hover:bg-gray-100 sm:inline-flex ${consult?.starred ? 'text-amber-500' : 'text-gray-400 hover:text-amber-500'}`}
                  >
                    <Star className={`h-4 w-4 ${consult?.starred ? 'fill-current' : ''}`} />
                  </button>
                  <button
                    type="button"
                    onClick={toggleRead}
                    title={activeConv.unread_count > 0 ? 'Mark as read' : 'Mark as unread'}
                    aria-label="Toggle read"
                    className="hidden rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 sm:inline-flex"
                  >
                    {activeConv.unread_count > 0 ? <MailOpen className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
                  </button>
                  <button type="button" onClick={() => setConfirmArchive(true)} title="Archive" aria-label="Archive" className="hidden rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-red-500 sm:inline-flex">
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <Link
                    to={consultPath}
                    title="View Consult"
                    className="ml-1 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50 hover:text-gray-900"
                  >
                    <FileText className="h-3.5 w-3.5" /> View Consult
                  </Link>
                  {/* Re-expand the contact-details panel (only shown while collapsed). */}
                  {panelCollapsed && (
                    <button
                      onClick={togglePanel}
                      title="Show contact details"
                      aria-label="Show contact details"
                      className="hidden shrink-0 rounded-lg border border-gray-200 bg-white p-1.5 text-gray-500 transition hover:bg-gray-50 hover:text-gray-700 lg:inline-flex"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
              {/* PMS slim bar */}
              {activeConv.case_value > 0 && (
                <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-500">
                  Tx Plan: <span className="font-semibold text-gray-900">{formatMoney(activeConv.case_value)}</span> · Status: Pending acceptance
                </div>
              )}
            </div>

            {voice.callState !== 'idle' && (
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-emerald-200 bg-emerald-50 px-4 py-2">
                <span className="flex items-center gap-2 text-sm font-medium text-emerald-800">
                  {voice.callState === 'in_call' ? (
                    <>
                      <Circle className="h-2 w-2 animate-pulse fill-rose-500 text-rose-500" />
                      Recording · {formatCallTime(voice.seconds)}
                    </>
                  ) : (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
                      {voice.callState === 'ringing' ? 'Ringing…' : 'Connecting…'}
                    </>
                  )}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={voice.toggleMute}
                    disabled={voice.callState !== 'in_call'}
                    className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-white px-2.5 py-1 text-xs font-medium text-emerald-900 disabled:opacity-40"
                  >
                    {voice.muted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                    {voice.muted ? 'Unmute' : 'Mute'}
                  </button>
                  <button
                    type="button"
                    onClick={voice.hangup}
                    className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-rose-500"
                  >
                    <PhoneOff className="h-3.5 w-3.5" /> End call
                  </button>
                </div>
              </div>
            )}

            {consult?.sequence_status === 'paused' && (
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-[11px] font-medium text-amber-700">
                <span className="flex min-w-0 items-center gap-1.5">
                  <PauseCircle className="h-3.5 w-3.5 shrink-0" />
                  {consult.sequence_paused_reason === 'reply'
                    ? 'CaseLift paused this sequence - patient replied. Resume or close this conversation.'
                    : 'Sequence paused - messages won’t send until resumed.'}
                </span>
                <button onClick={resumeSequence} className="shrink-0 rounded-md border border-amber-300 px-2 py-0.5 font-semibold text-amber-800 transition hover:bg-amber-100">
                  Resume
                </button>
              </div>
            )}

            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-white px-4 py-2">
              {loadingThread ? (
                <div className="py-8 text-center text-sm text-gray-500">Loading messages...</div>
              ) : (
                thread.map((m, i) => {
                  const outbound = m.direction === 'outbound'
                  const ts = m.sent_at || m.created_at
                  const prev = thread[i - 1]
                  const next = thread[i + 1]
                  const prevTs = prev ? prev.sent_at || prev.created_at : null
                  const newDay = !prevTs || new Date(ts).toDateString() !== new Date(prevTs).toDateString()

                  // Internal notes: amber, left-aligned, standalone block.
                  if (m.channel === 'note') {
                    return (
                      <Fragment key={m.id}>
                        {newDay && (
                          <div className="flex justify-center pb-2 pt-3">
                            <span className="rounded-full bg-gray-100 px-3 py-1 text-[11px] font-medium text-gray-500">{dayLabel(ts)}</span>
                          </div>
                        )}
                        <div className="mt-2.5 flex justify-start">
                          <div className="max-w-[80%] rounded-[14px] border border-amber-200 bg-amber-50 px-3 py-2">
                            <p className="mb-0.5 text-[11px] font-semibold text-amber-700">📌 Internal note</p>
                            <p className="whitespace-pre-wrap text-sm leading-snug text-amber-900">{cleanBody(m.body)}</p>
                            <p className="mt-1 text-[10px] text-amber-600/80">{messageTime(ts)}</p>
                          </div>
                        </div>
                      </Fragment>
                    )
                  }

                  // Call events: GHL-style aligned bubbles with inline recording player.
                  if (m.channel === 'call') {
                    const inbound = m.direction === 'inbound'
                    const recMeta = m.call_log_id ? callRecordings[m.call_log_id] : null
                    const hasRecording = Boolean(recMeta?.recording_url)
                    const seed = `${activeConv.patient_first || ''}${activeConv.patient_last || ''}`
                    return (
                      <Fragment key={m.id}>
                        {newDay && (
                          <div className="flex justify-center pb-2 pt-3">
                            <span className="rounded-full bg-gray-100 px-3 py-1 text-[11px] font-medium text-gray-500">{dayLabel(ts)}</span>
                          </div>
                        )}
                        <div className={`mt-2.5 ${inbound ? '' : 'flex justify-end'}`}>
                          <CallMessageBubble
                            inbound={inbound}
                            sentAt={ts}
                            callLogId={m.call_log_id}
                            hasRecording={hasRecording}
                            recordingDuration={recMeta?.duration_seconds}
                            patientFirst={activeConv.patient_first}
                            patientLast={activeConv.patient_last}
                            avatarClass={avatarColor(seed)}
                            patientInitials={initials(activeConv.patient_first, activeConv.patient_last)}
                            meta={m.meta}
                          />
                        </div>
                      </Fragment>
                    )
                  }

                  const nextTs = next ? next.sent_at || next.created_at : null
                  const nextNewDay = !nextTs || new Date(nextTs).toDateString() !== new Date(ts).toDateString()
                  const gapBefore = prevTs ? new Date(ts) - new Date(prevTs) : Infinity
                  const gapAfter = nextTs ? new Date(nextTs) - new Date(ts) : Infinity
                  // Cluster = consecutive messages, same sender, within the gap window.
                  const clusterStart = !prev || prev.direction !== m.direction || prev.channel === 'note' || gapBefore > CLUSTER_GAP_MS || newDay
                  const clusterEnd = !next || next.direction !== m.direction || next.channel === 'note' || gapAfter > CLUSTER_GAP_MS || nextNewDay
                  // Tail (4px corner) on the first and last bubble of a cluster; middle bubbles are fully round.
                  const tail = clusterStart || clusterEnd
                  // Shared timestamp only after a cluster that's followed by a real time gap (or is the last message).
                  const showTime = clusterEnd && (!next || gapAfter > CLUSTER_GAP_MS)
                  const radius = outbound
                    ? `rounded-[18px]${tail ? ' rounded-br-[4px]' : ''}`
                    : `rounded-[18px]${tail ? ' rounded-bl-[4px]' : ''}`
                  return (
                    <Fragment key={m.id}>
                      {newDay && (
                        <div className="flex justify-center pb-2 pt-3">
                          <span className="rounded-full bg-gray-100 px-3 py-1 text-[11px] font-medium text-gray-500">
                            {dayLabel(ts)}
                          </span>
                        </div>
                      )}
                      <div className={`flex ${clusterStart && !newDay ? 'mt-2.5' : 'mt-[2px]'} ${outbound ? 'justify-end' : 'justify-start'}`}>
                        <div className="max-w-[65%]">
                          {/* Sender name above the first bubble of each cluster (GHL style). */}
                          {clusterStart && (
                            <p className={`mb-0.5 px-1 text-[11px] text-gray-400 ${outbound ? 'text-right' : 'text-left'}`}>
                              {outbound ? tcName : (activeConv.patient_first || 'Patient')}
                            </p>
                          )}
                          {m.channel === 'email' && (m.meta?.subject || m.subject) && clusterStart && (
                            <p className={`mb-1 text-xs font-semibold text-gray-500 ${outbound ? 'text-right' : ''}`}>
                              {cleanBody(m.meta?.subject || m.subject)}
                            </p>
                          )}
                          {/* Bubble bg is fixed in both themes, so set text via an arbitrary
                              color utility - plain `text-white` gets flipped dark by the
                              light-mode override in index.css. */}
                          {m.meta?.attachment ? (
                            <a
                              href={m.meta.attachment.url}
                              target="_blank"
                              rel="noreferrer"
                              download
                              className={`flex items-center gap-2 px-3.5 py-2.5 ${radius} ${outbound ? 'bg-[var(--accent)] text-[#fff]' : 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'}`}
                            >
                              <Download className="h-4 w-4 shrink-0 opacity-80" />
                              <span className="truncate text-sm font-medium underline-offset-2 hover:underline">{m.meta.attachment.name || 'Attachment'}</span>
                            </a>
                          ) : (
                            <div className={`px-3.5 py-2 text-[15px] leading-snug ${radius} ${outbound ? 'bg-[var(--accent)] text-[#fff]' : 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'}`}>
                              <p className="whitespace-pre-wrap">{cleanBody(m.body)}</p>
                            </div>
                          )}
                          {m.meta?.attachment && m.channel === 'sms' && (
                            <p className={`mt-0.5 px-1 text-[10px] text-gray-400 ${outbound ? 'text-right' : 'text-left'}`}>(MMS - carrier charges may apply)</p>
                          )}
                        </div>
                      </div>
                      {showTime && (
                        <div
                          className="flex justify-center pb-0.5 pt-1.5 text-[11px] text-gray-500"
                          title={outbound ? `CaseLift sent this message on ${dayLabel(ts)}` : undefined}
                        >
                          {messageTime(ts)}
                        </div>
                      )}
                    </Fragment>
                  )
                })
              )}
            </div>

            <form onSubmit={handleSend} className="shrink-0 border-t border-gray-200 bg-white p-3">
              {aiSuggested && draft.trim() && (
                <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] font-medium text-blue-600">
                  <Sparkles className="h-3 w-3" /> CaseLift recommended
                </div>
              )}
              {channel === 'email' && !activeConv?.patient_email && (
                <p className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  This conversation has no patient email — add one on the consult or contact panel before sending.
                </p>
              )}
              <div className="flex flex-col gap-2">
                {channel === 'email' && (
                  <input
                    type="text"
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                    placeholder="Email subject"
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                )}
              <div className="flex items-start gap-2">
                {/* Channel selector: SMS / Email / Note */}
                <select
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                  aria-label="Message channel"
                  className="mt-px shrink-0 rounded-lg border border-gray-200 bg-white px-2 py-2.5 text-xs font-medium text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="sms">SMS</option>
                  <option value="email">Email</option>
                  <option value="note">Note</option>
                </select>

                <textarea
                  ref={taRef}
                  value={draft}
                  onChange={(e) => updateDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e) } }}
                  rows={2}
                  placeholder={isNote ? 'Add an internal note (not sent to the patient)' : 'Message'}
                  className={`min-h-[56px] max-h-32 flex-1 resize-none overflow-y-auto rounded-2xl border px-4 py-2.5 text-[15px] text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 ${isNote ? 'border-amber-300 bg-amber-50/40 focus:border-amber-400 focus:ring-amber-500/20' : 'border-gray-200 bg-white focus:border-blue-400 focus:ring-blue-500/20'}`}
                />
              </div>
              </div>

              {/* Toolbar: placeholders on the left, AI Suggest + Send on the right */}
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="relative flex items-center gap-0.5 text-gray-400">
                  <button type="button" onClick={() => { setEmojiOpen((v) => !v); setSnippetsOpen(false) }} title="Emoji" aria-label="Emoji" className={`rounded-md p-1.5 transition hover:bg-gray-100 hover:text-gray-600 ${emojiOpen ? 'bg-gray-100 text-gray-600' : ''}`}>
                    <Smile className="h-4 w-4" />
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,.pdf,.doc,.docx"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAttachment(f); e.target.value = '' }}
                  />
                  <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} title="Attach file" aria-label="Attach file" className="rounded-md p-1.5 transition hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50">
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                  </button>
                  <button type="button" onClick={() => { setSnippetsOpen((v) => !v); setEmojiOpen(false) }} title="Snippets" aria-label="Snippets" className={`inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs transition hover:bg-gray-100 hover:text-gray-600 ${snippetsOpen ? 'bg-gray-100 text-gray-600' : ''}`}>
                    <ScrollText className="h-4 w-4" /> Snippets
                  </button>

                  {/* Emoji picker */}
                  {emojiOpen && (
                    <div className="absolute bottom-full left-0 z-20 mb-2 grid grid-cols-4 gap-1 rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
                      {QUICK_EMOJIS.map((e) => (
                        <button key={e} type="button" onClick={() => insertEmoji(e)} className="flex h-9 w-9 items-center justify-center rounded-lg text-xl transition hover:bg-gray-100">
                          {e}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Snippets / templates */}
                  {snippetsOpen && (
                    <div className="absolute bottom-full left-0 z-20 mb-2 w-72 rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
                      <div className="flex items-center justify-between px-1 pb-1">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Templates</span>
                        <button type="button" onClick={() => setSnippetsOpen(false)} aria-label="Close templates" className="rounded p-0.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {SNIPPETS.map((s, i) => (
                        <button key={i} type="button" onClick={() => fillSnippet(s)} className="block w-full rounded-lg px-2 py-2 text-left text-xs leading-snug text-gray-600 transition hover:bg-gray-50">
                          {s.replace(/\[name\]/g, activeConv?.patient_first || 'name').replace(/\[doctor\]/g, practice?.doctor_last || 'doctor')}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {/* AI Suggest Reply, outlined */}
                  <button
                    type="button"
                    onClick={suggestReply}
                    disabled={suggesting}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
                  >
                    {suggesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    <span className="hidden md:inline">{suggesting ? 'CaseLift is suggesting a reply…' : 'Ask CaseLift to reply'}</span>
                  </button>

                  {/* Send / Add Note */}
                  <button
                    type="submit"
                    disabled={!draft.trim() || sending}
                    className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold !text-white transition disabled:opacity-50 ${isNote ? 'bg-amber-500 hover:bg-amber-600' : 'bg-primary hover:bg-primary-700'}`}
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    <span className="hidden sm:inline">{isNote ? 'Add Note' : 'Send'}</span>
                  </button>
                </div>
              </div>

              {/* Log a call note (manual call event) */}
              {logCallOpen ? (
                <LogCallForm onCancel={() => setLogCallOpen(false)} onSave={logCallNote} />
              ) : (
                <button type="button" onClick={() => setLogCallOpen(true)} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-gray-500 transition hover:text-gray-700">
                  <PhoneCall className="h-3.5 w-3.5" /> + Log call note
                </button>
              )}
            </form>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-center">
            <div>
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100 text-gray-400">
                <MessagesSquare className="h-8 w-8" />
              </div>
              <p className="mt-4 text-sm text-gray-500">Select a conversation to view messages</p>
            </div>
          </div>
        )}
      </section>

      {/* Contact details (right panel) - only when a thread is open and not collapsed */}
      {activeConv && !panelCollapsed && (
        <PatientContextPanel
          consult={consult}
          conv={activeConv}
          msgs={consultMsgs}
          loading={loadingContext}
          paused={paused}
          onCollapse={togglePanel}
          onStartRecording={() => openRecorder()}
          onConsultChange={(patch) => setConsult((prev) => (prev ? { ...prev, ...patch } : prev))}
          onConvChange={(patch) => setConversations((prev) => prev.map((c) => (c.id === activeId ? { ...c, ...patch } : c)))}
          onAddThreadMessage={(m) => setThread((prev) => [...prev, m])}
        />
      )}

      {/* Archive confirmation */}
      {confirmArchive && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirmArchive(false)} />
          <div className="relative z-10 w-full max-w-sm rounded-xl border border-gray-200 bg-white p-5 shadow-2xl">
            <h3 className="text-sm font-semibold text-gray-900">Archive this conversation?</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-500">
              The patient record and consult history will be preserved. You can find archived
              conversations under the Archived filter.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setConfirmArchive(false)} className="rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={archiveActive} className="rounded-lg bg-red-600 px-3.5 py-2 text-sm font-semibold !text-white transition hover:bg-red-700">
                Archive
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transient toast */}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[90] flex justify-center px-4">
          <div className="pointer-events-auto rounded-full bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-lg">
            {toast}
          </div>
        </div>
      )}
    </div>
  )
}
