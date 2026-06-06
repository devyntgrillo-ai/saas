import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  GitBranch,
  Search,
  ExternalLink,
  Loader2,
  Clock,
  CheckCircle2,
  ChevronUp,
  ChevronDown,
  X,
  MessageSquare,
  Mail,
  Phone,
  Sliders,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { useSequences, useToggleSequenceStatus, useUpdateSequenceMessage, useSequencesRealtime, useProcessingConsults, useConsultsRealtime, queryKeys } from '../lib/queries'
import { useRecentRecordings } from '../lib/recentRecordings'
import { stripEmDashes } from '../lib/sanitize'
import {
  parseSequenceConfig,
  TIMING_PRESETS,
  computeScheduledFor,
  rulesFromConfig,
} from '../lib/sequence'
import { treatmentLabel, objectionLabel } from '../lib/treatments'
import { SkeletonStatGrid, SkeletonTable } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import ReactivationCampaigns, { ReactivationLaunchButton } from '../components/ReactivationCampaigns'
import SequenceSettings from './SequenceSettings'

const PAGE = 50

const PENDING_MSG = ['draft', 'scheduled', 'pending']
const SENT_MSG = ['sent', 'opened', 'replied']

// Single status per row. Priority order (highest wins) is applied in deriveRow.
// One word, one color. text-slate-200 for Active maps to near-black in light mode
// (via the index.css light overrides) and stays light in dark mode.
const STATUS = {
  won:       { label: 'Won',       cls: 'text-gray-400' },
  not_fit:   { label: 'Not a Fit', cls: 'text-gray-400' },
  replied:   { label: 'Replied',   cls: 'text-green-600' },
  paused:    { label: 'Paused',    cls: 'text-amber-600' },
  pending:   { label: 'Pending',   cls: 'text-amber-500' },
  active:    { label: 'Active',    cls: 'text-slate-200 font-semibold' },
  completed: { label: 'Completed', cls: 'text-gray-400' },
}
// Order for the "Status" column sort.
const STATUS_ORDER = ['active', 'pending', 'paused', 'replied', 'completed', 'won', 'not_fit']
// Which summary-card / filter bucket each status falls into ('done' = not shown).
const FILTER_BUCKET = {
  active: 'active', pending: 'pending', paused: 'paused', replied: 'paused',
  completed: 'completed', won: 'done', not_fit: 'done',
}

function StatusText({ sk }) {
  const meta = STATUS[sk]
  if (!meta) return <span className="text-slate-600">-</span>
  return <span className={`text-sm font-medium ${meta.cls}`}>{meta.label}</span>
}

// Standard smooth pill toggle. ON = sending, OFF = paused. Disabled (and forced
// off) once the sequence has ended (Won / Not a Fit).
function RowToggle({ on, disabled, busy, onClick }) {
  const isOn = on && !disabled
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isOn}
      disabled={disabled || busy}
      onClick={onClick}
      title={disabled ? 'Sequence ended' : isOn ? 'Pause sequence' : 'Resume sequence'}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${isOn ? 'bg-primary' : 'bg-surface-600'} ${disabled ? 'cursor-not-allowed opacity-40' : busy ? 'opacity-60' : ''}`}
    >
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition ${isOn ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
    </button>
  )
}

// "18h 30m" / "2d 4h" / "5m" / "now"
function fmtRemaining(ms) {
  if (ms <= 0) return 'now'
  const totalMin = Math.floor(ms / 60000)
  const d = Math.floor(totalMin / 1440)
  const h = Math.floor((totalMin % 1440) / 60)
  const m = totalMin % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

// Objection visual config (dot color + label).
const OBJ = {
  price: { dot: 'bg-amber-500', label: 'Price' },
  fear: { dot: 'bg-red-500', label: 'Fear' },
  spouse: { dot: 'bg-purple-500', label: 'Spouse' },
  timing: { dot: 'bg-blue-500', label: 'Timing' },
}

const isCallMsg = (m) => m.channel === 'call' || m.type === 'call'

// Resolve a touchpoint's day-offset for display/editing. Prefer the stored
// send_day; otherwise derive it from scheduled_for relative to the consult's
// created_at. Never returns the em dash that used to show for null send_day.
function dayOf(m, baseMs) {
  if (m.send_day != null) return m.send_day
  if (m.scheduled_for) return Math.max(0, Math.round((new Date(m.scheduled_for).getTime() - baseMs) / 86400000))
  return 0
}

// Status badge for a single message row (Sent / Pending / Draft).
const MSG_STATUS = {
  sent: { label: 'Sent', classes: 'bg-emerald-500/15 text-emerald-300' },
  pending: { label: 'Pending', classes: 'bg-amber-500/15 text-amber-300' },
  draft: { label: 'Draft', classes: 'bg-slate-500/15 text-slate-400' },
}
const msgStatusKind = (s) => (SENT_MSG.includes(s) ? 'sent' : s === 'draft' ? 'draft' : 'pending')
const channelIcon = (m) => (isCallMsg(m) ? Phone : m.channel === 'email' ? Mail : MessageSquare)
const msgPreview = (m) => stripEmDashes((m.subject || m.body || (isCallMsg(m) ? 'Manual call - talking points' : '')).replace(/\s+/g, ' ').trim())

// Ordered touchpoints with display state for the mini sequence visualization.
function buildViz(msgs, now) {
  const todayStr = new Date(now).toLocaleDateString('en-CA')
  return [...(msgs || [])]
    .filter((m) => m.status !== 'cancelled')
    .sort((a, b) => (a.send_day ?? 99) - (b.send_day ?? 99) || new Date(a.scheduled_for || a.created_at) - new Date(b.scheduled_for || b.created_at))
    .slice(0, 7)
    .map((m) => {
      let state = 'future'
      if (['sent', 'opened', 'replied'].includes(m.status)) state = 'sent'
      else if (m.scheduled_for) {
        const at = new Date(m.scheduled_for).getTime()
        const sameDay = String(m.scheduled_for).slice(0, 10) === todayStr
        if (sameDay) state = 'today'
        else if (at < now) state = 'overdue'
        else state = 'future'
      }
      return { channel: m.channel, isCall: isCallMsg(m), state, day: m.send_day }
    })
}

// Derive everything we render for one consult + its messages.
function deriveRow(c, holdMs, now) {
  const msgs = c.messages || []
  const createdMs = new Date(c.created_at).getTime()
  const firstSendAt = createdMs + holdMs
  const outcome = c.outcome || 'pending'

  // Back-compat: rows created before sequence_status existed (and demo seeds)
  // only have the legacy sequence_cancelled_at/reason. Derive an effective state.
  let seqStatus = c.sequence_status || 'active'
  let pausedReason = c.sequence_paused_reason
  if (seqStatus === 'active' && c.sequence_cancelled_at) {
    if (c.sequence_cancelled_reason === 'Stopped by TC') { seqStatus = 'paused'; pausedReason = pausedReason || 'manual' }
    else seqStatus = 'cancelled'
  }

  const sent = msgs.filter((m) => SENT_MSG.includes(m.status))
  const pending = msgs
    .filter((m) => PENDING_MSG.includes(m.status))
    .sort((a, b) => new Date(a.scheduled_for || a.created_at) - new Date(b.scheduled_for || b.created_at))
  const total = msgs.length
  const inHold = outcome === 'pending' && seqStatus === 'active' && now - createdMs < holdMs

  // ── Single status (priority order) ─────────────────────────────────────────
  let status
  if (outcome === 'accepted' || outcome === 'closed_won') status = 'won'
  else if (outcome === 'not_converting') status = 'not_fit'
  else if (seqStatus === 'cancelled') status = 'won'
  else if (outcome === 'rescheduled') status = 'paused' // resumes at Day 30
  else if (seqStatus === 'paused') status = pausedReason === 'reply' ? 'replied' : 'paused'
  else if (inHold) status = 'pending'
  else if (pending.length === 0 && total > 0) status = 'completed'
  else status = 'active'

  // On/off toggle: ON when actively sending; disabled once the sequence has ended
  // (Won / Not a Fit) or is in the outcome-managed rescheduled hold.
  const toggleOn = status === 'active' || status === 'pending' || status === 'completed'
  const toggleDisabled = status === 'won' || status === 'not_fit' || outcome === 'rescheduled'

  // ── Next message label + sort key ──────────────────────────────────────────
  let nextLabel
  let sortNext = Infinity
  if (status === 'replied') nextLabel = 'CaseLift paused this sequence - patient replied'
  else if (status === 'paused') nextLabel = 'Paused'
  else if (status === 'won') nextLabel = 'Sequence ended'
  else if (status === 'not_fit') nextLabel = 'Not a fit'
  else if (status === 'completed') nextLabel = 'Sequence complete'
  else if (status === 'pending') {
    nextLabel = `CaseLift is ready to follow up - starts in ${fmtRemaining(firstSendAt - now)}`
    sortNext = firstSendAt
  } else {
    // active - earliest future scheduled message
    const future = pending.find((m) => m.scheduled_for && new Date(m.scheduled_for).getTime() > now)
    const next = future || pending[0]
    if (next) {
      const day = next.send_day != null ? `Day ${next.send_day}` : 'Next'
      const ch = (next.channel || 'sms').toUpperCase()
      if (next.scheduled_for) {
        const at = new Date(next.scheduled_for).getTime()
        sortNext = at
        nextLabel = `${day} · ${ch} · ${at > now ? `sends in ${fmtRemaining(at - now)}` : 'sending now'}`
      } else {
        sortNext = now
        nextLabel = `${day} · ${ch} · awaiting approval`
      }
    } else {
      nextLabel = 'Sequence complete'
    }
  }

  return {
    id: c.id,
    name: c.patient_name || 'Unknown patient',
    phone: c.patient_phone || c.patient_email || '',
    email: c.patient_email || '',
    outcome,
    status,
    bucket: FILTER_BUCKET[status],
    toggleOn,
    toggleDisabled,
    sent: sent.length,
    total,
    ratio: total > 0 ? sent.length / total : 0,
    nextLabel,
    sortNext,
    objection: c.objection_type || c.primary_objection || null,
    objectionLabel: objectionLabel(c.objection_type || c.primary_objection),
    serviceType: treatmentLabel(c.treatment_type),
    vizPoints: buildViz(msgs, now),
    raw: c,
  }
}

function SummaryCard({ label, value, tone }) {
  const tones = {
    green: 'text-emerald-300',
    amber: 'text-amber-300',
    blue: 'text-sky-300',
    slate: 'text-slate-300',
  }
  return (
    <div className="rounded-xl border border-white/[0.07] bg-surface-900 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1.5 text-2xl font-bold ${tones[tone]}`}>{value}</p>
    </div>
  )
}

function SortHeader({ label, col, sort, dir, onSort, className = '' }) {
  const active = sort === col
  return (
    <button
      onClick={() => onSort(col)}
      className={`inline-flex items-center gap-1 text-left text-xs font-semibold uppercase tracking-wide transition ${active ? 'text-slate-300' : 'text-slate-500 hover:text-slate-300'} ${className}`}
    >
      {label}
      {active && (dir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
    </button>
  )
}

// Connected dots: green=sent, blue=today, grey=future, red=overdue. Calls get a
// phone glyph. The current position (first non-sent) pulses.
function MiniSequenceViz({ points }) {
  const stateCls = { sent: 'bg-emerald-500', today: 'bg-sky-500', future: 'bg-transparent border border-slate-500', overdue: 'bg-red-500' }
  const currentIdx = points.findIndex((p) => p.state !== 'sent')
  return (
    <div className="flex items-center">
      {points.map((p, i) => (
        <div key={i} className="flex items-center">
          {i > 0 && <span className="h-px w-3 bg-slate-600" />}
          {p.isCall ? (
            <Phone className={`h-3.5 w-3.5 ${p.state === 'sent' ? 'text-emerald-400' : p.state === 'overdue' ? 'text-red-400' : p.state === 'today' ? 'text-sky-400' : 'text-amber-400'} ${i === currentIdx ? 'animate-pulse' : ''}`} />
          ) : (
            <span className={`inline-block rounded-full ${stateCls[p.state]} ${i === currentIdx ? 'h-3 w-3 animate-pulse ring-2 ring-sky-400/40' : 'h-2.5 w-2.5'}`} />
          )}
        </div>
      ))}
    </div>
  )
}

const titleCaseObj = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '')

// ── Timing editor (GHL-style) ───────────────────────────────────────────────
// Full-screen overlay + centered modal. Each touchpoint is an editable row with
// an inline "Day" number input. Saving re-stamps send_day + scheduled_for on the
// messages table. Already-sent touchpoints are read-only and grayed.
function TimingEditorModal({ row, practice, onClose, onSaved }) {
  const c = row.raw
  const baseMs = new Date(c.created_at).getTime()
  const rules = rulesFromConfig(practice?.sequence_config, practice?.timezone)
  const msgs = useMemo(
    () =>
      [...(c.messages || [])]
        .filter((m) => m.status !== 'cancelled')
        .sort((a, b) => (a.send_day ?? 99) - (b.send_day ?? 99) || new Date(a.scheduled_for || a.created_at) - new Date(b.scheduled_for || b.created_at)),
    [c.messages]
  )
  const [days, setDays] = useState(() => Object.fromEntries(msgs.map((m) => [m.id, String(dayOf(m, baseMs))])))
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    for (const m of msgs) {
      if (SENT_MSG.includes(m.status)) continue // can't reschedule a sent message
      const day = Math.max(0, Math.round(Number(days[m.id]) || 0))
      const scheduled_for = computeScheduledFor(c.created_at, day, rules)
      await supabase
        .from('messages')
        .update({ send_day: day, scheduled_for, status: m.status === 'draft' ? 'scheduled' : m.status })
        .eq('id', m.id)
    }
    setBusy(false)
    onSaved?.()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex max-h-[85vh] w-full max-w-[680px] flex-col overflow-hidden rounded-xl border border-surface-700 bg-surface-900 shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-surface-700 px-5 py-4">
          <h2 className="text-base font-semibold text-white">Edit Sequence Timing - {row.name}</h2>
          <button onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-surface-800 hover:text-white"><X className="h-5 w-5" /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="space-y-0">
            {msgs.map((m, i) => {
              const Icon = channelIcon(m)
              const sent = SENT_MSG.includes(m.status)
              const kind = msgStatusKind(m.status)
              const badge = MSG_STATUS[kind]
              return (
                <div key={m.id}>
                  {i > 0 && (
                    <div className="flex items-center justify-center py-1 text-slate-500">
                      <span className="text-sm leading-none">↓</span>
                    </div>
                  )}
                  <div className={`flex items-center gap-3 rounded-lg border border-surface-700 bg-surface-800/40 px-3 py-3 ${sent ? 'opacity-60' : ''}`}>
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-700 text-xs font-semibold text-slate-300">{i + 1}</span>
                    <Icon className="h-4 w-4 shrink-0 text-primary-500" />
                    <p className="min-w-0 flex-1 truncate text-xs italic text-slate-400">{msgPreview(m) || '-'}</p>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="text-xs font-medium text-slate-500">Day</span>
                      {sent ? (
                        <span className="w-14 rounded-md border border-surface-700 bg-surface-800 px-2 py-1 text-center text-sm text-slate-400">{dayOf(m, baseMs)}</span>
                      ) : (
                        <input
                          type="number"
                          min="0"
                          value={days[m.id]}
                          onChange={(e) => setDays((prev) => ({ ...prev, [m.id]: e.target.value }))}
                          className="w-14 rounded-md border border-surface-700 bg-surface-700 px-2 py-1 text-center text-sm text-slate-100 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-500/30"
                        />
                      )}
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.classes}`}>{badge.label}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-4 border-t border-surface-700 px-5 py-3.5">
          <button onClick={onClose} className="text-sm font-medium text-slate-400 transition hover:text-slate-200">Cancel</button>
          <button onClick={save} disabled={busy} className="btn-danger text-sm">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save timing
          </button>
        </div>
      </div>
    </div>
  )
}

// Patient detail modal: consult summary + workflow editor (touchpoints).
// Centered modal (replaces the old right slide-over that covered the page).
function SequenceDrawer({ row, practice, onClose, onChanged, onReload }) {
  const c = row?.raw
  const [expanded, setExpanded] = useState(null)
  const [editingTiming, setEditingTiming] = useState(false)
  // Local copy of messages so inline edits / regenerate reflect immediately.
  // Re-seed (during render) when a different consult is opened, per the React
  // "adjusting state when a prop changes" pattern (avoids a sync effect).
  const [localMsgs, setLocalMsgs] = useState(() => c?.messages || [])
  const [seededId, setSeededId] = useState(c?.id)
  if (c?.id !== seededId) {
    setSeededId(c?.id)
    setLocalMsgs(c?.messages || [])
  }
  // Inline message editing state.
  const [editingMsg, setEditingMsg] = useState(null) // message id
  const [draft, setDraft] = useState({ subject: '', body: '' })
  const [savingMsg, setSavingMsg] = useState(false)
  const [msgError, setMsgError] = useState(null)
  // Regenerate state.
  const [regenNote, setRegenNote] = useState('')
  const [regenerating, setRegenerating] = useState(false)
  const [regenError, setRegenError] = useState(null)
  if (!row) return null

  const baseMs = new Date(c.created_at).getTime()
  const msgs = [...(localMsgs || [])]
    .filter((m) => m.status !== 'cancelled')
    .sort((a, b) => (a.send_day ?? 99) - (b.send_day ?? 99) || new Date(a.scheduled_for || a.created_at) - new Date(b.scheduled_for || b.created_at))

  function startEdit(m) {
    setMsgError(null)
    setEditingMsg(m.id)
    setDraft({ subject: stripEmDashes(m.subject || ''), body: stripEmDashes(m.body || '') })
  }

  async function saveMsg(m) {
    setSavingMsg(true)
    setMsgError(null)
    const patch = m.channel === 'email'
      ? { subject: draft.subject, body: draft.body }
      : { body: draft.body }
    const { error } = await supabase.from('messages').update(patch).eq('id', m.id)
    setSavingMsg(false)
    if (error) { setMsgError('Could not save. Please try again.'); return }
    setLocalMsgs((prev) => prev.map((x) => (x.id === m.id ? { ...x, ...patch } : x)))
    setEditingMsg(null)
    onReload?.()
  }

  async function regenerate() {
    setRegenerating(true)
    setRegenError(null)
    const { error } = await supabase.functions.invoke('analyze-consult', {
      body: { consult_id: c.id, regenerate: true, note: regenNote || '' },
    })
    if (error) { setRegenerating(false); setRegenError('Regeneration failed. Please try again.'); return }
    // Reload this consult's messages from the DB.
    const { data } = await supabase
      .from('messages')
      .select('id, status, channel, type, subject, body, scheduled_for, send_day, sent_at, created_at')
      .eq('consult_id', c.id)
    if (data) setLocalMsgs(data)
    setRegenerating(false)
    setRegenNote('')
    setExpanded(null)
    onReload?.()
  }
  const preset = c.sequence_timing_preset || c.exit_intent_level || 'warm'
  const presetMeta = TIMING_PRESETS[preset] || TIMING_PRESETS.warm
  const doctorLast = practice?.doctor_last || 'Smith'
  const tcName = practice?.tc_name || 'Sara'

  function daysSince() {
    if (!c.recording_date && !c.created_at) return 'a few days'
    const d = new Date(c.recording_date || c.created_at)
    const n = Math.round((Date.now() - d.getTime()) / 86400000)
    return `${Math.max(0, n)} day${n === 1 ? '' : 's'}`
  }
  const objResponse = {
    price: 'I hear you on cost. We have financing that breaks this into a comfortable monthly payment, and I can lock in your plan pricing.',
    fear: 'It is completely normal to feel nervous. Many of our patients did too. We offer sedation and go at your pace.',
    spouse: 'Totally understand wanting to talk it over. Would a quick joint call help so you both have the same info?',
    timing: 'No rush at all. I just want to make sure you have everything for whenever the time is right.',
  }[c.objection_type] || 'Happy to answer any questions and find an approach that fits your situation.'

  const iconFor = (m) => (isCallMsg(m) ? Phone : m.channel === 'email' ? Mail : MessageSquare)

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
        <div className="relative z-10 flex max-h-[85vh] w-full max-w-[680px] flex-col overflow-hidden rounded-xl border border-surface-700 bg-surface-900 shadow-2xl">
          <div className="flex shrink-0 items-center justify-between border-b border-surface-700 px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-white">{row.name}</h2>
              <p className="text-xs text-slate-500">{row.serviceType}</p>
            </div>
            <button onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-surface-800 hover:text-white"><X className="h-5 w-5" /></button>
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
            {/* Consult summary */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Consult summary</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-primary/15 px-2.5 py-0.5 font-medium text-primary-300">{treatmentLabel(c.treatment_type)}</span>
                {(c.objection_type || c.primary_objection) && <span className="rounded-full bg-surface-800 px-2 py-0.5 text-slate-300">Objection: {objectionLabel(c.objection_type || c.primary_objection)}</span>}
                {(c.exit_intent_level || c.exit_intent) && <span className="rounded-full bg-surface-800 px-2 py-0.5 text-slate-300">Exit: {titleCaseObj(c.exit_intent_level || c.exit_intent)}</span>}
              </div>
              {c.personal_detail && <p className="mt-2 text-sm italic text-slate-400">“{stripEmDashes(c.personal_detail)}”</p>}
              {c.what_happened && <p className="mt-2 text-sm leading-relaxed text-slate-300">{stripEmDashes(c.what_happened)}</p>}
            </div>

            {/* Smart timing */}
            <div className="rounded-lg bg-surface-800/60 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-300"><span className="font-semibold text-white">{presetMeta.label} sequence</span> · {msgs.length} touchpoints</p>
                <button onClick={() => setEditingTiming(true)} className="inline-flex items-center gap-1 text-xs font-medium text-primary-300 hover:underline"><Sliders className="h-3.5 w-3.5" /> Change timing</button>
              </div>
              <p className="mt-1.5 text-xs text-slate-400">
                CaseLift is following up with {row.name} — {msgs.length} message{msgs.length === 1 ? '' : 's'}
                {msgs.length > 0 && (
                  <> through day {Math.max(...msgs.map((m) => dayOf(m, new Date(c.created_at).getTime())))}</>
                )}.
              </p>
            </div>

            {/* Regenerate messages */}
            <div className="rounded-lg border border-surface-700 bg-surface-800/40 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Regenerate messages</p>
              <p className="mt-1 text-xs text-slate-400">Re-run the AI on this consult to rewrite all 6 messages. Add an optional note to steer the rewrite.</p>
              <input
                value={regenNote}
                onChange={(e) => setRegenNote(e.target.value)}
                disabled={regenerating}
                placeholder='e.g. "Focus on financing options" or "Patient mentioned she&apos;s a nurse"'
                className="input mt-2"
              />
              <div className="mt-2 flex items-center gap-3">
                <button onClick={regenerate} disabled={regenerating} className="btn-primary text-sm">
                  {regenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Regenerate
                </button>
                {regenError && <span className="text-xs text-red-400">{regenError}</span>}
                {regenerating && <span className="text-xs text-slate-400">Rewriting messages…</span>}
              </div>
            </div>

            {/* Workflow editor */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Sequence</p>
              <div className="space-y-2">
                {msgs.map((m, i) => {
                  const Icon = iconFor(m)
                  const call = isCallMsg(m)
                  const open = expanded === m.id
                  return (
                    <div key={m.id} className={`rounded-lg border ${call ? 'border-amber-500/30 bg-amber-500/[0.04]' : 'border-surface-700 bg-surface-800/40'}`}>
                      <button onClick={() => setExpanded(open ? null : m.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-700 text-xs font-semibold text-slate-300">{i + 1}</span>
                        <Icon className={`h-4 w-4 shrink-0 ${call ? 'text-amber-400' : 'text-slate-400'}`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-200">Day {dayOf(m, baseMs)}{call ? ' · Manual call' : ''}</p>
                          <p className="truncate text-xs text-slate-500">{stripEmDashes((m.subject || m.body || (call ? 'Call talking points' : '')).slice(0, 60))}</p>
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${m.status === 'sent' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-500/15 text-slate-400'}`}>{m.status}</span>
                      </button>
                      {open && (
                        <div className="border-t border-surface-700 px-3 py-3 text-sm">
                          {call ? (
                            <div className="space-y-1.5 text-slate-300">
                              <p className="text-xs font-semibold uppercase text-amber-400">Manual call action</p>
                              <p><span className="text-slate-500">Opening:</span> “Hi {row.name?.split(' ')[0] || 'there'}, this is {tcName} from Dr. {doctorLast}'s office...”</p>
                              <p><span className="text-slate-500">Context:</span> {daysSince()} since their consult about {row.serviceType.toLowerCase()}.</p>
                              {c.personal_detail && <p><span className="text-slate-500">Reference:</span> {stripEmDashes(c.personal_detail)}</p>}
                              {c.tc_action && <p><span className="text-slate-500">CaseLift&apos;s recommended next step:</span> {stripEmDashes(c.tc_action)}</p>}
                              <p><span className="text-slate-500">If they object:</span> {objResponse}</p>
                            </div>
                          ) : editingMsg === m.id ? (
                            <div className="space-y-2">
                              {m.channel === 'email' && (
                                <div>
                                  <label className="label">Subject</label>
                                  <input
                                    value={draft.subject}
                                    onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))}
                                    className="input"
                                  />
                                </div>
                              )}
                              <div>
                                <label className="label">{m.channel === 'email' ? 'Body' : 'Message'}</label>
                                <textarea
                                  value={draft.body}
                                  onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                                  rows={m.channel === 'email' ? 6 : 4}
                                  className="input resize-y"
                                />
                                {m.channel !== 'email' && (
                                  <p className="mt-1 text-right text-[10px] text-slate-500">{draft.body.length} chars</p>
                                )}
                              </div>
                              {msgError && <p className="text-xs text-red-400">{msgError}</p>}
                              <div className="flex items-center justify-end gap-3">
                                <button onClick={() => { setEditingMsg(null); setMsgError(null) }} className="text-sm font-medium text-slate-400 transition hover:text-slate-200">Cancel</button>
                                <button onClick={() => saveMsg(m)} disabled={savingMsg} className="btn-primary text-sm">
                                  {savingMsg ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-1.5">
                              {m.subject && <p className="font-medium text-slate-200">{stripEmDashes(m.subject)}</p>}
                              <p className="whitespace-pre-wrap leading-relaxed text-slate-300">{stripEmDashes(m.body)}</p>
                              <div className="pt-1">
                                <button onClick={() => startEdit(m)} className="text-xs font-medium text-primary-300 hover:underline">Edit message</button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {editingTiming && (
        <TimingEditorModal
          row={row}
          practice={practice}
          onClose={() => setEditingTiming(false)}
          onSaved={() => { setEditingTiming(false); onChanged?.() }}
        />
      )}
    </>
  )
}

// ── Pending sequence card (consult still being analyzed) ───────────────────
const PENDING_SEQ_CSS = `
.psq-shimmer { background: linear-gradient(90deg, rgba(148,163,184,.08) 25%, rgba(148,163,184,.22) 50%, rgba(148,163,184,.08) 75%); background-size:200% 100%; animation: psqShimmer 1.5s linear infinite; }
@keyframes psqShimmer { from { background-position:200% 0 } to { background-position:-200% 0 } }
@keyframes psqDot { 0%,100% { opacity:.4 } 50% { opacity:1 } }
.psq-dot { animation: psqDot 1.2s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .psq-shimmer,.psq-dot { animation: none !important } }
`

function PendingSequenceCard({ c }) {
  const name = c.patient_name || [c.patient_first, c.patient_last].filter(Boolean).join(' ') || 'New patient'
  return (
    <Link
      to={`/consults/${c.id}/processing`}
      className="block rounded-xl border border-amber-400/25 bg-amber-400/[0.04] p-4 transition hover:bg-amber-400/[0.08]"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-sm font-semibold text-slate-100">{name} — Building Sequence</p>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/15 px-2.5 py-1 text-[11px] font-medium text-amber-300">
          <span className="psq-dot h-1.5 w-1.5 rounded-full bg-amber-400" /> ⚡ Building sequence...
        </span>
      </div>
      <p className="mt-1.5 text-xs text-slate-400">
        Follow-up messages are being built based on the consult analysis. Check back shortly.
      </p>
      {/* Shimmer where the message preview would be */}
      <div className="mt-3 space-y-1.5">
        <div className="psq-shimmer h-2.5 w-3/4 rounded" />
        <div className="psq-shimmer h-2.5 w-1/2 rounded" />
      </div>
    </Link>
  )
}

export default function Sequences() {
  const { practiceId, practice } = useAuth()
  const queryClient = useQueryClient()
  const { data: rows = [], isLoading: loading, refetch } = useSequences(practiceId)
  useSequencesRealtime(practiceId)
  // Consults still being analyzed have no messages yet, so they're excluded from
  // the sequence list — surface them as "pending" cards at the top instead.
  const { data: processing = [] } = useProcessingConsults(practiceId)
  useConsultsRealtime(practiceId)
  // Just-recorded consults (client-side) so the "Generating sequence…" card
  // shows the instant a recording is submitted, even before its row loads.
  const recentRecordings = useRecentRecordings(practiceId)
  // Drop pending cards for consults whose sequence has already loaded into the
  // real list, so the card and its row never show at the same time.
  const pendingCards = useMemo(() => {
    const rowIds = new Set(rows.map((r) => r.id))
    const map = new Map()
    processing.forEach((c) => { if (!rowIds.has(c.id)) map.set(c.id, c) })
    recentRecordings.forEach((r) => {
      if (!rowIds.has(r.id) && !map.has(r.id)) map.set(r.id, { id: r.id, patient_name: r.name || undefined, status: 'analyzing' })
    })
    return [...map.values()]
  }, [processing, recentRecordings, rows])
  const toggleSeqMutation = useToggleSequenceStatus()
  const updateMsgMutation = useUpdateSequenceMessage()
  const [drawerRow, setDrawerRow] = useState(null)
  const [building, setBuilding] = useState(false)
  const [tab, setTab] = useState('active')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('next')
  const [dir, setDir] = useState('asc')
  const [shown, setShown] = useState(PAGE)
  const [busyId, setBusyId] = useState(null)
  const [flash, setFlash] = useState(null) // { id, text } transient toggle confirmation
  const [now, setNow] = useState(() => Date.now())

  const holdHours = parseSequenceConfig(practice?.sequence_config).rules.holdHours || 24
  const holdMs = holdHours * 3600 * 1000

  // Keep countdowns fresh without thrashing.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

  // Debounce the search box (300ms).
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim().toLowerCase()), 300)
    return () => clearTimeout(t)
  }, [search])

  const reload = () => {
    refetch()
    queryClient.invalidateQueries({ queryKey: queryKeys.sequences(practiceId) })
  }

  // Reset the visible window whenever the result set changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setShown(PAGE) }, [debounced, filter, sort, dir])

  const derived = useMemo(
    () => rows.map((c) => deriveRow(c, holdMs, now)),
    [rows, holdMs, now]
  )

  const counts = useMemo(() => {
    const c = { active: 0, paused: 0, completed: 0, pending: 0 }
    derived.forEach((r) => { if (c[r.bucket] != null) c[r.bucket]++ })
    return c
  }, [derived])

  const filtered = useMemo(() => {
    let list = derived
    if (filter !== 'all') list = list.filter((r) => r.bucket === filter)
    if (debounced) {
      list = list.filter((r) =>
        `${r.name} ${r.phone} ${r.email}`.toLowerCase().includes(debounced)
      )
    }
    const sorted = [...list].sort((a, b) => {
      let v = 0
      if (sort === 'next') v = a.sortNext - b.sortNext
      else if (sort === 'name') v = a.name.localeCompare(b.name)
      else if (sort === 'progress') v = a.ratio - b.ratio
      else if (sort === 'status') v = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
      return dir === 'asc' ? v : -v
    })
    return sorted
  }, [derived, filter, debounced, sort, dir])

  const visible = filtered.slice(0, shown)

  function onSort(col) {
    if (sort === col) setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSort(col); setDir('asc') }
  }

  // ── On/off toggle ─────────────────────────────────────────────────────────
  // ON = active (sending), OFF = paused (pending messages stay pending but won't
  // send). Sent messages are never touched. Disabled once a sequence has ended.
  async function toggleSeq(r) {
    if (r.toggleDisabled || busyId === r.id) return
    setBusyId(r.id)
    const goActive = !r.toggleOn
    const patch = goActive
      // Clear the legacy cancellation too so the sender treats it as live again.
      ? { sequence_status: 'active', sequence_paused_reason: null, sequence_cancelled_at: null, sequence_cancelled_reason: null }
      : { sequence_status: 'paused', sequence_paused_reason: 'manual' }
    await toggleSeqMutation.mutateAsync({ consultId: r.id, patch, practiceId })
    setBusyId(null)
    setFlash({ id: r.id, text: goActive ? 'Sequence resumed' : 'Sequence paused' })
    setTimeout(() => setFlash((f) => (f && f.id === r.id ? null : f)), 2000)
  }

  const FILTERS = [
    ['all', 'All', derived.length],
    ['active', 'Active', counts.active],
    ['paused', 'Paused', counts.paused],
    ['pending', 'Pending', counts.pending],
    ['completed', 'Completed', counts.completed],
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white">
          <GitBranch className="h-6 w-6 text-primary-400" /> Sequences
        </h1>
        <p className="mt-1 text-sm text-slate-400">Manage active follow-up sequences and configure timing</p>
      </div>

      {/* Tab bar + reactivation launcher (inline, right) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1">
          {[['active', 'Active Sequences'], ['settings', 'Sequence Settings']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${tab === key ? 'bg-primary/10 text-primary-300' : 'text-slate-400 hover:bg-surface-800 hover:text-slate-200'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <ReactivationLaunchButton onClick={() => setBuilding(true)} />
      </div>

      {/* Reactivation builder modal (always mounted); compact list only on the Active tab */}
      <ReactivationCampaigns building={building} onCloseBuilder={() => setBuilding(false)} showList={tab === 'active'} />

      {tab === 'settings' ? (
        <SequenceSettings />
      ) : (
      <div className="space-y-6">
      {/* Summary cards */}
      {loading ? (
        <SkeletonStatGrid count={4} />
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryCard label="Active" value={counts.active} tone="green" />
          <SummaryCard label="Paused" value={counts.paused} tone="amber" />
          <SummaryCard label="Completed" value={counts.completed} tone="slate" />
          <SummaryCard label="Pending (24h hold)" value={counts.pending} tone="blue" />
        </div>
      )}

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, phone, or email..."
            className="input pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map(([key, label, n]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${filter === key ? 'bg-primary/10 text-primary-300' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {label} <span className="text-xs text-slate-500">({n})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Pending sequences — consults still being analyzed (no messages yet).
          Exclude any that have since landed in the real list to avoid a
          duplicate during the analyzing → analyzed transition. */}
      {pendingCards.length > 0 && (
        <div className="space-y-2">
          <style>{PENDING_SEQ_CSS}</style>
          {pendingCards.map((c) => (
            <PendingSequenceCard key={c.id} c={c} />
          ))}
        </div>
      )}

      {/* List */}
      {loading ? (
        <SkeletonTable rows={6} cols={6} />
      ) : derived.length === 0 ? (
        <EmptyState
          icon={GitBranch}
          title="No active sequences yet"
          description="Approve a consult to let CaseLift start following up."
          to="/consults"
          actionLabel="Go to Consults"
        />
      ) : filtered.length === 0 ? (
        <div className="card px-6 py-16 text-center text-sm text-slate-400">No sequences match your filters.</div>
      ) : (
        <div className="card overflow-hidden">
          {/* Column header (desktop) */}
          <div className="hidden border-b border-surface-700 px-4 py-2.5 lg:grid lg:grid-cols-12 lg:items-center lg:gap-4">
            <SortHeader label="Patient" col="name" sort={sort} dir={dir} onSort={onSort} className="lg:col-span-3" />
            <SortHeader label="Sequence" col="next" sort={sort} dir={dir} onSort={onSort} className="lg:col-span-4" />
            <SortHeader label="Progress" col="progress" sort={sort} dir={dir} onSort={onSort} className="lg:col-span-2" />
            <SortHeader label="Status" col="status" sort={sort} dir={dir} onSort={onSort} className="lg:col-span-2" />
            <span className="text-right text-xs font-semibold uppercase tracking-wide text-slate-500 lg:col-span-1">Actions</span>
          </div>

          <div className="divide-y divide-surface-700">
            {visible.map((r) => {
              return (
                <div
                  key={r.id}
                  onClick={() => setDrawerRow(r)}
                  className="grid cursor-pointer grid-cols-1 gap-2 px-4 py-3 transition hover:bg-surface-800/50 lg:grid-cols-12 lg:items-center lg:gap-4"
                >
                  {/* Patient + service + objection */}
                  <div className="min-w-0 lg:col-span-3">
                    <Link
                      to={`/consults/${r.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="truncate text-sm font-semibold text-slate-100 hover:underline"
                    >
                      {r.name === 'Unknown patient' ? <span className="italic text-slate-400">Awaiting patient info</span> : r.name}
                    </Link>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="rounded bg-surface-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">{r.serviceType}</span>
                      {r.objection && (
                        <span className="inline-flex items-center gap-1 text-xs text-slate-400"><span className={`h-2 w-2 rounded-full ${OBJ[r.objection]?.dot || 'bg-slate-500'}`} /> {r.objectionLabel}</span>
                      )}
                    </div>
                  </div>

                  {/* Mini sequence viz + next action */}
                  <div className="lg:col-span-4">
                    {r.vizPoints.length > 0 && <MiniSequenceViz points={r.vizPoints} />}
                    <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-slate-400">
                      {r.status === 'completed' || r.status === 'won' || r.status === 'not_fit' ? <CheckCircle2 className="h-3 w-3 shrink-0 text-slate-500" /> : (r.status === 'active' || r.status === 'pending') ? <Clock className="h-3 w-3 shrink-0 text-slate-500" /> : null}
                      <span className="truncate">{r.nextLabel}</span>
                    </p>
                  </div>

                  {/* Progress */}
                  <div className="lg:col-span-2">
                    <p className="text-xs text-slate-400">{r.sent} of {r.total} sent</p>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-700">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.round(r.ratio * 100)}%` }} />
                    </div>
                  </div>

                  {/* Status (single) - briefly shows the toggle confirmation */}
                  <div className="flex items-center lg:col-span-2">
                    {flash && flash.id === r.id
                      ? <span className="text-sm font-medium text-emerald-600">{flash.text}</span>
                      : <StatusText sk={r.status} />}
                  </div>

                  {/* Toggle + actions */}
                  <div className="flex items-center gap-2 lg:col-span-1 lg:justify-end">
                    <RowToggle
                      on={r.toggleOn}
                      disabled={r.toggleDisabled}
                      busy={busyId === r.id}
                      onClick={(e) => { e.stopPropagation(); toggleSeq(r) }}
                    />
                    <Link
                      to={`/consults/${r.id}`}
                      onClick={(e) => e.stopPropagation()}
                      title="View consult"
                      className="rounded-md p-1.5 text-slate-400 transition hover:bg-surface-700 hover:text-slate-100"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Load more */}
          {filtered.length > shown && (
            <div className="border-t border-surface-700 p-3 text-center">
              <button
                onClick={() => setShown((s) => s + PAGE)}
                className="btn-ghost mx-auto text-sm"
              >
                Load more ({filtered.length - shown} remaining)
              </button>
            </div>
          )}
        </div>
      )}
      </div>
      )}

      {drawerRow && (
        <SequenceDrawer row={drawerRow} practice={practice} onClose={() => setDrawerRow(null)} onChanged={() => { setDrawerRow(null); reload() }} onReload={reload} />
      )}
    </div>
  )
}
