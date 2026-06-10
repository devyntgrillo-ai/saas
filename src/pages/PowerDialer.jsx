import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Phone, X, ArrowLeft, Loader2, PhoneCall, Check, Voicemail, PhoneOff, Ban, Mic, MicOff, Circle, Play, Pause,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import EmptyState from '../components/EmptyState'
import { timeAgo } from '../lib/consults'
import { formatCallTime, loadRecordingUrl } from '../lib/voice'
import { useVoice } from '../context/VoiceContext'
import { usePowerDialerQueue, useRecentCalls, useCompletePowerDialerLead, queryKeys } from '../lib/queries'

const COUNTDOWN_SEC = 3

const EXIT_PILL = {
  hot: 'bg-red-100 text-red-700', warm: 'bg-amber-100 text-amber-700', long_term: 'bg-sky-100 text-sky-700',
}
const OBJ_RESPONSE = {
  price: 'I hear you on cost. We have financing that breaks this into a comfortable monthly payment.',
  fear: 'It is completely normal to feel nervous. We offer sedation and go entirely at your pace.',
  spouse: 'Totally understand wanting to talk it over. Would a quick joint call help so you both have the same info?',
  timing: 'No rush at all. I just want to make sure you have everything for whenever the time is right.',
}
const DISPOSITIONS = [
  { key: 'scheduled', label: 'Reached - Scheduled', icon: Check, tone: 'bg-emerald-600 hover:bg-emerald-500', log: 'Reached, scheduled appointment' },
  { key: 'followup', label: 'Reached - Following up', icon: PhoneCall, tone: 'bg-blue-600 hover:bg-blue-500', log: 'Reached, will follow up' },
  { key: 'no_answer', label: 'No answer', icon: PhoneOff, tone: 'bg-slate-600 hover:bg-slate-500', log: 'No answer' },
  { key: 'voicemail', label: 'Left voicemail', icon: Voicemail, tone: 'bg-slate-600 hover:bg-slate-500', log: 'Left voicemail' },
  { key: 'dnc', label: 'Do not contact', icon: Ban, tone: 'bg-rose-600 hover:bg-rose-500', log: 'Do not contact' },
]
const DISPO_BY_KEY = Object.fromEntries(DISPOSITIONS.map((d) => [d.key, d]))

function daysSince(d) {
  if (!d) return 'a few days'
  const n = Math.round((Date.now() - new Date(d).getTime()) / 86400000)
  return `${Math.max(0, n)} day${n === 1 ? '' : 's'}`
}

function buildTalkingPoints(c, practice) {
  if (!c) return null
  const first = (c.patient_name || 'there').split(' ')[0]
  const tc = practice?.tc_name || 'Sara'
  const last = practice?.doctor_last || 'Smith'
  return {
    opening: `Hi ${first}, this is ${tc} from Dr. ${last}'s office...`,
    context: `You came in ${daysSince(c.recording_date || c.created_at)} ago about your treatment.`,
    reference: c.personal_detail || null,
    goal: c.tc_action || 'Re-engage and find a path forward.',
    objection: OBJ_RESPONSE[c.objection_type] || 'Happy to answer any questions and find an approach that fits.',
    cta: "I'd love to get you in for a quick 20-minute visit. What does your week look like?",
  }
}

function UpNextPreview({ lead, practice, countdown, paused, compact = false }) {
  const consult = lead?.consults
  const talking = buildTalkingPoints(consult, practice)
  if (!consult) return null

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Up next</span>
        <span className="font-medium text-slate-200">{consult.patient_name || 'Unknown patient'}</span>
        <span className="text-slate-500">{consult.patient_phone}</span>
        {lead.send_day != null && <span className="text-slate-500">Day {lead.send_day}</span>}
        {consult.exit_intent_level && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${EXIT_PILL[consult.exit_intent_level] || 'bg-gray-100 text-gray-600'}`}>
            {consult.exit_intent_level}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="min-w-0 flex-1">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-400">Up next</p>
      <p className="mt-1 truncate text-lg font-bold text-white">{consult.patient_name || 'Unknown patient'}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span>{consult.patient_phone}</span>
        {lead.send_day != null && <span>· Day {lead.send_day}</span>}
        {consult.exit_intent_level && (
          <span className={`rounded-full px-2 py-0.5 font-medium ${EXIT_PILL[consult.exit_intent_level] || 'bg-gray-100 text-gray-600'}`}>
            {consult.exit_intent_level}
          </span>
        )}
      </div>
      {consult.objection_type && (
        <p className="mt-2 text-xs text-slate-500"><span className="text-slate-600">Objection:</span> {consult.objection_type}</p>
      )}
      {talking?.opening && (
        <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-slate-300">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Opening · </span>
          {talking.opening}
        </p>
      )}
      <p className="mt-3 text-xs text-slate-500">
        {paused
          ? 'Paused, resume when ready'
          : countdown != null
            ? `Dialing in ${countdown}s · review talking points below`
            : 'Review talking points below'}
      </p>
    </div>
  )
}

const DISPO_PILL = {
  scheduled: { label: 'Scheduled', cls: 'bg-emerald-500/15 text-emerald-300' },
  followup: { label: 'Following up', cls: 'bg-sky-500/15 text-sky-300' },
  no_answer: { label: 'No answer', cls: 'bg-slate-500/15 text-slate-400' },
  voicemail: { label: 'Voicemail', cls: 'bg-slate-500/15 text-slate-400' },
  dnc: { label: 'Do not contact', cls: 'bg-rose-500/15 text-rose-300' },
}

// Recent calls with inline recording playback (auth-proxied audio).
function RecentCalls({ practiceId }) {
  const { data: calls = [], isLoading: loading } = useRecentCalls(practiceId)
  const [playing, setPlaying] = useState(null) // { id, url }
  const [loadingId, setLoadingId] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => () => { if (playing?.url) URL.revokeObjectURL(playing.url) }, [playing])

  async function play(call) {
    setErr('')
    if (playing?.url) { URL.revokeObjectURL(playing.url); setPlaying(null) }
    setLoadingId(call.id)
    try {
      const url = await loadRecordingUrl(call.id)
      setPlaying({ id: call.id, url })
    } catch {
      setErr('Could not load that recording.')
    } finally {
      setLoadingId(null)
    }
  }

  if (loading || calls.length === 0) return null

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-surface-700 px-4 py-3">
        <h2 className="text-sm font-semibold text-white">Recent calls</h2>
        <p className="text-xs text-slate-500">Placed in-app · recordings play here</p>
      </div>
      {err && <p className="border-b border-surface-700 bg-rose-500/10 px-4 py-2 text-xs text-rose-300">{err}</p>}
      <div className="divide-y divide-surface-700">
        {calls.map((call) => {
          const name = call.consults?.patient_name || call.to_number || 'Unknown'
          const dispo = DISPO_PILL[call.disposition]
          const isPlaying = playing?.id === call.id
          return (
            <div key={call.id} className="px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-100">{name}</p>
                  <p className="truncate text-xs text-slate-500">
                    {timeAgo(call.created_at)}{call.duration_seconds ? ` · ${formatCallTime(call.duration_seconds)}` : ''}
                  </p>
                </div>
                {dispo && <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${dispo.cls}`}>{dispo.label}</span>}
                {call.recording_url ? (
                  <button onClick={() => play(call)} disabled={loadingId === call.id || isPlaying}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-surface-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-surface-800 disabled:opacity-50">
                    {loadingId === call.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                    {isPlaying ? 'Playing' : 'Play'}
                  </button>
                ) : (
                  <span className="shrink-0 text-[11px] text-slate-600">No recording</span>
                )}
              </div>
              {isPlaying && (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <audio src={playing.url} controls autoPlay className="mt-2 h-8 w-full" />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function PowerDialer() {
  const { practiceId, practice } = useAuth()
  const queryClient = useQueryClient()
  const { data: queue = [], isLoading: loading, refetch } = usePowerDialerQueue(practiceId)

  const [active, setActive] = useState(false)
  const [sessionQueue, setSessionQueue] = useState([])
  const [idx, setIdx] = useState(0)
  const [notes, setNotes] = useState('')
  const completeLeadMutation = useCompletePowerDialerLead()
  const [paused, setPaused] = useState(false)
  const [countdown, setCountdown] = useState(null) // null | 3..1

  const completingRef = useRef(false)
  const endingSessionRef = useRef(false)
  const pendingDispoRef = useRef(null)
  const sessionQueueRef = useRef([])
  const idxRef = useRef(0)
  const notesRef = useRef('')

  const {
    voiceState, callState, seconds, muted, placeCall, hangup, toggleMute,
  } = useVoice()

  sessionQueueRef.current = sessionQueue
  idxRef.current = idx
  notesRef.current = notes

  const reload = useCallback(() => {
    refetch()
    queryClient.invalidateQueries({ queryKey: queryKeys.powerDialer.queue(practiceId) })
    queryClient.invalidateQueries({ queryKey: queryKeys.powerDialer.recentCalls(practiceId) })
  }, [refetch, queryClient, practiceId])

  const current = sessionQueue[idx]
  const c = current?.consults

  const talking = useMemo(() => buildTalkingPoints(c, practice), [c, practice])

  const nextLead = sessionQueue[idx + 1] ?? null

  const endSession = useCallback(() => {
    endingSessionRef.current = true
    pendingDispoRef.current = null
    hangup()
    setActive(false)
    setSessionQueue([])
    setIdx(0)
    setPaused(false)
    setCountdown(null)
    pendingDispoRef.current = null
    completingRef.current = false
    reload()
  }, [hangup, reload])

  const advanceAfterComplete = useCallback((nextIdx, total) => {
    setNotes('')
    if (nextIdx >= total) {
      endSession()
    } else {
      setIdx(nextIdx)
      setCountdown(COUNTDOWN_SEC)
    }
  }, [endSession])

  const completeLead = useCallback(async (dispoKey, { callSid = null, durationSec = 0 } = {}) => {
    if (completingRef.current) return
    const lead = sessionQueueRef.current[idxRef.current]
    const consult = lead?.consults
    if (!lead || !consult) return

    completingRef.current = true

    const d = DISPO_BY_KEY[dispoKey] || DISPO_BY_KEY.no_answer
    const noteText = notesRef.current.trim()

    try {
      await completeLeadMutation.mutateAsync({
        practiceId,
        lead,
        consult,
        dispo: d,
        noteText,
        callSid,
        durationSec,
        tcName: practice?.tc_name,
      })
    } catch { /* noop */ }

    completingRef.current = false
    pendingDispoRef.current = null
    advanceAfterComplete(idxRef.current + 1, sessionQueueRef.current.length)
  }, [practiceId, practice?.tc_name, advanceAfterComplete])

  const handleCallEnded = useCallback(({ callSid, seconds: durationSec }) => {
    if (endingSessionRef.current) {
      endingSessionRef.current = false
      return
    }
    const dispoKey = pendingDispoRef.current?.key || 'no_answer'
    completeLead(dispoKey, { callSid, durationSec })
  }, [completeLead])

  const dialCurrentLead = useCallback(async () => {
    const lead = sessionQueueRef.current[idxRef.current]
    const consult = lead?.consults
    if (!consult?.patient_phone || callState !== 'idle' || paused || countdown != null) return
    await placeCall({
      to: consult.patient_phone,
      practiceId,
      consultId: consult.id,
      onEnded: handleCallEnded,
    })
  }, [callState, paused, countdown, placeCall, practiceId, handleCallEnded])

  // Auto-dial when ready: first lead dials immediately; subsequent leads wait for countdown.
  useEffect(() => {
    if (!active || paused || voiceState !== 'ready' || callState !== 'idle' || countdown != null || completeLeadMutation.isPending) return
    dialCurrentLead()
  }, [active, paused, voiceState, callState, countdown, completeLeadMutation.isPending, idx, dialCurrentLead])

  // Countdown between calls.
  useEffect(() => {
    if (countdown == null || paused) return
    if (countdown <= 0) {
      setCountdown(null)
      return
    }
    const t = setTimeout(() => setCountdown((n) => (n == null ? null : n - 1)), 1000)
    return () => clearTimeout(t)
  }, [countdown, paused])

  function startSession() {
    if (queue.length === 0) return
    setSessionQueue([...queue])
    setIdx(0)
    setPaused(false)
    setCountdown(null)
    setNotes('')
    pendingDispoRef.current = null
    completingRef.current = false
    setActive(true)
  }

  function disposition(d) {
    if (!current || !c || completeLeadMutation.isPending) return
    pendingDispoRef.current = d
    if (callState !== 'idle') {
      hangup()
    } else {
      completeLead(d.key)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-slate-500" /></div>
  }

  // ── Queue list ──────────────────────────────────────────────────────────────
  if (!active) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Link to="/conversations" className="rounded-md p-1.5 text-slate-400 transition hover:bg-surface-800 hover:text-white"><ArrowLeft className="h-5 w-5" /></Link>
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white"><PhoneCall className="h-6 w-6 text-primary-400" /> Power Dialer</h1>
            <p className="mt-0.5 text-sm text-slate-400">{queue.length} call action{queue.length === 1 ? '' : 's'} due today · one click dials through the list</p>
          </div>
        </div>

        {queue.length === 0 ? (
          <EmptyState icon={PhoneCall} title="No calls due" description="Call touchpoints scheduled for today will appear here." to="/sequences" actionLabel="View sequences" />
        ) : (
          <>
            <div className="card divide-y divide-surface-700 overflow-hidden">
              {queue.map((m) => (
                <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-100">{m.consults.patient_name || 'Unknown patient'}</p>
                    <p className="truncate text-xs text-slate-500">{m.consults.patient_phone} · Day {m.send_day ?? '-'}</p>
                  </div>
                  {m.consults.exit_intent_level && (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${EXIT_PILL[m.consults.exit_intent_level] || 'bg-gray-100 text-gray-600'}`}>{m.consults.exit_intent_level}</span>
                  )}
                </div>
              ))}
            </div>
            <button onClick={startSession} className="btn-primary bg-primary hover:bg-primary-700">
              <PhoneCall className="h-4 w-4" /> Start power dialer
            </button>
            <p className="text-xs text-slate-500">Calls each lead automatically with a {COUNTDOWN_SEC}-second pause between calls. Tap pause anytime to stop the next dial.</p>
          </>
        )}

        <RecentCalls practiceId={practiceId} />
      </div>
    )
  }

  // ── Active dialer ─────────────────────────────────────────────────────────
  const onCall = callState !== 'idle'
  const waitingForNext = countdown != null && !onCall
  const statusLabel = paused
    ? 'Paused'
    : onCall
      ? (callState === 'in_call' ? `On call · ${formatCallTime(seconds)}` : callState === 'ringing' ? 'Ringing…' : 'Connecting…')
      : waitingForNext
        ? `Next call in ${countdown}s`
        : voiceState === 'ready'
          ? 'Dialing…'
          : 'Starting dialer…'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-slate-400">Lead {idx + 1} of {sessionQueue.length}</p>
          <p className="text-xs font-medium text-slate-300">{statusLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPaused((p) => !p)}
            disabled={voiceState === 'unavailable'}
            className="inline-flex items-center gap-1.5 rounded-lg border border-surface-700 px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-surface-800 disabled:opacity-40"
          >
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button onClick={endSession} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-400 hover:text-slate-200">
            <X className="h-4 w-4" /> End session
          </button>
        </div>
      </div>

      {waitingForNext && (
        <div className="card flex items-start gap-4 p-5 sm:items-center sm:p-6">
          <div className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-3xl font-bold ${paused ? 'bg-surface-700 text-slate-400' : 'bg-primary/15 text-primary-300'}`}>
            {paused ? <Pause className="h-7 w-7" /> : countdown}
          </div>
          <UpNextPreview lead={current} practice={practice} countdown={countdown} paused={paused} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Talking points */}
        <div className="card p-5 lg:col-span-3">
          <h2 className="text-lg font-bold text-white">{c?.patient_name || 'Patient'}</h2>
          {talking && (
            <div className="mt-4 space-y-3 text-sm">
              {[['Opening', talking.opening], ['Context', talking.context], talking.reference && ['Personal reference', talking.reference], ['Goal', talking.goal], ['If they object', talking.objection], ['Suggested CTA', talking.cta]]
                .filter(Boolean).map(([label, text]) => (
                  <div key={label}>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
                    <p className="mt-0.5 leading-relaxed text-slate-200">{text}</p>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Call panel + notes */}
        <div className="card p-5 lg:col-span-2">
          {voiceState === 'ready' ? (
            <div className="rounded-xl border border-surface-700 bg-surface-800/50 p-4">
              {onCall ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-200">
                      {callState === 'in_call'
                        ? <><Circle className="h-2.5 w-2.5 animate-pulse fill-rose-500 text-rose-500" /> Recording · {formatCallTime(seconds)}</>
                        : <><Loader2 className="h-4 w-4 animate-spin text-slate-400" /> {callState === 'ringing' ? 'Ringing…' : 'Connecting…'}</>}
                    </span>
                    <span className="text-xs text-slate-500">{c?.patient_phone}</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={toggleMute} disabled={callState !== 'in_call'} className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-surface-700 px-3 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-surface-800 disabled:opacity-40">
                      {muted ? <MicOff className="h-4 w-4 text-rose-400" /> : <Mic className="h-4 w-4" />} {muted ? 'Unmute' : 'Mute'}
                    </button>
                    <button onClick={hangup} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-rose-600 px-3 py-2.5 text-sm font-semibold !text-white transition hover:bg-rose-500">
                      <PhoneOff className="h-4 w-4" /> Hang up
                    </button>
                  </div>
                </div>
              ) : waitingForNext ? (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-400">
                  <Phone className="h-4 w-4" /> {c?.patient_phone}
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-300">
                  <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                  {paused ? 'Paused, resume to continue' : 'Placing call…'}
                </div>
              )}
              <p className="mt-2 text-center text-[11px] text-slate-500">Calls are placed and recorded in-app via Twilio.</p>
            </div>
          ) : voiceState === 'init' ? (
            <div className="flex items-center justify-center gap-2 rounded-xl bg-surface-800/50 px-4 py-8 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Connecting dialer…
            </div>
          ) : (
            <>
              <a href={`tel:${c?.patient_phone}`} className="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-4 text-lg font-bold !text-white transition hover:bg-primary-700">
                <Phone className="h-5 w-5" /> {c?.patient_phone}
              </a>
              <p className="mt-2 text-center text-[11px] text-amber-300/80">In-app auto-dial isn’t available, use your device dialer, then log the outcome below.</p>
            </>
          )}

          <div className="mt-4 space-y-1 text-sm text-slate-300">
            {c?.objection_type && <p><span className="text-slate-500">Objection:</span> {c.objection_type}</p>}
            {c?.exit_intent_level && <p><span className="text-slate-500">Exit intent:</span> {c.exit_intent_level}</p>}
          </div>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} placeholder="Notes during call…" className="input mt-4 resize-none" />
        </div>
      </div>

      {onCall && nextLead && (
        <div className="card border-dashed border-surface-600 bg-surface-800/30 px-4 py-3">
          <UpNextPreview lead={nextLead} practice={practice} compact />
        </div>
      )}

      {/* Outcome logging (optional, auto-advances when the call ends) */}
      <div className="card p-5">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Log outcome (optional, advances automatically when the call ends)</p>
        <div className="flex flex-wrap gap-2">
          {DISPOSITIONS.map((d) => (
            <button key={d.key} onClick={() => disposition(d)} disabled={completeLeadMutation.isPending}
              className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2.5 text-sm font-semibold !text-white transition disabled:opacity-50 ${d.tone}`}>
              {completeLeadMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <d.icon className="h-4 w-4" />} {d.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
