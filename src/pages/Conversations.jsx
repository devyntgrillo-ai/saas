import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import {
  MessagesSquare,
  Mail,
  MailOpen,
  Send,
  ArrowLeft,
  Phone,
  Mic,
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
import {
  useConversationsList,
  useConversationThread,
  useConversationContext,
  useMarkConversationRead,
  useToggleConversationRead,
  useUpdateConsultFlags,
  useUpdateConversationPatient,
  useAddConversationNote,
  useSendThreadMessage,
  useUploadConversationAttachment,
  patchConversationContextConsult,
  insertConvMessage,
  useConversationsRealtime,
  useToggleSequenceStatus,
  useMarkConsultConverted,
  useMarkConsultNotConverting,
  queryKeys,
} from '../lib/queries'
import { invokeEdgeFunction } from '../lib/messaging'
import { stripEmDashes } from '../lib/sanitize'
import { formatDate, formatDuration } from '../lib/consults'
import { auditConversationViewed, auditPatientAccessed, auditMessageSent } from '../lib/audit'
import { SkeletonList } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import { formatMoney } from '../lib/analytics'
import { formatCallTime } from '../lib/voice'
import { useVoice } from '../context/VoiceContext'
import CallMessageBubble from '../components/CallMessageBubble'
import ConversationThreadCard from '../components/ConversationThreadCard'
import EmailComposer from '../components/EmailComposer'
import { buildThreadRenderList, renderItemTimestamp, threadStartedByPatient } from '../lib/conversationThread'
import ChannelToggle from '../components/ChannelToggle'

function initials(first, last) {
  return `${(first || '?')[0]}${(last || '')[0] || ''}`.toUpperCase()
}

function emailInitials(email) {
  const local = (email || '?').split('@')[0] || '?'
  const parts = local.replace(/[^a-zA-Z0-9]/g, ' ').trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return local.slice(0, 2).toUpperCase()
}

function isEmailConversation(c) {
  return c?.last_channel === 'email'
}

// Short date for inbox rows, e.g. "Jun 5".
function listDateLabel(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
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
  return String(text).replace(/\s*, \s*/g, ', ')
}

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
function PatientContextPanel({ practiceId, consult, conv, msgs, loading, paused, patientSaving, onCollapse, onStartRecording, onConsultChange, onSavePatient, onPatientSaveError, onAddThreadMessage }) {
  const toggleSequenceMutation = useToggleSequenceStatus()
  const markConvertedMutation = useMarkConsultConverted()
  const markNotConvertingMutation = useMarkConsultNotConverting()
  const addNoteMutation = useAddConversationNote()
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [showConvert, setShowConvert] = useState(false)
  const [convertValue, setConvertValue] = useState('')
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    let first = conv?.patient_first || consult?.patient_first || ''
    let last = conv?.patient_last || consult?.patient_last || ''
    if (!first && !last && consult?.patient_name) {
      const parts = String(consult.patient_name).trim().split(/\s+/)
      first = parts[0] || ''
      last = parts.slice(1).join(' ') || ''
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm({
      patient_first: first,
      patient_last: last,
      patient_phone: conv?.patient_phone || consult?.patient_phone || '',
      patient_email: conv?.patient_email || consult?.patient_email || '',
    })
    setEditing(false)
  }, [conv?.id, consult?.id])

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

  const fullName =
    [conv?.patient_first, conv?.patient_last].filter(Boolean).join(' ')
    || consult?.patient_name
    || [consult?.patient_first, consult?.patient_last].filter(Boolean).join(' ')
    || 'Patient'

  async function savePatient() {
    if (!conv?.id || !onSavePatient || patientSaving) return
    const patch = {
      patient_first: form.patient_first.trim() || null,
      patient_last: form.patient_last.trim() || null,
      patient_phone: form.patient_phone.trim() || null,
      patient_email: form.patient_email.trim() || null,
    }
    try {
      await onSavePatient(patch, conv.consult_id || consult?.id || null)
      setEditing(false)
    } catch (e) {
      onPatientSaveError?.(e?.message || 'Could not save patient details')
    }
  }

  function cancelPatientEdit() {
    let first = conv?.patient_first || consult?.patient_first || ''
    let last = conv?.patient_last || consult?.patient_last || ''
    if (!first && !last && consult?.patient_name) {
      const parts = String(consult.patient_name).trim().split(/\s+/)
      first = parts[0] || ''
      last = parts.slice(1).join(' ') || ''
    }
    setForm({
      patient_first: first,
      patient_last: last,
      patient_phone: conv?.patient_phone || consult?.patient_phone || '',
      patient_email: conv?.patient_email || consult?.patient_email || '',
    })
    setEditing(false)
  }

  function toggleSequence() {
    if (!consult?.id || toggleSequenceMutation.isPending) return
    const patch = seqPaused
      ? { sequence_status: 'active', sequence_paused_reason: null, sequence_cancelled_at: null, sequence_cancelled_reason: null }
      : { sequence_status: 'paused', sequence_paused_reason: 'manual' }
    toggleSequenceMutation.mutate(
      { consultId: consult.id, patch, practiceId },
      { onSuccess: () => onConsultChange?.(patch) },
    )
  }

  function markConverted() {
    if (!consult?.id || markConvertedMutation.isPending) return
    markConvertedMutation.mutate(
      {
        consultId: consult.id,
        practiceId,
        conversationId: conv?.id,
        caseValue: convertValue,
        patientName: fullName,
      },
      {
        onSuccess: ({ patch }) => {
          onConsultChange?.(patch)
          setShowConvert(false)
          setConvertValue('')
        },
      },
    )
  }

  function markNotConverting() {
    if (!consult?.id || markNotConvertingMutation.isPending) return
    markNotConvertingMutation.mutate(
      { consultId: consult.id, practiceId, conversationId: conv?.id },
      { onSuccess: ({ patch }) => onConsultChange?.(patch) },
    )
  }

  function addNote() {
    const body = note.trim()
    if (!body || !conv?.id || addNoteMutation.isPending) return
    addNoteMutation.mutate(
      { conversationId: conv.id, practiceId, body },
      {
        onSuccess: ({ message }) => {
          if (message) onAddThreadMessage?.(message)
          setNote('')
          setNoteOpen(false)
        },
      },
    )
  }

  const seqBusy = toggleSequenceMutation.isPending && toggleSequenceMutation.variables?.consultId === consult?.id
  const convertBusy = markConvertedMutation.isPending && markConvertedMutation.variables?.consultId === consult?.id
  const notConvBusy = markNotConvertingMutation.isPending && markNotConvertingMutation.variables?.consultId === consult?.id
  const noteBusy = addNoteMutation.isPending

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
                    <input value={form.patient_first} onChange={(e) => setForm((f) => ({ ...f, patient_first: e.target.value }))} placeholder="First" className="input py-1 text-sm" />
                    <input value={form.patient_last} onChange={(e) => setForm((f) => ({ ...f, patient_last: e.target.value }))} placeholder="Last" className="input py-1 text-sm" />
                  </div>
                  <input value={form.patient_phone} onChange={(e) => setForm((f) => ({ ...f, patient_phone: e.target.value }))} placeholder="Phone" className="input py-1 text-sm" />
                  <input value={form.patient_email} onChange={(e) => setForm((f) => ({ ...f, patient_email: e.target.value }))} placeholder="Email" className="input py-1 text-sm" />
                  <div className="flex justify-end gap-2 pt-1">
                    <button type="button" onClick={cancelPatientEdit} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
                    <button onClick={savePatient} disabled={patientSaving} className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-700 disabled:opacity-50">
                      {patientSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Save
                    </button>
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
                <button onClick={toggleSequence} disabled={seqBusy} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-50">
                  {seqBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : seqPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
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
                          <button onClick={markConverted} disabled={convertBusy} className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 disabled:opacity-50">
                            {convertBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => setShowConvert(true)} className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-emerald-700 transition hover:bg-emerald-50"><CheckCircle2 className="h-4 w-4" /> Mark as converted</button>
                    )}
                    <button onClick={markNotConverting} disabled={notConvBusy} className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-50">
                      {notConvBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Not converting
                    </button>
                  </>
                )}
                {noteOpen ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-2">
                    <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Internal note…" rows={2} className="w-full resize-none rounded border border-amber-200 px-2 py-1 text-sm" />
                    <div className="mt-2 flex justify-end gap-2">
                      <button onClick={() => { setNoteOpen(false); setNote('') }} className="text-xs text-gray-500">Cancel</button>
                      <button onClick={addNote} disabled={noteBusy} className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 disabled:opacity-50">
                        {noteBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Save note
                      </button>
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

export default function Conversations() {
  const { practiceId, practice, user, profile } = useAuth()
  const [searchParams] = useSearchParams()
  const deepLinkId = searchParams.get('c')
  const queryClient = useQueryClient()
  const [activeId, setActiveId] = useState(deepLinkId || null)
  const { data: conversations = [], isLoading: loadingList } = useConversationsList(practiceId)
  const { data: threadData, isLoading: loadingThread } = useConversationThread(practiceId, activeId)
  const thread = threadData?.messages ?? []
  const callRecordings = threadData?.callRecordings ?? {}
  const markReadMutation = useMarkConversationRead()
  const toggleReadMutation = useToggleConversationRead()
  const updateConsultFlags = useUpdateConsultFlags()
  const updateConversationPatient = useUpdateConversationPatient()
  const sendThreadMutation = useSendThreadMessage()
  const [draft, setDraft] = useState('')
  const [aiSuggested, setAiSuggested] = useState(false)
  const [channel, setChannel] = useState('sms')
  const [emailSubject, setEmailSubject] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all') // all | unread | active
  const [suggesting, setSuggesting] = useState(false)
  // Patient-context panel state.
  const { openRecorder } = useRecorder()
  const activeConv = conversations.find((c) => c.id === activeId) || null
  const activeIsEmail = isEmailConversation(activeConv)
  const { data: contextData, isLoading: loadingContext } = useConversationContext(practiceId, activeConv)
  const consult = contextData?.consult ?? null
  const consultMsgs = contextData?.consultMsgs ?? []
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
  const uploadAttachmentMutation = useUploadConversationAttachment()
  const [channelMenuOpen, setChannelMenuOpen] = useState(false)
  const [emailComposerExpanded, setEmailComposerExpanded] = useState(false)
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

  useConversationsRealtime(practiceId, activeId)

  useEffect(() => {
    if (!conversations.length) return
    setActiveId((cur) =>
      deepLinkId && conversations.some((r) => r.id === deepLinkId)
        ? deepLinkId
        : cur || conversations[0]?.id || null,
    )
  }, [conversations, deepLinkId])

  useEffect(() => {
    if (!activeId) return
    auditConversationViewed(activeId)
    auditPatientAccessed(activeId)
  }, [activeId])

  useEffect(() => {
    if (!activeId || !activeConv || !(activeConv.unread_count > 0) || !practiceId) return
    markReadMutation.mutate({ practiceId, conversationId: activeId })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, activeConv?.unread_count, practiceId])

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


  const voice = useVoice()

  useEffect(() => {
    if (voice.callState === 'idle') return
    voice.hangup()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- end call when switching threads
  }, [activeId])
  const threadRenderItems = useMemo(() => buildThreadRenderList(thread), [thread])
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

  function refetchConv() {
    queryClient.invalidateQueries({ queryKey: queryKeys.conversations(practiceId) })
    if (activeId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.conversationThread(practiceId, activeId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.conversationContext(practiceId, activeId) })
    }
  }

  async function saveConversationPatient(patch, consultId) {
    if (!practiceId || !activeId) return
    await updateConversationPatient.mutateAsync({
      practiceId,
      conversationId: activeId,
      consultId,
      patch,
    })
    showToast('Patient details saved')
  }

  async function resumeSequence() {
    if (!consult?.id) return
    const patch = { sequence_status: 'active', sequence_paused_reason: null, sequence_cancelled_at: null, sequence_cancelled_reason: null }
    await updateConsultFlags.mutateAsync({ consultId: consult.id, patch, practiceId })
    showToast('Sequence resumed')
  }

  function bumpConversation(iso, preview) {
    supabase
      .from('conversations')
      .update({ last_message_at: iso, ...(preview ? { last_message_preview: preview } : {}) })
      .eq('id', activeId)
      .then(() => refetchConv())
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
    }
    const body = `📞 Called ${dateLabel}${durLabel}`
    await insertConvMessage({
      conversation_id: activeId,
      direction: 'outbound',
      channel: 'call',
      body,
      sent_at: nowIso,
      call_log_id: callLogId,
      meta: { kind: 'call', direction: 'outbound', actor: tcName, duration_sec: dur || null },
    })
    bumpConversation(nowIso, body)
    refetchConv()
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
      showToast('Could not place call, try your phone app')
    }
  }

  // Mail icon → Mark as read / unread (reuses conversations.unread_count).
  function toggleRead() {
    if (!activeConv || !practiceId || toggleReadMutation.isPending) return
    const makeUnread = !(activeConv.unread_count > 0)
    const next = makeUnread ? Math.max(1, activeConv.unread_count || 0) : 0
    toggleReadMutation.mutate(
      { practiceId, conversationId: activeId, unreadCount: next },
      { onSuccess: () => showToast(makeUnread ? 'Marked as unread' : 'Marked as read') },
    )
  }

  // Paperclip: upload a file and post it as a downloadable attachment bubble.
  async function uploadAttachment(file) {
    if (!file || !activeId) return
    if (file.size > 10 * 1024 * 1024) return showToast('File must be under 10MB')
    try {
      const result = await uploadAttachmentMutation.mutateAsync({
        conversationId: activeId,
        practiceId,
        file,
        channel,
        patientPhone: activeConv?.patient_phone,
      })
      refetchConv()
      if (result?.warning) showToast(result.warning)
    } catch (e) {
      showToast(/bucket|not found/i.test(e?.message || '') ? 'Attachments need the conversation-attachments bucket - apply the migration.' : 'Upload failed')
    }
  }

  function toggleStar(consultId, current) {
    if (!consultId) return showToast('No consult linked to star')
    if (updateConsultFlags.isPending && updateConsultFlags.variables?.consultId === consultId) return
    updateConsultFlags.mutate({ consultId, patch: { starred: !current }, practiceId })
  }

  function archiveActive() {
    const cid = consult?.id
    if (!cid) { setConfirmArchive(false); return showToast('No consult linked') }
    if (updateConsultFlags.isPending) return
    const nextConv = visible.find((c) => c.id !== activeId)
    updateConsultFlags.mutate(
      { consultId: cid, patch: { archived: true }, practiceId },
      {
        onSuccess: () => {
          setActiveId(nextConv ? nextConv.id : null)
          setConfirmArchive(false)
          showToast('Conversation archived')
        },
      },
    )
  }

  const togglingRead = toggleReadMutation.isPending
  const archiving = updateConsultFlags.isPending && updateConsultFlags.variables?.patch?.archived
  const starringId = updateConsultFlags.isPending && updateConsultFlags.variables?.patch?.starred != null
    ? updateConsultFlags.variables?.consultId
    : null
  const sending = sendThreadMutation.isPending

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

  function discardComposerDraft() {
    setDraft('')
    setEmailSubject('')
    setAiSuggested(false)
    setEmojiOpen(false)
    setSnippetsOpen(false)
  }

  function switchComposeChannel(next) {
    if (next !== 'email' && next !== 'sms') return
    setChannel(next)
    setChannelMenuOpen(false)
    setEmojiOpen(false)
    setSnippetsOpen(false)
  }

  async function handleSend(e) {
    e?.preventDefault?.()
    const body = draft.trim()
    if (!body || !activeId || sendThreadMutation.isPending) return
    const isEmail = channel === 'email'
    if (isEmail && !activeConv?.patient_email) {
      showToast('Add a patient email on this conversation or linked consult first.')
      return
    }
    const nowIso = new Date().toISOString()
    const subject = isEmail
      ? (emailSubject.trim() || `Message from ${practice?.name || 'your care team'}`)
      : null
    const meta = isEmail ? { subject } : {}
    try {
      const { message: data } = await sendThreadMutation.mutateAsync({
        practiceId,
        conversationId: activeId,
        row: {
          conversation_id: activeId,
          direction: 'outbound',
          channel,
          body,
          sent_at: nowIso,
          meta,
        },
        bump: { at: nowIso },
      })
      setDraft('')
      setEmailSubject('')
      setAiSuggested(false)
      auditMessageSent(activeId)
      const fn = isEmail ? 'mailgun-send' : 'twilio-send'
      const target = isEmail ? activeConv?.patient_email : activeConv?.patient_phone
      if (target && data) {
        try {
          await invokeEdgeFunction(fn, {
            practice_id: practiceId,
            to: target,
            body,
            subject,
            conversation_message_id: data.id,
            consult_id: activeConv?.consult_id,
          })
        } catch (e) {
          showToast(e?.message || 'Could not send, check messaging settings.')
          await supabase
            .from('conversation_messages')
            .update({
              meta: {
                ...meta,
                delivery_status: 'failed',
                send_error: e?.message || 'send failed',
              },
            })
            .eq('id', data.id)
        }
      }
    } catch {
      showToast('Could not send message.')
    }
  }

  // Pre-fill the email composer when replying from a thread card.
  function replyToEmail({ subject, body }) {
    setChannel('email')
    const reSubject = subject?.startsWith('Re:') ? subject : `Re: ${subject || 'your message'}`
    setEmailSubject(reSubject)
    const quote = body ? `\n\n---\n${body}` : ''
    setDraft(quote.trim() ? quote : '')
    setAiSuggested(false)
    setEmailComposerExpanded(true)
    taRef.current?.focus()
  }

  // Default compose channel to SMS on load, regardless of conversation type.
  useEffect(() => {
    if (!activeConv) return
    setChannel('sms')
  }, [activeConv?.id])

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
        <h1 className="text-3xl font-bold tracking-tight text-slate-100">Inbox</h1>
        <EmptyState
          icon={MessagesSquare}
          title="No conversations yet"
          description="CaseLift will create one when a patient replies. New threads open here automatically."
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-surface">
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
                className="input py-2 pl-9 pr-3 text-sm focus:border-primary focus:ring-primary/20"
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
              const emailRow = isEmailConversation(c)
              const rowBg = isActive
                ? 'border-blue-500 bg-blue-50'
                : 'border-transparent hover:bg-gray-50'
              const avatarSeed = emailRow
                ? (c.patient_email || `${c.patient_first || ''}${c.patient_last || ''}`)
                : `${c.patient_first || ''}${c.patient_last || ''}`
              const rowInitials = emailRow
                ? emailInitials(c.patient_email)
                : initials(c.patient_first, c.patient_last)
              const rowTitle = emailRow
                ? (c.patient_email || `${c.patient_first || ''} ${c.patient_last || ''}`.trim())
                : `${c.patient_first || ''} ${c.patient_last || ''}`.trim()
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
                  <input
                    type="checkbox"
                    aria-label="Select conversation"
                    onClick={(e) => e.stopPropagation()}
                    className="h-3.5 w-3.5 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500/30"
                  />
                  <div className="relative shrink-0">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-full text-xs font-semibold text-white ${avatarColor(avatarSeed)}`}>
                      {rowInitials}
                    </div>
                    {emailRow && (
                      <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 ring-2 ring-white">
                        <Mail className="h-2.5 w-2.5 text-white" strokeWidth={2.5} />
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        {emailRow ? (
                          <span className={`truncate text-sm ${unread ? 'font-bold text-gray-900' : 'font-semibold text-gray-800'}`}>
                            {rowTitle}
                          </span>
                        ) : (
                          <Link
                            to={c.consult_id ? `/consults/${c.consult_id}` : '/consults'}
                            onClick={(e) => e.stopPropagation()}
                            className={`truncate text-sm hover:underline ${unread ? 'font-bold text-gray-900' : 'font-semibold text-gray-800'}`}
                          >
                            {rowTitle}
                          </Link>
                        )}
                        {c.reactivation_campaign_id && (
                          <span title="Replied to a reactivation campaign" className="inline-flex shrink-0 items-center rounded-full bg-primary/10 p-0.5 text-primary">
                            <Megaphone className="h-3 w-3" />
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs text-gray-400">{listDateLabel(c.last_message_at)}</span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <p className={`truncate text-sm ${unread ? 'font-medium text-gray-700' : 'text-gray-500'}`}>
                        {c.last_message_preview || c.patient_phone || c.patient_email}
                      </p>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          title={c.consult?.starred ? 'Unstar conversation' : 'Star conversation'}
                          aria-label="Star conversation"
                          aria-pressed={Boolean(c.consult?.starred)}
                          onClick={(e) => { e.stopPropagation(); toggleStar(c.consult?.id, Boolean(c.consult?.starred)) }}
                          disabled={starringId === c.consult?.id}
                          className={`transition disabled:opacity-50 ${c.consult?.starred ? 'text-amber-400 opacity-100' : 'text-gray-300 opacity-0 hover:text-amber-400 group-hover:opacity-100'}`}
                        >
                          {starringId === c.consult?.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Star className={`h-4 w-4 ${c.consult?.starred ? 'fill-current' : ''}`} />}
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
                <div className="relative shrink-0">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white ${avatarColor(activeIsEmail ? (activeConv.patient_email || '') : `${activeConv.patient_first || ''}${activeConv.patient_last || ''}`)}`}>
                    {activeIsEmail ? emailInitials(activeConv.patient_email) : initials(activeConv.patient_first, activeConv.patient_last)}
                  </div>
                  {activeIsEmail && (
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 ring-2 ring-white">
                      <Mail className="h-2.5 w-2.5 text-white" strokeWidth={2.5} />
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {activeIsEmail ? (
                      <span className="truncate text-lg font-semibold text-gray-900">
                        {activeConv.patient_email || `${activeConv.patient_first || ''} ${activeConv.patient_last || ''}`.trim()}
                      </span>
                    ) : (
                      <Link to={consultPath} className="truncate text-lg font-semibold text-gray-900 underline-offset-2 hover:underline">
                        {activeConv.patient_first} {activeConv.patient_last}
                      </Link>
                    )}
                    {activeConv.reactivation_campaign_id && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary-700">
                        <Megaphone className="h-3 w-3" /> Reactivation
                      </span>
                    )}
                  </div>
                  <p className="flex items-center gap-1.5 truncate text-sm text-gray-500">
                    {activeIsEmail ? (
                      <><Mail className="h-3.5 w-3.5" /> {activeConv.patient_email || 'Email conversation'}</>
                    ) : (
                      <><Phone className="h-3.5 w-3.5" /> {activeConv.patient_phone || activeConv.patient_email}</>
                    )}
                    {activeIsEmail && (activeConv.patient_first || activeConv.patient_last) && (
                      <span className="text-gray-400">· {activeConv.patient_first} {activeConv.patient_last}</span>
                    )}
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
                    disabled={starringId === consult?.id}
                    title={consult?.starred ? 'Unstar' : 'Star'}
                    aria-label="Star"
                    aria-pressed={Boolean(consult?.starred)}
                    className={`hidden rounded-md p-1.5 transition hover:bg-gray-100 disabled:opacity-50 sm:inline-flex ${consult?.starred ? 'text-amber-500' : 'text-gray-400 hover:text-amber-500'}`}
                  >
                    {starringId === consult?.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Star className={`h-4 w-4 ${consult?.starred ? 'fill-current' : ''}`} />}
                  </button>
                  <button
                    type="button"
                    onClick={toggleRead}
                    disabled={togglingRead}
                    title={activeConv.unread_count > 0 ? 'Mark as read' : 'Mark as unread'}
                    aria-label="Toggle read"
                    className="hidden rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50 sm:inline-flex"
                  >
                    {togglingRead ? <Loader2 className="h-4 w-4 animate-spin" /> : activeConv.unread_count > 0 ? <MailOpen className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
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

            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-white px-4 pt-2 pb-5">
              {loadingThread ? (
                <div className="py-8 text-center text-sm text-gray-500">Loading messages...</div>
              ) : (
                threadRenderItems.map((item, ri) => {
                  const ts = renderItemTimestamp(item)
                  const prevTs = ri > 0 ? renderItemTimestamp(threadRenderItems[ri - 1]) : null
                  const newDay = !prevTs || new Date(ts).toDateString() !== new Date(prevTs).toDateString()

                  if (item.type === 'thread') {
                    const patientStarted = threadStartedByPatient(item.messages)
                    return (
                      <Fragment key={`thread-${item.channel}-${item.messages.map((msg) => msg.id).join('-')}`}>
                        {newDay && (
                          <div className="flex justify-center pb-2 pt-3">
                            <span className="rounded-full bg-gray-100 px-3 py-1 text-[11px] font-medium text-gray-500">{dayLabel(ts)}</span>
                          </div>
                        )}
                        <div className={`mt-3 flex ${patientStarted ? 'justify-start' : 'justify-end'}`}>
                          <ConversationThreadCard
                            channel={item.channel}
                            messages={item.messages}
                            activeConv={activeConv}
                            practice={practice}
                            user={user}
                            tcName={tcName}
                            avatarColor={avatarColor}
                            emailInitials={emailInitials}
                            initials={initials}
                            onReply={item.channel === 'email' ? replyToEmail : undefined}
                          />
                        </div>
                      </Fragment>
                    )
                  }

                  const m = item.message
                  const msgTs = m.sent_at || m.created_at

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
                            <p className="mt-1 text-[10px] text-amber-600/80">{messageTime(msgTs)}</p>
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
                            sentAt={msgTs}
                            callLogId={m.call_log_id}
                            hasRecording={hasRecording}
                            recordingDuration={recMeta?.duration_seconds}
                            transcriptStatus={recMeta?.transcript_status}
                            transcriptText={recMeta?.transcript_deidentified}
                            transcriptError={recMeta?.transcript_error}
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

                  return null
                })
              )}
            </div>

            <form onSubmit={handleSend} className="shrink-0 border-t border-gray-200 bg-gray-50/80 p-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf,.doc,.docx"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAttachment(f); e.target.value = '' }}
              />

              {channel === 'email' ? (
                <EmailComposer
                  draft={draft}
                  onDraftChange={updateDraft}
                  emailSubject={emailSubject}
                  onEmailSubjectChange={setEmailSubject}
                  textareaRef={taRef}
                  onSubmit={handleSend}
                  sending={sending}
                  suggesting={suggesting}
                  aiSuggested={aiSuggested}
                  onSuggestReply={suggestReply}
                  onDiscard={discardComposerDraft}
                  onSwitchChannel={switchComposeChannel}
                  expanded={emailComposerExpanded}
                  onToggleExpanded={() => setEmailComposerExpanded((v) => !v)}
                  channelMenuOpen={channelMenuOpen}
                  onChannelMenuOpenChange={setChannelMenuOpen}
                  emojiOpen={emojiOpen}
                  onEmojiOpenChange={setEmojiOpen}
                  snippetsOpen={snippetsOpen}
                  onSnippetsOpenChange={setSnippetsOpen}
                  quickEmojis={QUICK_EMOJIS}
                  snippets={SNIPPETS}
                  onInsertEmoji={insertEmoji}
                  onFillSnippet={fillSnippet}
                  onAttachClick={() => fileInputRef.current?.click()}
                  uploading={uploadAttachmentMutation.isPending}
                  missingPatientEmail={!activeConv?.patient_email}
                  patientFirst={activeConv?.patient_first}
                  practiceDoctor={practice?.doctor_last || practice?.doctor_first}
                />
              ) : (
                <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                  <div className="flex items-center gap-0.5 border-b border-gray-200 px-2 py-1.5">
                    <ChannelToggle channel={channel} onSwitch={switchComposeChannel} />
                  </div>

                  {aiSuggested && draft.trim() && (
                    <div className="flex items-center gap-1.5 border-b border-gray-100 bg-blue-50/50 px-4 py-1.5 text-[11px] font-medium text-blue-600">
                      <Sparkles className="h-3 w-3" /> CaseLift recommended
                    </div>
                  )}

                  <div className="flex items-start gap-2 p-3">
                    <textarea
                      ref={taRef}
                      value={draft}
                      onChange={(e) => updateDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          handleSend(e)
                        }
                      }}
                      rows={2}
                      placeholder="Type a message"
                      className="min-h-[56px] max-h-40 flex-1 resize-none overflow-y-auto rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-[15px] text-gray-900 placeholder-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-2 border-t border-gray-200 bg-gray-50 px-2 py-1.5">
                    <div className="relative flex items-center gap-0.5 text-gray-500">
                      <button type="button" onClick={() => { setEmojiOpen((v) => !v); setSnippetsOpen(false) }} title="Emoji" aria-label="Emoji" className={`rounded-md p-1.5 transition hover:bg-gray-200/80 hover:text-gray-700 ${emojiOpen ? 'bg-gray-200/80 text-gray-700' : ''}`}>
                        <Smile className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploadAttachmentMutation.isPending} title="Attach file" aria-label="Attach file" className="rounded-md p-1.5 transition hover:bg-gray-200/80 hover:text-gray-700 disabled:opacity-40">
                        {uploadAttachmentMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                      </button>
                      <button type="button" onClick={() => { setSnippetsOpen((v) => !v); setEmojiOpen(false) }} title="Snippets" aria-label="Snippets" className={`rounded-md p-1.5 transition hover:bg-gray-200/80 hover:text-gray-700 ${snippetsOpen ? 'bg-gray-200/80' : ''}`}>
                        <ScrollText className="h-4 w-4" />
                      </button>
                      {emojiOpen && (
                        <div className="absolute bottom-full left-0 z-20 mb-2 grid grid-cols-4 gap-1 rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
                          {QUICK_EMOJIS.map((e) => (
                            <button key={e} type="button" onClick={() => insertEmoji(e)} className="flex h-9 w-9 items-center justify-center rounded-lg text-xl transition hover:bg-gray-100">
                              {e}
                            </button>
                          ))}
                        </div>
                      )}
                      {snippetsOpen && (
                        <div className="absolute bottom-full left-0 z-20 mb-2 w-72 rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
                          <div className="flex items-center justify-between px-1 pb-1">
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Templates</span>
                            <button type="button" onClick={() => setSnippetsOpen(false)} aria-label="Close templates" className="rounded p-0.5 text-gray-400 hover:bg-gray-100">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          {SNIPPETS.map((s, i) => (
                            <button key={i} type="button" onClick={() => fillSnippet(s)} className="block w-full rounded-lg px-2 py-2 text-left text-xs leading-snug text-gray-600 hover:bg-gray-50">
                              {s.replace(/\[name\]/g, activeConv?.patient_first || 'name').replace(/\[doctor\]/g, practice?.doctor_last || 'doctor')}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={suggestReply}
                        disabled={suggesting}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
                      >
                        {suggesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                        <span className="hidden md:inline">{suggesting ? 'Suggesting…' : 'Ask CaseLift'}</span>
                      </button>
                      <button
                        type="submit"
                        disabled={!draft.trim() || sending}
                        className="inline-flex shrink-0 items-center gap-2 rounded-md bg-blue-600 px-3.5 py-2 text-sm font-semibold !text-white transition hover:bg-blue-700 disabled:opacity-50"
                      >
                        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        <span className="hidden sm:inline">Send</span>
                      </button>
                    </div>
                  </div>
                </div>
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
          practiceId={practiceId}
          consult={consult}
          conv={activeConv}
          msgs={consultMsgs}
          loading={loadingContext}
          paused={paused}
          patientSaving={updateConversationPatient.isPending}
          onCollapse={togglePanel}
          onStartRecording={() => openRecorder()}
          onConsultChange={(patch) => {
            if (practiceId && activeId && patch) {
              patchConversationContextConsult(queryClient, practiceId, activeId, patch)
            }
            refetchConv()
          }}
          onSavePatient={saveConversationPatient}
          onPatientSaveError={(msg) => showToast(msg)}
          onAddThreadMessage={() => refetchConv()}
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
              <button onClick={archiveActive} disabled={archiving} className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3.5 py-2 text-sm font-semibold !text-white transition hover:bg-red-700 disabled:opacity-70">
                {archiving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Archive
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
