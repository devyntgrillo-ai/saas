import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  Clock,
  Timer,
  Heart,
  Lightbulb,
  TrendingDown,
  ListChecks,
  Mail,
  Phone,
  User,
  MessagesSquare,
  Sparkles,
  Send,
  CalendarClock,
  Loader2,
  X,
  AlertTriangle,
  Stethoscope,
  Link2,
  RefreshCcw,
  Pencil,
  Check,
  Trophy,
} from 'lucide-react'
import Modal from '../components/Modal'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { stripEmDashes } from '../lib/sanitize'
import { attributionStatusBadge } from '../lib/attribution'
import { useConsultDetail, useConsultAttribution, queryKeys } from '../lib/queries'
import { requestAnalysis, transcribeRecording } from '../lib/recording'
import OutcomeControls from '../components/OutcomeControls'
import { parseSequenceConfig } from '../lib/sequence'
import TranscriptViewer from '../components/TranscriptViewer'
import RecordingPlayer from '../components/RecordingPlayer'
import {
  formatDate,
  formatTime,
  formatDuration,
  formatDateTime,
  statusMeta,
  objectionMeta,
  exitIntentMeta,
} from '../lib/consults'
import {
  TREATMENT_TYPES,
  consultTxValue,
  txValueDisplay,
  TX_VALUE_SOURCES,
} from '../lib/treatments'

// ── Small presentational helpers ────────────────────────────────────────────

// Light card chrome — hairline border, generous padding, subtle shadow. Kept
// intentionally low-contrast so the page reads as a calm summary, not a grid of
// competing boxes.
function Card({ className = '', children }) {
  return <div className={`rounded-2xl border border-gray-100 bg-white p-5 shadow-sm ${className}`}>{children}</div>
}

// Subtle section heading.
function SectionLabel({ icon: Icon, children, className = '' }) {
  return (
    <p className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400 ${className}`}>
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

// A label / value row used in the analysis list — replaces the old boxed grid so
// the analysis reads as a clean, scannable list.
function AnalysisRow({ label, children }) {
  return (
    <div className="flex flex-col gap-0.5 py-3 sm:flex-row sm:gap-4">
      <dt className="shrink-0 text-xs font-medium uppercase tracking-wide text-gray-400 sm:w-40 sm:pt-0.5">{label}</dt>
      <dd className="min-w-0 text-sm text-gray-900">{children}</dd>
    </div>
  )
}

const DASH = <span className="font-normal text-gray-400">-</span>

// Light-mode status pill. Positive states green, in-progress blue, lost red,
// queued/transcription amber (recoverable), everything else neutral gray.
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
  transcription_error: 'bg-amber-100 text-amber-700',
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

// Format a ms remaining value as "23h 59m".
function fmtRemaining(ms) {
  if (ms <= 0) return 'now'
  const totalMin = Math.floor(ms / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `${h}h ${m}m`
}

// One labeled contact/detail line in the Patient card — the single place contact
// info lives (it used to be duplicated in the header).
function InfoRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
      <div className="min-w-0">
        {label && <p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p>}
        <p className="truncate text-sm text-gray-900">{value}</p>
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

  function refreshConsult() {
    queryClient.invalidateQueries({ queryKey: queryKeys.consult(id) })
    if (practiceId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(practiceId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.sequences(practiceId) })
    }
  }

  // Inline editing of the treatment-plan value.
  const [editingTx, setEditingTx] = useState(false)
  const [txInput, setTxInput] = useState('')
  const [savingTx, setSavingTx] = useState(false)
  const [savingTreatment, setSavingTreatment] = useState(false)

  // Activation hold (hours) from the practice's sequence settings; drives the
  // countdown before the first follow-up message can send.
  const holdHours = parseSequenceConfig(practice?.sequence_config).rules.holdHours || 24

  const triggeredRef = useRef(false)

  // Compact follow-up-sequence status (badge + one-liner). The full message
  // editor lives at /sequences — this page only summarizes. Memoized so the
  // current-time check stays out of the render path.
  const seqInfo = useMemo(() => {
    const status = consult?.sequence_status || 'active'
    const stopped =
      ['paused', 'cancelled'].includes(status) ||
      ['accepted', 'closed_won', 'not_converting'].includes(consult?.outcome || '')
    const firstSendAt = consult?.created_at ? new Date(consult.created_at).getTime() + holdHours * 3600 * 1000 : 0
    const remaining = firstSendAt - new Date().getTime()
    if (messages.length === 0) {
      return { label: 'Not Started', cls: 'bg-gray-100 text-gray-600', line: consult?.status === 'transcribed' ? 'CaseLift is drafting messages…' : null }
    }
    if (stopped) return { label: 'Stopped', cls: 'bg-gray-100 text-gray-600', line: 'Sequence is not running.' }
    if (remaining > 0) return { label: 'Scheduled', cls: 'bg-amber-100 text-amber-700', line: `First message sends in ${fmtRemaining(remaining)}` }
    return { label: 'Active', cls: 'bg-green-100 text-green-700', line: 'Sequence is sending.' }
  }, [consult, messages.length, holdHours])

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

  // Update the treatment type after recording (it was pulled from the PMS at
  // record time). Re-running analysis is the TC's choice via "Regenerate".
  async function saveTreatment(value) {
    if (!value || value === consult.treatment_type) return
    setSavingTreatment(true)
    const { error } = await supabase.from('consults').update({ treatment_type: value }).eq('id', consult.id)
    if (!error) patchConsult({ treatment_type: value })
    setSavingTreatment(false)
  }

  // Save the manually-entered treatment-plan value. An empty input clears it
  // (back to estimate / practice-default resolution). Otherwise it's stored with
  // source = 'manual', which is authoritative everywhere reporting reads tx value.
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
  const isWon = consult.outcome === 'closed_won' || ['closed_won', 'recovered'].includes(consult.status)

  // Resolved treatment-plan value + its display descriptor.
  const tx = consultTxValue(consult, practice)
  const txDisp = txValueDisplay(tx)
  const txSourceLabel = TX_VALUE_SOURCES[tx.source]?.label || 'Estimated'

  const hasAnalysis =
    consult.objection_type || consult.primary_objection || consult.secondary_objection ||
    consult.exit_intent_level || consult.exit_intent || consult.coaching_insight ||
    consult.personal_detail || consult.downsell_opportunity || consult.tc_action

  return (
    // Edge-bleed wrapper paints the whole content area gray-50 so white cards pop.
    <div className="-mx-4 -my-6 bg-gray-50 px-4 py-6 sm:-mx-6 sm:px-6 lg:-mx-8 lg:-my-8 lg:px-8 lg:py-8">
      <div className="mx-auto max-w-5xl">
        {/* Back link */}
        <Link
          to="/consults"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" /> Consults
        </Link>

        {/* ── Header (borderless — name, status, primary action) ──────────── */}
        <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="truncate text-[28px] font-bold leading-tight tracking-tight text-gray-900">{heading}</h1>
              {/* Treatment type - pulled from the PMS at record time, editable here. */}
              <span className="inline-flex items-center gap-1 rounded-full bg-white py-1 pl-2 pr-1 text-[11px] font-semibold text-gray-600 ring-1 ring-gray-200">
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
            {/* Meta line: appointment type + date / time / duration. No contact here. */}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
              <span>{apptType}</span>
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="h-4 w-4 text-gray-400" /> {formatDate(consult.recording_date)}
              </span>
              {consult.recording_time && (
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-gray-400" /> {formatTime(consult.recording_time)}
                </span>
              )}
              {formatDuration(consult.duration) && formatDuration(consult.duration) !== '0 min' && (
                <span className="inline-flex items-center gap-1.5">
                  <Timer className="h-4 w-4 text-gray-400" /> {formatDuration(consult.duration)}
                </span>
              )}
            </div>
          </div>

          {/* Status badge(s) + Mark as Won */}
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
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
              isWon ? (
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

        {/* Transcription error - amber (recoverable), not red. Full width. */}
        {transcriptionError && (
          <div className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-amber-800">Transcription failed</p>
              <p className="mt-0.5 text-sm text-amber-700">{consult.transcript_error || 'Failed to send a request to the Edge Function'}</p>
              <p className="mt-1 text-xs text-amber-600">The consult was saved but couldn’t be transcribed. This is recoverable — retry to generate the transcript, analysis, and follow-up messages.</p>
              <button
                onClick={retryTranscription}
                disabled={retryingTranscription}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-700 transition hover:bg-amber-50 disabled:opacity-60"
              >
                {retryingTranscription ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
                Retry Transcription
              </button>
            </div>
          </div>
        )}

        {/* ── Decision: treatment value + outcome (full width) ────────────── */}
        <Card className="mt-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <SectionLabel>Treatment plan value</SectionLabel>
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
                </div>
              ) : (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className={`text-2xl font-bold ${txDisp.tone}`} title={txDisp.tooltip || undefined}>
                    {txDisp.prefix}{txDisp.text}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      txDisp.confirmed ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                    }`}
                    title={txDisp.tooltip || undefined}
                  >
                    {txSourceLabel}
                  </span>
                  <button
                    onClick={() => {
                      setTxInput(txDisp.confirmed && Number(consult.tx_plan_value) > 0 ? String(consult.tx_plan_value) : '')
                      setEditingTx(true)
                    }}
                    className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs font-medium text-gray-400 transition hover:bg-gray-50 hover:text-gray-600"
                    title="Edit treatment plan value"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Outcome decision - compact button group */}
          <div className="mt-4 border-t border-gray-100 pt-4">
            <OutcomeControls
              consult={consult}
              holdHours={holdHours}
              scheduledCount={messages.filter((m) => ['draft', 'scheduled', 'pending'].includes(m.status)).length}
              onUpdated={(patch) => patchConsult(patch)}
            />
          </div>
        </Card>

        {/* ── Main content — summary/analysis (left) + sidebar (right) ────── */}
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          {/* LEFT — the read */}
          <div className="space-y-6 lg:col-span-2">
            {/* What happened */}
            <Card>
              <SectionLabel>What Happened</SectionLabel>
              {stillProcessing ? (
                <SkeletonLines className="mt-3" />
              ) : consult.what_happened ? (
                <p className="mt-2.5 text-[15px] leading-relaxed text-gray-800">{stripEmDashes(consult.what_happened)}</p>
              ) : (
                <SkeletonLines className="mt-3" />
              )}
            </Card>

            {/* CaseLift analysis */}
            <Card>
              <SectionLabel icon={Sparkles}>CaseLift Analysis</SectionLabel>
              {stillProcessing ? (
                <SkeletonLines lines={5} className="mt-4" />
              ) : !hasAnalysis ? (
                <p className="mt-3 text-sm text-gray-400">No analysis available for this consult.</p>
              ) : (
                <div className="mt-3 space-y-5">
                  {/* Objections + exit intent as a clean label/value list */}
                  <dl className="divide-y divide-gray-100">
                    <AnalysisRow label="Primary objection">
                      {consult.objection_type || consult.primary_objection ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          {consult.objection_type && <span className="font-medium">{objectionMeta(consult.objection_type).label}</span>}
                          {consult.primary_objection && <span className="text-gray-600">{consult.primary_objection}</span>}
                        </span>
                      ) : DASH}
                    </AnalysisRow>
                    <AnalysisRow label="Secondary objection">
                      {consult.secondary_objection || DASH}
                    </AnalysisRow>
                    <AnalysisRow label="Exit intent">
                      {consult.exit_intent_level || consult.exit_intent ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          {consult.exit_intent_level && <span className="font-medium">{exitIntentMeta(consult.exit_intent_level).label}</span>}
                          {consult.exit_intent && <span className="text-gray-600">{consult.exit_intent}</span>}
                        </span>
                      ) : DASH}
                    </AnalysisRow>
                  </dl>

                  {/* Coaching insight - the one highlighted callout */}
                  {consult.coaching_insight && (
                    <div className="rounded-xl border-l-[3px] border-l-blue-500 bg-blue-50/70 px-4 py-3">
                      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-blue-700">
                        <Lightbulb className="h-3.5 w-3.5" /> Coaching insight
                      </p>
                      <p className="mt-1.5 text-[15px] leading-relaxed text-gray-900">{stripEmDashes(consult.coaching_insight)}</p>
                    </div>
                  )}

                  {/* Recommended next step + downsell */}
                  {(consult.tc_action || consult.downsell_opportunity) && (
                    <div className="space-y-3">
                      {consult.tc_action && (
                        <div>
                          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                            <ListChecks className="h-3.5 w-3.5 text-blue-600" /> Recommended next step
                          </p>
                          <p className="mt-1 text-sm leading-relaxed text-gray-800">{stripEmDashes(consult.tc_action)}</p>
                        </div>
                      )}
                      {consult.downsell_opportunity && (
                        <div>
                          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                            <TrendingDown className="h-3.5 w-3.5 text-green-600" /> Downsell opportunity
                          </p>
                          <p className="mt-1 text-sm leading-relaxed text-gray-800">{stripEmDashes(consult.downsell_opportunity)}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Personal detail */}
                  {consult.personal_detail && (
                    <p className="flex items-start gap-2 text-sm text-gray-500">
                      <Heart className="mt-0.5 h-4 w-4 shrink-0 text-pink-400" />
                      <span>{stripEmDashes(consult.personal_detail)}</span>
                    </p>
                  )}
                </div>
              )}
            </Card>
          </div>

          {/* RIGHT — the facts */}
          <div className="space-y-6">
            {/* Patient — the single home for contact info */}
            <Card>
              <div className="flex items-center justify-between gap-2">
                <SectionLabel icon={User}>Patient</SectionLabel>
                {linked && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
                    <Link2 className="h-3 w-3" /> PMS
                  </span>
                )}
              </div>
              {showPatient ? (
                <dl className="mt-3 space-y-3">
                  <InfoRow icon={User} label="Name" value={heading} />
                  <InfoRow icon={Phone} label="Phone" value={phone || '-'} />
                  <InfoRow icon={Mail} label="Email" value={email || '-'} />
                  {appointment?.provider && <InfoRow icon={Stethoscope} label="Provider" value={appointment.provider} />}
                  {appointment?.appointment_time && <InfoRow icon={CalendarClock} label="Appointment" value={formatDateTime(appointment.appointment_time)} />}
                </dl>
              ) : (
                <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-3">
                  <span className="text-sm text-gray-500">No appointment linked</span>
                  <button
                    onClick={() => setShowPatientEdit(true)}
                    className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
                  >
                    Enter info
                  </button>
                </div>
              )}
              {attrBadge && attribution?.explanation && (
                <p className="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-500">
                  <span className="font-medium text-gray-600">{attrBadge.label}:</span> {attribution.explanation}
                </p>
              )}
            </Card>

            {/* Follow-up sequence - compact status. Full editor lives at /sequences. */}
            <Card>
              <SectionLabel icon={Send}>Follow-Up Sequence</SectionLabel>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${seqInfo.cls}`}>
                  {seqInfo.label}
                </span>
                {messages.length > 0 && (
                  <span className="text-xs text-gray-500">{messages.length}-touch sequence</span>
                )}
              </div>
              {seqInfo.line && <p className="mt-2 text-sm text-gray-600">{seqInfo.line}</p>}
              <button
                onClick={() => navigate('/sequences')}
                className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              >
                View Sequence <ArrowRight className="h-4 w-4" />
              </button>
              <Link
                to="/conversations"
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 transition hover:text-primary-500"
              >
                <MessagesSquare className="h-4 w-4" /> View conversation thread
                {conversation?.unread_count > 0 && (
                  <span className="ml-0.5 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold !text-white">
                    {conversation.unread_count}
                  </span>
                )}
              </Link>
            </Card>

            {/* Notes (only when present) */}
            {consult.outcome_note && (
              <Card>
                <SectionLabel>Notes</SectionLabel>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{stripEmDashes(consult.outcome_note)}</p>
              </Card>
            )}
          </div>
        </div>

        {/* Recording playback. Always shown so it's clear whether audio exists;
            plays when retained, otherwise explains why there's nothing to play. */}
        <div className="mt-6">
          <RecordingPlayer
            consultId={consult.id}
            hasAudio={Boolean(consult.audio_storage_path)}
            processing={stillProcessing}
            deletedAt={consult.audio_deleted_at}
            retentionDays={practice?.audio_retention_days ?? 30}
          />
        </div>

        {/* Transcript - de-identified, speaker-labeled, key moments highlighted.
            While transcription runs, show a live placeholder instead of an empty
            viewer (the page auto-refreshes every 10s via stillProcessing above). */}
        <div className="mt-6">
          {!consult.transcript_deidentified && stillProcessing ? (
            <div className="rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-sm">
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
        </div>

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
