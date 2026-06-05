import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Calendar,
  Clock,
  Timer,
  Heart,
  Lightbulb,
  TrendingDown,
  ListChecks,
  Mail,
  MessageSquare,
  Phone,
  User,
  MessagesSquare,
  Sparkles,
  Send,
  CalendarClock,
  CheckCircle2,
  Loader2,
  Wand2,
  X,
  AlertTriangle,
  Stethoscope,
  Link2,
  RefreshCcw,
  Pencil,
  Check,
  Trophy,
  RotateCcw,
} from 'lucide-react'
import Modal from '../components/Modal'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { stripEmDashes } from '../lib/sanitize'
import { optimizeMessage, acceptOptimization } from '../lib/insights'
import { attributionStatusBadge } from '../lib/attribution'
import { useConsultDetail, useConsultAttribution, queryKeys } from '../lib/queries'
import { requestAnalysis, transcribeRecording } from '../lib/recording'
import OutcomeControls from '../components/OutcomeControls'
import {
  parseSequenceConfig,
  scheduleConsultMessages,
  computeScheduledFor,
  rulesFromConfig,
} from '../lib/sequence'
import TranscriptViewer from '../components/TranscriptViewer'
import {
  formatDate,
  formatTime,
  formatDuration,
  formatDateTime,
  statusMeta,
  objectionMeta,
  exitIntentMeta,
} from '../lib/consults'
import { formatMoney } from '../lib/analytics'
import {
  TREATMENT_TYPES,
  consultTxValue,
  txValueDisplay,
  TX_VALUE_SOURCES,
} from '../lib/treatments'

// ── Small presentational helpers ────────────────────────────────────────────

// Consistent card chrome: white background, hairline gray border, rounded-xl,
// subtle shadow so cards pop against the gray-50 page.
function Card({ className = '', children }) {
  return <div className={`rounded-xl border border-gray-200 bg-white p-5 shadow-sm ${className}`}>{children}</div>
}

// xs uppercase muted section label with an optional leading icon.
function SectionLabel({ icon: Icon, children, className = '' }) {
  return (
    <p className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 ${className}`}>
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {children}
    </p>
  )
}

// Pulsing skeleton bars for any region awaiting AI analysis.
function SkeletonLines({ lines = 3, className = '' }) {
  return (
    <div className={`animate-pulse space-y-2.5 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className={`h-3 rounded bg-gray-100 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </div>
  )
}

// A label-over-value stat box (Primary / Secondary Objection, Exit Intent) with a
// subtle colored left accent. White background, gray border, gray-900 value.
function StatBox({ label, accent, children }) {
  return (
    <div className={`rounded-lg border border-gray-200 border-l-4 ${accent} bg-white p-3`}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <div className="mt-1.5 text-sm font-medium text-gray-900">{children}</div>
    </div>
  )
}

const DASH = <span className="font-normal text-gray-400">-</span>

// Light-mode status pill. "Approved" reads green per spec; positive states green,
// in-progress blue, lost red, queued amber, everything else neutral gray.
const STATUS_PILL = {
  approved: 'bg-green-100 text-green-700',
  active: 'bg-green-100 text-green-700',
  closed_won: 'bg-green-100 text-green-700',
  recovered: 'bg-green-100 text-green-700',
  replied: 'bg-blue-100 text-blue-700',
  analyzed: 'bg-blue-100 text-blue-700',
  followed_up: 'bg-blue-100 text-blue-700',
  closed_lost: 'bg-red-100 text-red-700',
  lost: 'bg-red-100 text-red-700',
  analyzing: 'bg-amber-100 text-amber-700',
  transcription_error: 'bg-red-100 text-red-700',
  pending: 'bg-gray-100 text-gray-600',
  new: 'bg-gray-100 text-gray-600',
}
function StatusPill({ status }) {
  const cls = STATUS_PILL[status] || 'bg-gray-100 text-gray-600'
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${cls}`}>
      {statusMeta(status).label}
    </span>
  )
}

function dayLabelForMessage(m, i) {
  const day = m.send_day
  if (day != null) return `Day ${day}`
  return `Message ${i + 1}`
}

// Colored day pill: Day 1 = blue, Day 3 = indigo, Day 7 = purple.
function dayBadgeClasses(label) {
  const n = parseInt(String(label).replace(/\D/g, ''), 10)
  if (n === 1) return 'bg-blue-100 text-blue-700'
  if (n === 3) return 'bg-indigo-100 text-indigo-700'
  if (n === 7) return 'bg-purple-100 text-purple-700'
  return 'bg-gray-100 text-gray-600'
}

// Map a raw message status onto a simplified delivery state for the editable
// message card: Pending | Sent | Opened | Replied.
function messageStateMeta(status) {
  switch (status) {
    case 'sent':
      return { label: 'Sent', classes: 'bg-green-100 text-green-700' }
    case 'opened':
      return { label: 'Opened', classes: 'bg-emerald-100 text-emerald-700' }
    case 'replied':
      return { label: 'Replied', classes: 'bg-blue-100 text-blue-700' }
    default:
      return { label: 'Pending', classes: 'bg-gray-100 text-gray-600' }
  }
}

// A message is locked (read-only) once it has actually gone out.
const LOCKED_STATUSES = ['sent', 'opened', 'replied']

// Convert a timestamptz into the value an <input type="date"> expects (YYYY-MM-DD).
function toDateInputValue(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${day}`
}

// A fully-editable follow-up message row. Keeps the AI "Optimize" action and adds
// inline editing of subject/body, an editable scheduled date, a per-message
// character count (SMS), and a "Reset to AI version" action.
//
// "AI version" baseline: the messages table has no `original` column, so we treat
// `aiBaseline` (captured by the parent when the message first loaded on page mount)
// as the AI-generated version for un-edited messages. Reset restores those values.
function EditableMessage({ m, index, practiceId, aiBaseline, onChange, dayLabel, createdAt, rules }) {
  const ChannelIcon = m.channel === 'email' ? Mail : MessageSquare
  const isEmail = m.channel === 'email'
  const stateMeta = messageStateMeta(m.status)
  const locked = LOCKED_STATUSES.includes(m.status)

  // Local draft mirrors the row so typing is snappy; we persist on Save / blur.
  const [subject, setSubject] = useState(stripEmDashes(m.subject || ''))
  const [body, setBody] = useState(stripEmDashes(m.body || ''))
  const [scheduledDate, setScheduledDate] = useState(toDateInputValue(m.scheduled_for))

  const [loading, setLoading] = useState(false) // optimize in flight
  const [error, setError] = useState('')
  const [suggestion, setSuggestion] = useState(null) // { optimized, explanation }
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // The component is keyed by message id in the parent, so this local draft
  // initializes once per message. Outside-driven changes that matter (accepting
  // an AI optimization) update `body` locally in acceptOptimized below, so no
  // prop-sync effect is needed - and an unsaved draft won't be clobbered by a
  // background poll.

  const charCount = body.length
  const overLimit = charCount > 160
  const dirty =
    body !== (m.body || '') ||
    subject !== (m.subject || '') ||
    scheduledDate !== toDateInputValue(m.scheduled_for)

  // Persist body/subject/scheduled_for back to the messages row.
  async function save() {
    if (locked || !dirty) return
    setSaving(true)
    setError('')
    setSaved(false)
    const patch = { body }
    if (isEmail) patch.subject = subject || null
    // Preserve the original time-of-day if there was one; otherwise default to 09:00.
    if (scheduledDate && createdAt && rules) {
      const [y, mo, d] = scheduledDate.split('-').map(Number)
      const pickedMs = new Date(y, mo - 1, d, 12, 0, 0, 0).getTime()
      const day = Math.max(0, Math.round((pickedMs - new Date(createdAt).getTime()) / 86400000))
      patch.send_day = day
      patch.scheduled_for = computeScheduledFor(createdAt, day, rules)
      if (m.status === 'draft') patch.status = 'scheduled'
    } else if (!scheduledDate) {
      patch.scheduled_for = null
    }
    const { error: err } = await supabase.from('messages').update(patch).eq('id', m.id)
    if (err) {
      setError(err.message || 'Could not save this message.')
    } else {
      onChange(m.id, patch)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
    setSaving(false)
  }

  // Restore the AI-generated baseline captured on page mount.
  async function resetToAI() {
    if (locked || !aiBaseline) return
    const nextBody = aiBaseline.body || ''
    const nextSubject = aiBaseline.subject || ''
    setBody(nextBody)
    setSubject(nextSubject)
    setSaving(true)
    setError('')
    const patch = { body: nextBody }
    if (isEmail) patch.subject = nextSubject || null
    const { error: err } = await supabase.from('messages').update(patch).eq('id', m.id)
    if (err) {
      setError(err.message || 'Could not reset this message.')
    } else {
      onChange(m.id, patch)
    }
    setSaving(false)
  }

  async function runOptimize() {
    setLoading(true)
    setError('')
    try {
      const res = await optimizeMessage(m.id)
      setSuggestion({ optimized: res.optimized, explanation: res.explanation })
    } catch (e) {
      setError(e?.message || 'Could not optimize this message right now.')
    } finally {
      setLoading(false)
    }
  }

  async function acceptOptimized() {
    if (!suggestion) return
    setSaving(true)
    try {
      await acceptOptimization({
        messageId: m.id,
        practiceId,
        before: m.body,
        after: suggestion.optimized,
        explanation: suggestion.explanation,
      })
      setBody(suggestion.optimized)
      onChange(m.id, { body: suggestion.optimized })
      setSuggestion(null)
    } catch (e) {
      setError(e?.message || 'Could not save the optimization.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      {/* Header: number + channel + delivery status */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-[11px] font-semibold text-gray-600">
            {index + 1}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${dayBadgeClasses(dayLabel)}`}>{dayLabel}</span>
          <ChannelIcon className="h-3.5 w-3.5 text-gray-400" />
          <span className="uppercase text-gray-400">{m.channel}</span>
        </div>
        <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${stateMeta.classes}`}>
          {stateMeta.label}
        </span>
      </div>

      {locked ? (
        // Read-only once the message has been sent / opened / replied.
        <>
          {m.subject && <p className="mt-2 text-sm font-medium text-gray-900">{stripEmDashes(m.subject)}</p>}
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-gray-600">{stripEmDashes(m.body)}</p>
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-gray-400">
            {m.sent_at ? (
              <>
                <Send className="h-3 w-3" /> Sent {formatDateTime(m.sent_at)}
              </>
            ) : (
              <>
                <CheckCircle2 className="h-3 w-3" /> {stateMeta.label}
              </>
            )}
          </p>
        </>
      ) : (
        <>
          {isEmail && (
            <div className="mt-2">
              <label className="label !mb-1 !text-xs" htmlFor={`subj-${m.id}`}>Subject</label>
              <input
                id={`subj-${m.id}`}
                className="input !py-2 text-sm"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                onBlur={save}
                placeholder="Email subject"
              />
            </div>
          )}

          <div className="mt-2">
            <label className="label !mb-1 !text-xs" htmlFor={`body-${m.id}`}>{isEmail ? 'Body' : 'Message'}</label>
            <textarea
              id={`body-${m.id}`}
              className="input min-h-[80px] resize-y text-sm leading-relaxed"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onBlur={save}
            />
            {!isEmail && (
              <p className={`mt-1 text-right text-[11px] ${overLimit ? 'font-semibold text-amber-600' : 'text-gray-400'}`}>
                {charCount} / 160{overLimit ? ' · multiple segments' : ''}
              </p>
            )}
          </div>

          {/* Scheduled date (editable) */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-[11px] text-gray-500" htmlFor={`sched-${m.id}`}>
              <CalendarClock className="h-3.5 w-3.5" /> Scheduled
            </label>
            <input
              id={`sched-${m.id}`}
              type="date"
              className="input !w-auto !py-1.5 text-xs"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
              onBlur={save}
            />
          </div>

          {/* Actions */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button
                onClick={resetToAI}
                disabled={saving || !aiBaseline}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
                title="Reset to the AI-generated version"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Reset to AI version
              </button>
              <button
                onClick={runOptimize}
                disabled={loading || saving}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
                title="Optimize with AI"
              >
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                Optimize
              </button>
            </div>
            <button
              onClick={save}
              disabled={saving || !dirty}
              className="btn-primary px-3 py-1.5 text-xs"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : saved ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              {saved ? 'Saved' : 'Save'}
            </button>
          </div>
        </>
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      {suggestion && (
        <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-blue-700">
            <Wand2 className="h-3.5 w-3.5" /> Optimized version
          </p>
          <p className="mt-2 whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-3 text-sm leading-relaxed text-gray-800">
            {suggestion.optimized}
          </p>
          {suggestion.explanation && (
            <p className="mt-2 text-xs text-gray-600">
              <span className="font-semibold text-gray-700">What changed: </span>
              {suggestion.explanation}
            </p>
          )}
          <div className="mt-3 flex items-center justify-end gap-2">
            <button onClick={() => setSuggestion(null)} disabled={saving} className="btn-ghost px-3 py-1.5 text-xs">
              <X className="h-3.5 w-3.5" /> Dismiss
            </button>
            <button onClick={acceptOptimized} disabled={saving} className="btn-primary px-3 py-1.5 text-xs">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Accept &amp; apply
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// Contact item in the header row. Missing values render muted with a warning icon.
function ContactItem({ icon: Icon, value, missing }) {
  if (!value) {
    return (
      <span className="inline-flex items-center gap-1.5 text-gray-400">
        <AlertTriangle className="h-3.5 w-3.5" /> {missing}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-gray-700">
      <Icon className="h-4 w-4 text-gray-400" /> {value}
    </span>
  )
}

function InfoRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="h-4 w-4 shrink-0 text-gray-400" />
      <div className="min-w-0">
        {label && <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>}
        <p className="truncate text-gray-900">{value}</p>
      </div>
    </div>
  )
}

// Minimal manual patient-info form for consults with no linked PMS appointment.
function PatientEditModal({ consult, onClose, onSave }) {
  const [form, setForm] = useState({
    patient_name: consult.patient_name || '',
    patient_phone: consult.patient_phone || '',
    patient_email: consult.patient_email || '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  async function submit() {
    setSaving(true)
    await onSave(form)
    setSaving(false)
  }

  return (
    <Modal
      title="Enter patient info"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={submit} disabled={saving} className="btn-primary">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">Patient name</label>
          <input className="input" value={form.patient_name} onChange={(e) => set('patient_name', e.target.value)} />
        </div>
        <div>
          <label className="label">Phone</label>
          <input className="input" value={form.patient_phone} onChange={(e) => set('patient_phone', e.target.value)} placeholder="(512) 555-0142" />
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" value={form.patient_email} onChange={(e) => set('patient_email', e.target.value)} placeholder="patient@email.com" />
        </div>
      </div>
    </Modal>
  )
}

export default function ConsultDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { practiceId, practice } = useAuth()

  const queryClient = useQueryClient()
  const { data: bundle, isLoading: loading } = useConsultDetail(id)
  const notFound = bundle?.notFound === true
  const consult = bundle?.consult ?? null
  const messages = bundle?.messages ?? []
  const conversation = bundle?.conversation ?? null
  const appointment = bundle?.appointment ?? null
  const { data: attribution = null } = useConsultAttribution(consult, messages)
  const [showPatientEdit, setShowPatientEdit] = useState(false)
  const [wonOpen, setWonOpen] = useState(false)

  function patchConsult(patch) {
    queryClient.setQueryData(queryKeys.consult(id), (old) =>
      old && !old.notFound ? { ...old, consult: { ...old.consult, ...patch } } : old,
    )
  }

  function patchMessages(updater) {
    queryClient.setQueryData(queryKeys.consult(id), (old) =>
      old && !old.notFound ? { ...old, messages: updater(old.messages || []) } : old,
    )
  }

  function refreshConsult() {
    queryClient.invalidateQueries({ queryKey: queryKeys.consult(id) })
    if (practiceId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(practiceId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.sequences(practiceId) })
    }
  }

  // AI-version baseline per message, keyed by message id. Captured the first time
  // a message is seen on this page mount; since the messages table has no
  // `original` column, the value loaded on mount is the AI-generated version for
  // un-edited messages, and "Reset to AI version" restores to it. Held in state
  // (read during render) but only ever populated additively, never overwritten.
  const [aiBaselines, setAiBaselines] = useState({})

  // Inline editing of the treatment-plan value (GOAL 1).
  const [editingTx, setEditingTx] = useState(false)
  const [txInput, setTxInput] = useState('')
  const [savingTx, setSavingTx] = useState(false)
  const [savingTreatment, setSavingTreatment] = useState(false)

  // Activation hold (hours) from the practice's sequence settings; drives the
  // 24h countdown before the first follow-up message can send.
  const holdHours = parseSequenceConfig(practice?.sequence_config).rules.holdHours || 24
  const seqRules = rulesFromConfig(practice?.sequence_config, practice?.timezone)
  const [approvingFollowup, setApprovingFollowup] = useState(false)

  const triggeredRef = useRef(false)

  const needsFollowupApproval =
    practice?.auto_start_followup === false &&
    !consult?.followup_approved_at &&
    messages.some((m) => m.status === 'draft')

  async function approveFollowup() {
    if (!consult?.id) return
    setApprovingFollowup(true)
    await scheduleConsultMessages(supabase, {
      consultId: consult.id,
      createdAt: consult.created_at,
      sequenceConfig: practice?.sequence_config,
      practiceTimezone: practice?.timezone,
      timingPreset: consult.sequence_timing_preset,
    })
    refreshConsult()
    setApprovingFollowup(false)
  }

  useEffect(() => {
    if (!messages.length) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAiBaselines((prev) => {
      let next = prev
      for (const msg of messages) {
        if (!(msg.id in next)) {
          if (next === prev) next = { ...prev }
          next[msg.id] = { body: msg.body || '', subject: msg.subject || '' }
        }
      }
      return next
    })
  }, [messages])

  const analysisPending = consult?.status === 'transcribed'
  useEffect(() => {
    if (!analysisPending || !consult?.id) return
    if (!triggeredRef.current) {
      triggeredRef.current = true
      requestAnalysis(consult.id).catch((e) => console.warn('[analyze] trigger failed:', e?.message || e))
    }
  }, [analysisPending, consult?.id])

  // While the consult is still being transcribed ('analyzing') or analyzed
  // ('transcribed'), refetch every 10s so the transcript, summary, and coaching
  // sections fill in live without a manual reload.
  const stillProcessing = consult?.status === 'analyzing' || consult?.status === 'transcribed'
  useEffect(() => {
    if (!stillProcessing || !consult?.id) return
    const t = setInterval(() => refreshConsult(), 10000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stillProcessing, consult?.id])

  const transcriptionError = consult?.status === 'transcription_error'
  const [retryingTranscription, setRetryingTranscription] = useState(false)

  async function retryTranscription() {
    if (!consult?.id) return
    setRetryingTranscription(true)
    triggeredRef.current = false
    try {
      if (consult.audio_storage_path) {
        await transcribeRecording({
          consultId: consult.id,
          audioPath: consult.audio_storage_path,
          durationSec: consult.duration,
          patient: {
            firstName: consult.patient_first,
            lastName: consult.patient_last,
            phone: consult.patient_phone,
            email: consult.patient_email,
          },
        })
        refreshConsult()
      } else {
        const { error } = await supabase.from('consults').update({ status: 'analyzing', transcript_error: null }).eq('id', consult.id)
        if (!error) patchConsult({ status: 'analyzing', transcript_error: null })
      }
    } catch (e) {
      console.warn('[retry] transcription failed:', e?.message || e)
      const { error } = await supabase.from('consults').update({ status: 'transcription_error', transcript_error: e?.message || 'Transcription failed' }).eq('id', consult.id)
      if (!error) patchConsult({ status: 'transcription_error', transcript_error: e?.message || 'Transcription failed' })
    }
    setRetryingTranscription(false)
  }

  async function savePatientInfo(fields) {
    const { error } = await supabase.from('consults').update(fields).eq('id', consult.id)
    if (!error) {
      patchConsult(fields)
      setShowPatientEdit(false)
    }
  }

  function handleMessageChange(messageId, patch) {
    patchMessages((prev) => prev.map((x) => (x.id === messageId ? { ...x, ...patch } : x)))
  }

  // Save the manually-entered treatment-plan value. An empty input clears it
  // (back to estimate / practice-default resolution). Otherwise it's stored with
  // source = 'manual', which is authoritative everywhere reporting reads tx value.
  // Update the treatment type after recording (it was pulled from the PMS at
  // record time). Re-running analysis is the TC's choice via "Regenerate".
  async function saveTreatment(value) {
    if (!value || value === consult.treatment_type) return
    setSavingTreatment(true)
    const { error } = await supabase.from('consults').update({ treatment_type: value }).eq('id', consult.id)
    if (!error) patchConsult({ treatment_type: value })
    setSavingTreatment(false)
  }

  async function saveTxValue() {
    setSavingTx(true)
    const trimmed = txInput.trim()
    const num = Number(trimmed.replace(/[^0-9.]/g, ''))
    const hasValue = trimmed !== '' && Number.isFinite(num) && num > 0
    const patch = hasValue
      ? { tx_plan_value: num, tx_plan_value_source: 'manual' }
      : { tx_plan_value: null, tx_plan_value_source: null }
    const { error } = await supabase.from('consults').update(patch).eq('id', consult.id)
    if (!error) {
      patchConsult(patch)
      setEditingTx(false)
    }
    setSavingTx(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-surface-700 border-t-primary" />
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="space-y-4">
        <button onClick={() => navigate('/consults')} className="btn-ghost">
          <ArrowLeft className="h-4 w-4" /> Back to consults
        </button>
        <div className="card px-6 py-16 text-center text-sm text-slate-400">
          This consult could not be found.
        </div>
      </div>
    )
  }

  const apptName = appointment ? [appointment.patient_first, appointment.patient_last].filter(Boolean).join(' ') : ''
  const heading = consult.patient_name || apptName || 'Consult'
  const apptType = appointment?.appointment_type || consult.appointment_type || 'Consultation'
  const phone = consult.patient_phone || appointment?.patient_phone || ''
  const email = consult.patient_email || appointment?.patient_email || ''
  const linked = Boolean(appointment)
  const hasPatient = Boolean(consult.patient_name || consult.patient_phone || consult.patient_email)
  const showPatient = linked || hasPatient
  const attrBadge = attribution && attribution.status !== 'unknown' ? attributionStatusBadge(attribution.status) : null

  // Resolved treatment-plan value + its display descriptor (GOAL 1).
  const tx = consultTxValue(consult, practice)
  const txDisp = txValueDisplay(tx)
  const txSourceLabel = TX_VALUE_SOURCES[tx.source]?.label || 'Estimated'

  return (
    // Edge-bleed wrapper paints the whole content area gray-50 so white cards pop.
    <div className="-mx-4 -my-6 bg-gray-50 px-4 py-6 sm:-mx-6 sm:px-6 lg:-mx-8 lg:-my-8 lg:px-8 lg:py-8">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Back link */}
        <Link
          to="/consults"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" /> Consults
        </Link>

        {/* ── Header card ─────────────────────────────────────────────────── */}
        <Card>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            {/* Left: patient name + appointment type + treatment badge */}
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold tracking-tight text-gray-900">{heading}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <p className="text-sm text-gray-500">{apptType}</p>
                {/* Treatment type - pulled from the PMS at record time, editable here. */}
                <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 py-0.5 pl-2 pr-1 text-[11px] font-semibold text-gray-600">
                  <Stethoscope className="h-3 w-3" />
                  <select
                    value={consult.treatment_type || 'dental_implants'}
                    disabled={savingTreatment}
                    onChange={(e) => saveTreatment(e.target.value)}
                    title="Treatment type (editable)"
                    className="cursor-pointer rounded-md border-0 bg-transparent py-0 pl-1 pr-5 text-[11px] font-semibold text-gray-700 focus:outline-none focus:ring-1 focus:ring-primary/40"
                  >
                    {TREATMENT_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                  {savingTreatment && <Loader2 className="h-3 w-3 animate-spin text-gray-400" />}
                </span>
              </div>
            </div>
            {/* Right: status badge(s) */}
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              {analysisPending ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">
                  <Loader2 className="h-3 w-3 animate-spin" /> Analyzing
                </span>
              ) : (
                <StatusPill status={consult.status} />
              )}
              {attrBadge && (
                <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${attrBadge.badge}`}>
                  {attrBadge.label}{attrBadge.check ? ' ✓' : ''}
                </span>
              )}
              {consult.pms_synced && (
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700">
                  <RefreshCcw className="h-3 w-3" /> Auto-synced
                </span>
              )}
              {!analysisPending && (
                consult.outcome === 'closed_won' || ['closed_won', 'recovered'].includes(consult.status) ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                    <Trophy className="h-3 w-3" /> Won ✓
                  </span>
                ) : (
                  <button
                    onClick={() => setWonOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-emerald-500"
                  >
                    <Trophy className="h-3 w-3" /> Mark as Won
                  </button>
                )
              )}
            </div>
          </div>

          {/* Middle: contact + recording details in one row */}
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <ContactItem icon={Phone} value={phone} missing="No phone on file" />
            <ContactItem icon={Mail} value={email} missing="No email on file" />
            <span className="inline-flex items-center gap-1.5 text-gray-700">
              <Calendar className="h-4 w-4 text-gray-400" /> {formatDate(consult.recording_date)}
            </span>
            {consult.recording_time && (
              <span className="inline-flex items-center gap-1.5 text-gray-700">
                <Clock className="h-4 w-4 text-gray-400" /> {formatTime(consult.recording_time)}
              </span>
            )}
            {formatDuration(consult.duration) && formatDuration(consult.duration) !== '0 min' && (
              <span className="inline-flex items-center gap-1.5 text-gray-700">
                <Timer className="h-4 w-4 text-gray-400" /> {formatDuration(consult.duration)}
              </span>
            )}
          </div>

          {/* ── Treatment-plan value (editable, with source badge) ──────────── */}
          <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
              Actual treatment plan value - used in all reporting
            </p>
            {editingTx ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    autoFocus
                    className="input !w-40 !py-2 !pl-7 text-sm"
                    value={txInput}
                    onChange={(e) => setTxInput(e.target.value)}
                    placeholder="0"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveTxValue()
                      if (e.key === 'Escape') setEditingTx(false)
                    }}
                  />
                </div>
                <button onClick={saveTxValue} disabled={savingTx} className="btn-primary px-3 py-1.5 text-xs">
                  {savingTx ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Save
                </button>
                <button onClick={() => setEditingTx(false)} disabled={savingTx} className="btn-ghost px-3 py-1.5 text-xs">
                  <X className="h-3.5 w-3.5" /> Cancel
                </button>
                <span className="text-[11px] text-gray-400">Leave blank to clear.</span>
              </div>
            ) : (
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span className={`text-xl font-bold ${txDisp.tone}`} title={txDisp.tooltip || undefined}>
                  {txDisp.prefix}{txDisp.text}
                </span>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    txDisp.confirmed ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'
                  }`}
                  title={txDisp.tooltip || undefined}
                >
                  {txSourceLabel}
                </span>
                <button
                  onClick={() => {
                    // Pre-fill with the stored manual/PMS amount when present; never
                    // with an estimate so the TC types the real number deliberately.
                    setTxInput(txDisp.confirmed && Number(consult.tx_plan_value) > 0 ? String(consult.tx_plan_value) : '')
                    setEditingTx(true)
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
                  title="Edit treatment plan value"
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </button>
              </div>
            )}
          </div>

          {/* PMS data row */}
          {practice?.pms_connected && (consult.case_value > 0 || consult.pms_appointment_id) && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
              <span className="inline-flex items-center gap-1 font-medium text-green-700">
                <RefreshCcw className="h-3 w-3" /> PMS
              </span>
              {consult.case_value > 0 && (
                <span>Tx Plan Value: <span className="font-semibold text-gray-900">{formatMoney(consult.case_value)}</span></span>
              )}
              <span>· Status: <span className="text-gray-900">{consult.status === 'closed_won' ? 'Treatment Accepted' : 'Pending acceptance'}</span></span>
              {practice?.pms_last_sync && <span className="text-gray-400">· synced {new Date(practice.pms_last_sync).toLocaleDateString()}</span>}
            </div>
          )}

          {/* Attribution trail - what triggered the attribution */}
          {attrBadge && attribution?.explanation && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
              <span><span className="font-medium text-gray-700">{attrBadge.label}:</span> {attribution.explanation}</span>
            </div>
          )}

          {/* Transcription error - shown when speech-to-text failed */}
          {transcriptionError && (
            <div className="mt-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-red-800">Transcription failed</p>
                <p className="mt-0.5 text-sm text-red-700">{consult.transcript_error || 'Could not transcribe the recording.'}</p>
                <p className="mt-1 text-xs text-red-600">The consult was saved but could not be transcribed. Analysis and follow-up messages cannot be generated without a transcript.</p>
                <button
                  onClick={retryTranscription}
                  disabled={retryingTranscription}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-60"
                >
                  {retryingTranscription ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
                  Retry transcription
                </button>
              </div>
            </div>
          )}

          {/* Outcome decision - equal-weight button group inside the header */}
          <div className="mt-5 border-t border-gray-200 pt-4">
            <OutcomeControls
              consult={consult}
              holdHours={holdHours}
              scheduledCount={messages.filter((m) => ['draft', 'scheduled', 'pending'].includes(m.status)).length}
              onUpdated={(patch) => patchConsult(patch)}
            />
          </div>
        </Card>

        {/* ── Main content - two columns (60 / 40) ────────────────────────── */}
        <div className="grid gap-6 lg:grid-cols-5">
          {/* LEFT (60%) */}
          <div className="space-y-6 lg:col-span-3">
            {/* What happened - white card with a brand-red left accent */}
            <div className="rounded-xl border border-gray-200 border-l-[3px] border-l-red-600 bg-white p-5 shadow-sm">
              <SectionLabel>What Happened</SectionLabel>
              {stillProcessing ? (
                <SkeletonLines className="mt-3" />
              ) : consult.what_happened ? (
                <p className="mt-2 text-sm leading-relaxed text-gray-900">{stripEmDashes(consult.what_happened)}</p>
              ) : (
                <SkeletonLines className="mt-3" />
              )}
            </div>

            {/* CaseLift analysis */}
            <Card>
              <SectionLabel icon={Sparkles}>CaseLift Analysis</SectionLabel>
              {stillProcessing ? (
                <SkeletonLines lines={5} className="mt-4" />
              ) : (
                <div className="mt-4 space-y-5">
                  {/* Three stat boxes with colored left accents */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <StatBox label="CaseLift identified the primary objection as" accent="border-l-red-400">
                      {consult.objection_type || consult.primary_objection ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          {consult.objection_type && <span>{objectionMeta(consult.objection_type).label}</span>}
                          {consult.primary_objection && <span>{consult.primary_objection}</span>}
                        </span>
                      ) : (
                        DASH
                      )}
                    </StatBox>
                    <StatBox label="Secondary Objection" accent="border-l-orange-400">
                      {consult.secondary_objection || DASH}
                    </StatBox>
                    <StatBox label="Exit Intent" accent="border-l-blue-400">
                      {consult.exit_intent_level || consult.exit_intent ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          {consult.exit_intent_level && <span>{exitIntentMeta(consult.exit_intent_level).label}</span>}
                          {consult.exit_intent && <span className="font-normal text-gray-600">{consult.exit_intent}</span>}
                        </span>
                      ) : (
                        DASH
                      )}
                    </StatBox>
                  </div>

                  {/* Coaching insight - highlighted callout */}
                  {consult.coaching_insight && (
                    <div className="rounded-lg border border-gray-200 border-l-4 border-l-blue-500 bg-blue-50 p-4">
                      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-blue-700">
                        <Lightbulb className="h-3.5 w-3.5" /> CaseLift&apos;s coaching insight
                      </p>
                      <p className="mt-2 text-[15px] leading-relaxed text-gray-900">{stripEmDashes(consult.coaching_insight)}</p>
                    </div>
                  )}

                  {/* Personal detail (kept) */}
                  {consult.personal_detail && (
                    <div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                      <Heart className="mt-0.5 h-4 w-4 shrink-0 text-pink-400" />
                      <span>{stripEmDashes(consult.personal_detail)}</span>
                    </div>
                  )}

                  {/* Downsell + TC action side by side */}
                  {(consult.downsell_opportunity || consult.tc_action) && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {consult.downsell_opportunity && (
                        <div className="rounded-lg border border-gray-200 bg-white p-4">
                          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-500">
                            <TrendingDown className="h-3.5 w-3.5 text-green-600" /> Downsell Opportunity
                          </p>
                          <p className="mt-1.5 text-sm leading-relaxed text-gray-900">{stripEmDashes(consult.downsell_opportunity)}</p>
                        </div>
                      )}
                      {consult.tc_action && (
                        <div className="rounded-lg border border-gray-200 bg-white p-4">
                          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-500">
                            <ListChecks className="h-3.5 w-3.5 text-blue-600" /> CaseLift&apos;s recommended next step
                          </p>
                          <p className="mt-1.5 text-sm leading-relaxed text-gray-900">{stripEmDashes(consult.tc_action)}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </Card>
          </div>

          {/* RIGHT (40%) */}
          <div className="space-y-6 lg:col-span-2">
            {/* Patient information */}
            <Card>
              <div className="flex items-center justify-between gap-2">
                <SectionLabel icon={User}>Patient Information</SectionLabel>
                {linked && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
                    <Link2 className="h-3 w-3" /> PMS
                  </span>
                )}
              </div>
              {showPatient ? (
                <dl className="mt-3 space-y-2.5 text-sm">
                  <InfoRow icon={User} label="Name" value={heading} />
                  <InfoRow icon={Phone} label="Phone" value={phone || '-'} />
                  <InfoRow icon={Mail} label="Email" value={email || '-'} />
                  {appointment?.provider && <InfoRow icon={Stethoscope} label="Provider" value={appointment.provider} />}
                  {appointment?.appointment_time && <InfoRow icon={CalendarClock} label="Appointment" value={formatDateTime(appointment.appointment_time)} />}
                </dl>
              ) : (
                <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3">
                  <span className="text-sm text-gray-500">No appointment linked</span>
                  <button
                    onClick={() => setShowPatientEdit(true)}
                    className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
                  >
                    Enter patient info
                  </button>
                </div>
              )}
            </Card>

            {/* Follow-up sequence */}
            <Card>
              <div className="flex items-center justify-between gap-2">
                <SectionLabel icon={Send}>Follow-up Sequence</SectionLabel>
                {messages.length > 0 && <span className="text-xs text-gray-500">{messages.length}</span>}
              </div>

              {analysisPending && messages.length === 0 ? (
                <div className="mt-3 flex animate-pulse items-center gap-2 text-sm text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> CaseLift is drafting personalized messages…
                </div>
              ) : messages.length === 0 ? (
                <p className="mt-3 text-sm text-gray-500">No follow-up messages.</p>
              ) : (
                <div className="mt-3 space-y-3">
                  {needsFollowupApproval && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                      <p className="text-sm text-amber-900">Review the messages below, then approve to start the follow-up sequence.</p>
                      <button
                        type="button"
                        onClick={approveFollowup}
                        disabled={approvingFollowup}
                        className="mt-2 inline-flex items-center gap-2 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-500 disabled:opacity-60"
                      >
                        {approvingFollowup ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        Approve &amp; schedule follow-up
                      </button>
                    </div>
                  )}
                  <p className="text-sm text-gray-500">CaseLift drafted {messages.length} follow-up message{messages.length === 1 ? '' : 's'} for {heading}.</p>
                  {messages.map((m, i) => (
                    <EditableMessage
                      key={m.id}
                      m={m}
                      index={i}
                      practiceId={practiceId}
                      aiBaseline={aiBaselines[m.id]}
                      dayLabel={dayLabelForMessage(m, i)}
                      createdAt={consult.created_at}
                      rules={seqRules}
                      onChange={handleMessageChange}
                    />
                  ))}
                </div>
              )}

              <Link
                to="/conversations"
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 transition hover:text-primary-500"
              >
                <MessagesSquare className="h-4 w-4" /> View conversation thread
                {conversation?.unread_count > 0 && (
                  <span className="ml-0.5 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold !text-white">
                    {conversation.unread_count}
                  </span>
                )}
              </Link>
            </Card>
          </div>
        </div>

        {/* Transcript - de-identified, speaker-labeled, key moments highlighted.
            While transcription runs, show a live placeholder instead of an empty
            viewer (the page auto-refreshes every 10s via stillProcessing above). */}
        {!consult.transcript_deidentified && stillProcessing ? (
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-gray-400" />
            <p className="mt-3 text-sm font-medium text-gray-700">Transcript is being generated…</p>
            <p className="mt-1 text-xs text-gray-500">This updates automatically — you can leave and come back.</p>
          </div>
        ) : (
          <TranscriptViewer
            transcript={consult.transcript_deidentified}
            duration={consult.duration}
            source={consult.recording_source}
          />
        )}

        {showPatientEdit && (
          <PatientEditModal consult={consult} onClose={() => setShowPatientEdit(false)} onSave={savePatientInfo} />
        )}
        {wonOpen && (
          <WonModal
            consult={consult}
            onClose={() => setWonOpen(false)}
            onWon={(patch) => { patchConsult(patch); setWonOpen(false) }}
          />
        )}
      </div>
    </div>
  )
}

// "Mark as Won" modal: capture treatment + case value, attest CaseLift assisted,
// then close the consult and record the (assisted) win server-side.
function WonModal({ consult, onClose, onWon }) {
  const [treatment, setTreatment] = useState(consult.treatment_type || 'dental_implants')
  const [value, setValue] = useState(String(consult.tx_plan_value ?? consult.case_value ?? ''))
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (!confirmed || busy) return
    setBusy(true)
    setError('')
    const caseValue = Number(value) || 0
    const patch = {
      outcome: 'closed_won',
      status: 'closed_won',
      treatment_type: treatment,
      case_value: caseValue,
      tx_plan_value: caseValue,
      tx_plan_value_source: 'manual',
    }
    const { error: e } = await supabase.from('consults').update(patch).eq('id', consult.id)
    if (e) { setError(e.message || 'Could not mark as won.'); setBusy(false); return }
    // Record the assisted win + Slack alert (server-side; no-op if no sequence
    // messages were sent). Non-blocking — the consult is already marked won.
    try {
      await supabase.functions.invoke('record-win', {
        body: { consult_id: consult.id, source: 'manual', case_value: caseValue, treatment_type: treatment },
      })
    } catch { /* win logging is best-effort */ }
    setBusy(false)
    onWon(patch)
  }

  return (
    <Modal title="Mark as Won" onClose={onClose} maxWidth="max-w-md" footer={
      <>
        <button onClick={onClose} className="btn-ghost">Cancel</button>
        <button onClick={submit} disabled={!confirmed || busy} className="btn-primary">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Mark as Won
        </button>
      </>
    }>
      <div className="space-y-4">
        <div>
          <label className="label">Treatment type</label>
          <select className="input" value={treatment} onChange={(e) => setTreatment(e.target.value)}>
            {TREATMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Case value</label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
            <input type="number" min={0} step={100} className="input pl-7" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0" />
          </div>
        </div>
        <label className="flex items-start gap-2.5 text-sm text-slate-300">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-surface-600 bg-surface-800 text-primary focus:ring-primary/40" />
          CaseLift follow-up assisted in closing this case
        </label>
        {error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}
      </div>
    </Modal>
  )
}
