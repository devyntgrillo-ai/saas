import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle, CalendarClock, Clock, StopCircle, Send, PlayCircle } from 'lucide-react'
import Modal from './Modal'
import Spinner from './Spinner'
import LoadingButton from './LoadingButton'
import { useAuth } from '../context/AuthContext'
import { recordCloseAttribution } from '../lib/attribution'
import { useSetConsultOutcome } from '../lib/queries'
import { auditSequenceStarted, auditSequenceStopped } from '../lib/audit'
import { scheduleConsultMessages } from '../lib/sequence'
import { supabase } from '../lib/supabase'

function fmtRemaining(ms) {
  if (ms <= 0) return 'now'
  const totalMin = Math.floor(ms / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `${h}h ${m}m`
}

// The outcome decision bar - the most prominent control on a consult. Marking an
// outcome guards the AI follow-up sequence from ever firing for patients who
// accepted / aren't moving forward. `scheduledCount` is the number of not-yet-sent
// follow-up messages, shown once the activation hold elapses and the sequence is live.
export default function OutcomeControls({
  consult,
  holdHours = 24,
  scheduledCount = 0,
  sequenceConfig,
  practiceTimezone,
  onUpdated,
  onSequenceStarted,
}) {
  const { user } = useAuth()
  const setOutcomeMutation = useSetConsultOutcome()
  const pending = setOutcomeMutation.isPending
  const [showNote, setShowNote] = useState(false)
  const [note, setNote] = useState('')
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

  const outcome = consult.outcome || 'pending'
  const seqStatus = consult.sequence_status || 'active'
  const paused = seqStatus === 'paused'
  const sequenceStarted = Boolean(
    consult.followup_approved_at ||
      consult.sequence_activated_at ||
      (outcome === 'pending' && consult.outcome_set_at),
  )
  const firstSendAt = new Date(consult.created_at).getTime() + holdHours * 3600 * 1000
  const remaining = firstSendAt - now
  const inHold = sequenceStarted && outcome === 'pending' && seqStatus === 'active' && remaining > 0
  const active = sequenceStarted && outcome === 'pending' && seqStatus === 'active' && remaining <= 0

  async function setOutcome(value, { noteText, reason } = {}) {
    if (!consult?.id || pending) return
    const patch = {
      outcome: value,
      outcome_set_at: new Date().toISOString(),
      outcome_set_by: user?.id || null,
    }
    if (noteText !== undefined) patch.outcome_note = noteText || null
    const cancelMessages = ['accepted', 'not_converting', 'closed_won'].includes(value)
    if (value === 'pending') {
      patch.sequence_cancelled_at = null
      patch.sequence_cancelled_reason = null
      patch.sequence_status = 'active'
      patch.sequence_paused_reason = null
      if (!consult.followup_approved_at) patch.followup_approved_at = new Date().toISOString()
    } else if (cancelMessages) {
      patch.sequence_cancelled_at = new Date().toISOString()
      patch.sequence_cancelled_reason = reason || value
      patch.sequence_status = 'cancelled'
    }
    try {
      if (value === 'pending' && !consult.followup_approved_at) {
        await scheduleConsultMessages(supabase, {
          consultId: consult.id,
          createdAt: consult.created_at,
          sequenceConfig,
          practiceTimezone,
          // Use practice touchpoints on manual start; consult preset is for AI draft only.
          timingPreset: null,
        })
      }
      await setOutcomeMutation.mutateAsync({
        consultId: consult.id,
        patch,
        practiceId: consult.practice_id,
        cancelMessages,
      })
      let extra = {}
      if (['accepted', 'closed_won'].includes(value)) {
        extra = await recordCloseAttribution({ ...consult, ...patch }, { source: 'manual' })
      }
      if (value === 'pending') auditSequenceStarted(consult.id, { via: 'outcome_change' })
      else if (['accepted', 'not_converting', 'closed_won'].includes(value)) {
        auditSequenceStopped(consult.id, { reason: reason || value })
      }
      onUpdated?.({ ...patch, ...extra })
      if (value === 'pending') onSequenceStarted?.()
    } catch {
      /* mutation surfaces via parent refresh */
    }
  }

  async function stopSequence() {
    if (!consult?.id || pending) return
    const patch = { sequence_status: 'paused', sequence_paused_reason: 'manual' }
    try {
      await setOutcomeMutation.mutateAsync({
        consultId: consult.id,
        patch,
        practiceId: consult.practice_id,
      })
      auditSequenceStopped(consult.id, { reason: 'manual_pause' })
      onUpdated?.(patch)
    } catch { /* noop */ }
  }

  // ── Resolved-state slim banners ───────────────────────────────────────────
  if (outcome === 'accepted')
    return <Banner tone="emerald" icon={CheckCircle2} title="Accepted treatment - no follow-up sequence running" />
  if (outcome === 'closed_won')
    return <Banner tone="emerald" icon={CheckCircle2} title="Closed - treatment confirmed. Follow-up sequence stopped." />
  if (outcome === 'not_converting')
    return (
      <Banner tone="slate" icon={XCircle} title="Marked as not a fit"
        sub={consult.outcome_note ? `Note: ${consult.outcome_note}` : undefined} />
    )
  if (outcome === 'rescheduled')
    return <Banner tone="amber" icon={CalendarClock} title="Sequence paused - resumes in 30 days." sub="Re-engagement picks up at Day 30." />

  // ── Pending: equal-weight outlined button group ───────────────────────────
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <OutcomeButton icon={CheckCircle2} label="Accepted Treatment" tone="emerald" selected={false}
          onClick={() => setOutcome('accepted')} loading={pending} />
        <OutcomeButton
          icon={sequenceStarted ? CheckCircle2 : PlayCircle}
          label={sequenceStarted ? 'Follow-Up Started' : 'Start Follow-Up Sequence'}
          tone="brand"
          selected={sequenceStarted && !paused}
          disabled={sequenceStarted && !paused}
          onClick={() => setOutcome('pending')}
          loading={pending}
        />
        <OutcomeButton icon={XCircle} label="Not a Fit" tone="slate" selected={false}
          onClick={() => { setNote(''); setShowNote(true) }} loading={pending} />
      </div>

      {paused ? (
        <SlimBar tone="slate" icon={StopCircle} onResume={() => setOutcome('pending')} busy={pending}>
          {consult.sequence_paused_reason === 'reply'
            ? 'Sequence paused - patient replied. Messages won’t send until resumed.'
            : 'Sequence paused - messages won’t send until resumed.'}
        </SlimBar>
      ) : inHold ? (
        <SlimBar tone="amber" icon={Clock} onStop={stopSequence} busy={pending}>
          First message sends in <span className="font-semibold">{fmtRemaining(remaining)}</span>
        </SlimBar>
      ) : active ? (
        <SlimBar tone="sky" icon={Send} onStop={stopSequence} busy={pending}>
          Follow-up sequence active · {scheduledCount} message{scheduledCount === 1 ? '' : 's'} scheduled
        </SlimBar>
      ) : null}

      {showNote && (
        <Modal title="Why isn't this patient converting?" onClose={() => setShowNote(false)} footer={
          <>
            <button onClick={() => setShowNote(false)} className="btn-ghost">Cancel</button>
            <LoadingButton loading={pending} onClick={() => { setShowNote(false); setOutcome('not_converting', { noteText: note }) }}
              className="btn-primary bg-rose-600 hover:bg-rose-500">Mark not converting</LoadingButton>
          </>
        }>
          <p className="text-sm text-slate-400">Optional - a quick note helps the practice learn what's losing cases.</p>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} className="input mt-3 min-h-[90px]"
            placeholder="e.g. Went with a competitor on price; following up in spring…" />
        </Modal>
      )}
    </div>
  )
}

// Equal-size outcome button. Selected → filled tone; unselected → outlined/muted.
function OutcomeButton({ icon: Icon, label, tone, selected, onClick, loading, disabled }) {
  const fills = {
    emerald: 'border-transparent bg-green-600 !text-white hover:bg-green-700',
    brand: 'border-transparent bg-primary !text-white hover:bg-primary-700',
    slate: 'border-transparent bg-gray-500 !text-white hover:bg-gray-600',
  }
  const outlines = {
    emerald: 'border-green-600 text-green-700 hover:bg-green-50',
    brand: 'border-primary text-primary hover:bg-primary/10',
    slate: 'border-gray-400 text-gray-600 hover:bg-gray-50',
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`inline-flex w-full items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
        selected ? fills[tone] : `bg-transparent ${outlines[tone]}`
      }`}
    >
      {loading ? <Spinner className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />} {label}
    </button>
  )
}

// Slim borderless info bar with an inline countdown and a "Stop"/"Resume" link.
function SlimBar({ tone, icon: Icon, children, onStop, onResume, busy }) {
  const tones = {
    amber: 'border border-amber-200 bg-amber-50 text-amber-800',
    sky: 'border border-blue-200 bg-blue-50 text-blue-800',
    slate: 'border border-gray-200 bg-gray-50 text-gray-700',
  }
  const stopTones = {
    amber: 'text-amber-700 hover:text-amber-900',
    sky: 'text-blue-700 hover:text-blue-900',
    slate: 'text-gray-500 hover:text-gray-700',
  }
  return (
    <div className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs ${tones[tone]}`}>
      <span className="flex min-w-0 items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{children}</span>
      </span>
      {(onStop || onResume) && (
        <button
          onClick={onStop || onResume}
          disabled={busy}
          className={`inline-flex shrink-0 items-center gap-1 font-medium underline-offset-2 hover:underline disabled:opacity-50 ${stopTones[tone]}`}
        >
          {busy ? <Spinner className="h-3 w-3" /> : null}
          {onStop ? 'Stop' : 'Resume'}
        </button>
      )}
    </div>
  )
}

function Banner({ tone, icon: Icon, title, sub }) {
  const tones = {
    emerald: 'border border-green-200 bg-green-50 text-green-800',
    amber: 'border border-amber-200 bg-amber-50 text-amber-800',
    slate: 'border border-gray-200 bg-gray-50 text-gray-700',
  }
  return (
    <div className={`flex items-start gap-2.5 rounded-lg px-3.5 py-3 ${tones[tone]}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p className="text-sm font-medium">{title}</p>
        {sub && <p className="mt-0.5 text-xs opacity-80">{sub}</p>}
      </div>
    </div>
  )
}
