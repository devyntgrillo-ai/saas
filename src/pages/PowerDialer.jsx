import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Phone, SkipForward, X, ArrowLeft, Loader2, PhoneCall, Check, Voicemail, PhoneOff, Ban, Mic, MicOff, Circle, Play,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import EmptyState from '../components/EmptyState'
import { timeAgo } from '../lib/consults'
import { fetchVoiceToken, formatCallTime, loadRecordingUrl } from '../lib/voice'
import { usePowerDialerQueue, useRecentCalls, queryKeys } from '../lib/queries'

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

function daysSince(d) {
  if (!d) return 'a few days'
  const n = Math.round((Date.now() - new Date(d).getTime()) / 86400000)
  return `${Math.max(0, n)} day${n === 1 ? '' : 's'}`
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

  // Revoke the object URL when switching recordings / unmounting.
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
  const [idx, setIdx] = useState(0)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  // ── Twilio Voice device state ─────────────────────────────────────────────
  const deviceRef = useRef(null)
  const callRef = useRef(null)
  const callSidRef = useRef(null)
  const [voiceState, setVoiceState] = useState('init') // init | ready | unavailable
  const [callState, setCallState] = useState('idle')   // idle | connecting | ringing | in_call
  const [muted, setMuted] = useState(false)
  const [seconds, setSeconds] = useState(0)

  const reload = () => {
    refetch()
    queryClient.invalidateQueries({ queryKey: queryKeys.powerDialer.queue(practiceId) })
  }

  const current = queue[idx]
  const c = current?.consults

  // Initialise the Twilio Device when a dialing session starts; tear down after.
  useEffect(() => {
    if (!active) return
    let cancelled = false
    ;(async () => {
      try {
        const { token } = await fetchVoiceToken()
        if (cancelled) return
        const { Device } = await import('@twilio/voice-sdk')
        const device = new Device(token, { codecPreferences: ['opus', 'pcmu'], logLevel: 'error' })
        device.on('tokenWillExpire', async () => {
          try { const { token: t } = await fetchVoiceToken(); device.updateToken(t) } catch { /* keep going */ }
        })
        device.on('error', (e) => console.error('Twilio device error:', e?.message || e))
        await device.register()
        if (cancelled) { device.destroy(); return }
        deviceRef.current = device
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setVoiceState('ready')
      } catch {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (!cancelled) setVoiceState('unavailable')
      }
    })()
    return () => {
      cancelled = true
      try { callRef.current?.disconnect() } catch { /* noop */ }
      try { deviceRef.current?.destroy() } catch { /* noop */ }
      deviceRef.current = null
      callRef.current = null
    }
  }, [active])

  // Hang up + reset call UI whenever we move to a different patient.
  useEffect(() => {
    try { callRef.current?.disconnect() } catch { /* noop */ }
    callRef.current = null
    callSidRef.current = null
    setCallState('idle'); setMuted(false); setSeconds(0)
  }, [idx])

  // In-call timer.
  useEffect(() => {
    if (callState !== 'in_call') return
    const t = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [callState])

  const talking = useMemo(() => {
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
  }, [c, practice])

  async function placeCall() {
    const device = deviceRef.current
    if (!device || !c?.patient_phone || callState !== 'idle') return
    setSeconds(0); setMuted(false); setCallState('connecting')
    try {
      const call = await device.connect({ params: { To: c.patient_phone, practice_id: practiceId, consult_id: c.id } })
      callRef.current = call
      call.on('ringing', () => setCallState('ringing'))
      call.on('accept', () => { callSidRef.current = call.parameters?.CallSid || null; setCallState('in_call') })
      const reset = () => { callRef.current = null; setCallState('idle'); setMuted(false) }
      call.on('disconnect', reset)
      call.on('cancel', reset)
      call.on('reject', reset)
      call.on('error', (e) => { console.error('Twilio call error:', e?.message || e); reset() })
    } catch (e) {
      console.error('placeCall failed:', e)
      setCallState('idle')
    }
  }

  function hangup() {
    try { callRef.current?.disconnect() } catch { /* noop */ }
    callRef.current = null
    setCallState('idle')
  }

  function toggleMute() {
    const call = callRef.current
    if (!call) return
    const next = !muted
    try { call.mute(next); setMuted(next) } catch { /* noop */ }
  }

  async function disposition(d) {
    if (!current || !c) return
    setBusy(true)
    // End any live call before logging.
    if (callRef.current) hangup()
    // Ensure a conversation exists for this patient, then log the call.
    let convId = null
    const { data: existing } = await supabase.from('conversations').select('id').eq('practice_id', practiceId).eq('consult_id', c.id).maybeSingle()
    if (existing) convId = existing.id
    else {
      const [first, ...rest] = (c.patient_name || 'Patient').split(' ')
      const { data: created } = await supabase.from('conversations')
        .insert({ practice_id: practiceId, consult_id: c.id, patient_first: first, patient_last: rest.join(' '), patient_phone: c.patient_phone, patient_email: c.patient_email, last_message_at: new Date().toISOString() })
        .select('id').single()
      convId = created?.id
    }
    const nowIso = new Date().toISOString()
    const dateLabel = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    const durLabel = callSidRef.current && seconds > 0 ? ` · ${formatCallTime(seconds)}` : ''
    const body = `📞 Called ${dateLabel} · ${d.log}${durLabel}${notes.trim() ? ` · ${notes.trim()}` : ''}`

    // Resolve the recorded call log (created by the TwiML webhook, keyed by sid)
    // so the inline call entry can link to its recording.
    let callLogId = null
    if (callSidRef.current) {
      const { data: cl } = await supabase.from('call_logs').select('id').eq('twilio_call_sid', callSidRef.current).maybeSingle()
      callLogId = cl?.id || null
    }
    const meta = { outcome: d.log, duration_sec: callSidRef.current ? (seconds || 0) : null, note: notes.trim() || null, actor: practice?.tc_name || 'You' }

    if (convId) {
      await supabase.from('conversation_messages').insert({ conversation_id: convId, direction: 'outbound', channel: 'call', body, sent_at: nowIso, meta, call_log_id: callLogId })
      await supabase.from('conversations').update({ last_message_at: nowIso, last_message_preview: body }).eq('id', convId)
    }
    // Attach disposition/notes/duration to the recorded call log (if a real call was placed).
    if (callSidRef.current) {
      await supabase.from('call_logs').update({
        disposition: d.key, notes: notes.trim() || null, duration_seconds: seconds || null, conversation_id: convId,
      }).eq('twilio_call_sid', callSidRef.current)
      callSidRef.current = null
    }
    // Mark the call touchpoint handled.
    await supabase.from('messages').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', current.id)
    if (d.key === 'dnc') await supabase.from('consults').update({ outcome: 'not_converting' }).eq('id', c.id)

    setBusy(false); setNotes(''); setSeconds(0)
    // Advance.
    if (idx + 1 >= queue.length) { setActive(false); setIdx(0); reload() }
    else setIdx((i) => i + 1)
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
            <p className="mt-0.5 text-sm text-slate-400">{queue.length} call action{queue.length === 1 ? '' : 's'} due today · calls placed &amp; recorded in-app</p>
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
            <button onClick={() => { setActive(true); setIdx(0) }} className="btn-primary bg-primary hover:bg-primary-700"><PhoneCall className="h-4 w-4" /> Start dialing session</button>
          </>
        )}

        <RecentCalls practiceId={practiceId} />
      </div>
    )
  }

  // ── Active dialer ─────────────────────────────────────────────────────────
  const onCall = callState !== 'idle'
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">Calling {idx + 1} of {queue.length}</p>
        <button onClick={() => { setActive(false); setIdx(0) }} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-400 hover:text-slate-200"><X className="h-4 w-4" /> End session</button>
      </div>

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
              {!onCall ? (
                <button onClick={placeCall} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-4 text-lg font-bold !text-white transition hover:bg-emerald-500">
                  <Phone className="h-5 w-5" /> Call {c?.patient_phone}
                </button>
              ) : (
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
              )}
              <p className="mt-2 text-center text-[11px] text-slate-500">Calls are placed and recorded in-app via Twilio.</p>
            </div>
          ) : (
            // Fallback: Twilio voice not configured (or still initialising) → device link.
            <a href={`tel:${c?.patient_phone}`} className="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-4 text-lg font-bold !text-white transition hover:bg-primary-700">
              <Phone className="h-5 w-5" /> {c?.patient_phone}
            </a>
          )}
          {voiceState === 'unavailable' && (
            <p className="mt-2 text-center text-[11px] text-amber-300/80">In-app calling isn’t set up yet - using your device dialer. Configure Twilio Voice to call &amp; record here.</p>
          )}

          <div className="mt-4 space-y-1 text-sm text-slate-300">
            {c?.objection_type && <p><span className="text-slate-500">Objection:</span> {c.objection_type}</p>}
            {c?.exit_intent_level && <p><span className="text-slate-500">Exit intent:</span> {c.exit_intent_level}</p>}
          </div>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} placeholder="Notes during call…" className="input mt-4 resize-none" />
        </div>
      </div>

      {/* Controls + disposition */}
      <div className="card p-5">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Log outcome (required to continue)</p>
        <div className="flex flex-wrap gap-2">
          {DISPOSITIONS.map((d) => (
            <button key={d.key} onClick={() => disposition(d)} disabled={busy}
              className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2.5 text-sm font-semibold !text-white transition disabled:opacity-50 ${d.tone}`}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <d.icon className="h-4 w-4" />} {d.label}
            </button>
          ))}
          <button onClick={() => (idx + 1 >= queue.length ? (setActive(false), setIdx(0)) : setIdx((i) => i + 1))} disabled={busy}
            className="btn-secondary"><SkipForward className="h-4 w-4" /> Skip</button>
        </div>
      </div>
    </div>
  )
}
