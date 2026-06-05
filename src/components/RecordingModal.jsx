import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Mic,
  MicOff,
  Square,
  Pause,
  Play,
  X,
  Loader2,
  CheckCircle2,
  XCircle,
  CalendarClock,
  AlertTriangle,
  Sparkles,
  Settings as SettingsIcon,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { AUDIO_QUALITY, MIC_PREF_KEY, createBrowserConsult, uploadRecording, transcribeRecording, listMicrophones } from '../lib/recording'
import { treatmentLabel } from '../lib/treatments'
import { isNative, nativeRequestPermission, nativeStart, nativePause, nativeResume, nativeStopToBlob } from '../lib/nativeRecorder'

function fmt(sec) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// Post-recording outcome options. These set consult.outcome immediately - long
// before AI analysis finishes - and gate whether the follow-up sequence runs.
const OUTCOME_OPTIONS = [
  {
    value: 'accepted',
    icon: CheckCircle2,
    emoji: '✅',
    title: 'Accepted Treatment',
    desc: 'Patient committed - no follow-up needed',
    tone: 'border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300',
  },
  {
    value: 'pending',
    icon: CalendarClock,
    emoji: '📅',
    title: 'Start Follow-Up Sequence',
    desc: "Patient didn't commit today - start AI follow-up",
    tone: 'border-primary/40 bg-primary/10 hover:bg-primary/20 text-primary-300',
  },
  {
    value: 'not_converting',
    icon: XCircle,
    emoji: '❌',
    title: 'Not a Fit',
    desc: "Patient won't be moving forward",
    tone: 'border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300',
  },
]

export default function RecordingModal({ onClose, patient = null }) {
  const { practice, practiceId, user } = useAuth()
  const navigate = useNavigate()

  // Patient is resolved up-front by the AssignmentModal.
  const patientName = patient
    ? [patient.firstName, patient.lastName].filter(Boolean).join(' ') || 'this patient'
    : null
  const treatmentTypeLabel = patient?.treatmentType ? treatmentLabel(patient.treatmentType) : null

  const [phase, setPhase] = useState('requesting') // requesting | denied | ready | recording | paused | processing | outcome | confirmed | error
  const [seconds, setSeconds] = useState(0)
  const [mics, setMics] = useState([])
  const [micId, setMicId] = useState(() => localStorage.getItem(MIC_PREF_KEY) || '')
  const [error, setError] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [consultId, setConsultId] = useState(null)
  const [chosenOutcome, setChosenOutcome] = useState(null) // the OUTCOME_OPTIONS entry just picked

  const streamRef = useRef(null)
  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)
  const audioCtxRef = useRef(null)
  const rafRef = useRef(null)
  const canvasRef = useRef(null)
  const startedAtRef = useRef(0)

  const stopTracks = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (audioCtxRef.current) audioCtxRef.current.close().catch(() => {})
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    audioCtxRef.current = null
  }, [])

  // On a real device, recording goes through the native mic (Capacitor plugin),
  // not the browser MediaRecorder - so there's no MediaStream to enumerate or
  // visualize. Computed once; native status never changes within a session.
  const native = isNative()

  // Request microphone access on mount (and when the chosen mic changes).
  const initStream = useCallback(async (deviceId) => {
    setError('')
    setPhase('requesting')
    // Native: just confirm/prompt for the OS mic permission. No stream/visualizer.
    if (native) {
      try {
        const granted = await nativeRequestPermission()
        setPhase(granted ? 'ready' : 'denied')
      } catch {
        setPhase('denied')
      }
      return
    }
    try {
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop())
      const constraints = { audio: deviceId ? { deviceId: { exact: deviceId } } : true }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream
      setMics(await listMicrophones())
      setPhase('ready')
      setupVisualizer(stream)
    } catch {
      setPhase('denied')
    }
  }, [native])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    initStream(micId || undefined)
    return () => {
      stopTracks()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- Visualizer ----------------------------------------------------------
  function setupVisualizer(stream) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      const ctx = new AudioCtx()
      audioCtxRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)

      const draw = () => {
        rafRef.current = requestAnimationFrame(draw)
        const canvas = canvasRef.current
        if (!canvas) return
        const c = canvas.getContext('2d')
        const w = canvas.width
        const h = canvas.height
        analyser.getByteFrequencyData(data)
        c.clearRect(0, 0, w, h)
        const bars = 40
        const step = Math.floor(data.length / bars)
        const bw = w / bars
        for (let i = 0; i < bars; i++) {
          const v = data[i * step] / 255
          const bh = Math.max(2, v * h)
          c.fillStyle = `rgba(239,68,68,${0.35 + v * 0.65})`
          c.fillRect(i * bw + 1, (h - bh) / 2, bw - 2, bh)
        }
      }
      draw()
    } catch {
      /* visualizer is non-critical */
    }
  }

  // ---- Recording controls --------------------------------------------------
  function startTimer() {
    startedAtRef.current = Date.now() - seconds * 1000
    timerRef.current = setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000))
    }, 250)
  }

  async function start() {
    // Native: kick off the platform recorder; there's no MediaStream.
    if (native) {
      try {
        await nativeStart()
      } catch (e) {
        setError(e?.message || 'Could not start the microphone.')
        setPhase('error')
        return
      }
      setSeconds(0)
      startTimer()
      setPhase('recording')
      return
    }
    if (!streamRef.current) return
    chunksRef.current = []
    const quality = AUDIO_QUALITY[practice?.audio_quality] || AUDIO_QUALITY.standard
    let mr
    try {
      mr = new MediaRecorder(streamRef.current, { audioBitsPerSecond: quality.bitsPerSecond })
    } catch {
      mr = new MediaRecorder(streamRef.current)
    }
    mr.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data)
    mr.start(1000)
    recorderRef.current = mr
    setSeconds(0)
    startTimer()
    setPhase('recording')
  }

  function pause() {
    if (native) { nativePause() } else { recorderRef.current?.pause() }
    if (timerRef.current) clearInterval(timerRef.current)
    setPhase('paused')
  }
  function resume() {
    if (native) { nativeResume() } else { recorderRef.current?.resume() }
    startTimer()
    setPhase('recording')
  }

  async function stopAndAnalyze() {
    const finalSeconds = seconds
    // Native: stop the platform recorder and pull back the encoded audio Blob.
    if (native) {
      if (timerRef.current) clearInterval(timerRef.current)
      try {
        const blob = await nativeStopToBlob()
        await runPipeline(blob, finalSeconds)
      } catch (e) {
        setError(e?.message || 'Could not save the recording.')
        setPhase('error')
      }
      return
    }
    const mr = recorderRef.current
    if (!mr) return
    mr.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' })
      stopTracks()
      await runPipeline(blob, finalSeconds)
    }
    mr.stop()
  }

  async function runPipeline(blob, durationSec) {
    // Patient info is required - block submission if somehow missing.
    if (!patient || !patient.phone || !patient.email) {
      setError('Patient info required.')
      setPhase('error')
      return
    }
    setPhase('processing')
    setError('')
    let id
    try {
      id = await createBrowserConsult(practiceId, { durationSec, patient, source: native ? 'native_mobile' : undefined })
      const path = await uploadRecording(practiceId, id, blob)
      setConsultId(id)

      // Upload is complete - kick off transcription + analysis in the background
      // (don't await it) and immediately ask the TC for the consult outcome.
      transcribeRecording({ consultId: id, audioPath: path, durationSec, appointmentId: patient.appointmentId, patient })
        .catch((e) => {
          console.warn('[transcribe] background failed:', e?.message || e)
          supabase.from('consults').update({ status: 'transcription_error', audio_storage_path: path, transcript_error: e?.message || 'Transcription failed' }).eq('id', id).then().catch(() => {})
        })
      setPhase('outcome')
    } catch (e) {
      const step = id ? 'upload' : 'create'
      setError(`${e?.message || 'Something went wrong'} (step: ${step})`)
      setPhase('error')
      if (id) {
        setConsultId(id)
        setTimeout(() => {
          onClose()
          navigate(`/consults/${id}`)
        }, 2500)
      }
    }
  }

  // Record the chosen outcome immediately (before analysis finishes), show a
  // 1s confirmation, then redirect to the consult detail page.
  async function chooseOutcome(option) {
    if (!consultId) return
    setChosenOutcome(option)
    setPhase('confirmed')
    try {
      const { error: e } = await supabase
        .from('consults')
        .update({
          outcome: option.value,
          outcome_set_at: new Date().toISOString(),
          outcome_set_by: user?.id || null,
        })
        .eq('id', consultId)
      if (e) console.warn('[outcome] save failed:', e.message)
    } catch (e) {
      console.warn('[outcome] save failed:', e?.message || e)
    }
    setTimeout(() => {
      onClose()
      // Hand off to the processing screen (polls transcription, then opens the
      // consult) instead of dropping onto a blank detail page.
      navigate(`/consults/${consultId}/processing`, { state: { outcome: option.value } })
    }, 1000)
  }

  // "Skip for now" - outcome defaults to 'pending' (the DB default).
  function skipOutcome() {
    if (!consultId) return
    onClose()
    navigate(`/consults/${consultId}/processing`, { state: { outcome: 'pending' } })
  }

  function requestCancel() {
    if (phase === 'recording' || phase === 'paused') {
      setConfirmCancel(true)
    } else {
      stopTracks()
      onClose()
    }
  }
  function confirmCancelYes() {
    if (native) {
      // Stop the native recorder to release the mic; discard the result.
      nativeStopToBlob().catch(() => {})
    } else {
      try {
        recorderRef.current?.stop()
      } catch { /* noop */ }
    }
    stopTracks()
    onClose()
  }

  function chooseMic(id) {
    setMicId(id)
    if (id) localStorage.setItem(MIC_PREF_KEY, id)
    initStream(id || undefined)
  }

  const recording = phase === 'recording'
  const paused = phase === 'paused'
  // The flow can't be dismissed once the upload starts - we don't want to lose
  // the recording or leave the outcome unset mid-redirect.
  const locked = ['processing', 'outcome', 'confirmed'].includes(phase)

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={locked ? undefined : requestCancel}
      />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-surface-700 bg-surface-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-surface-700 px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Mic className="h-4 w-4 text-primary-400" /> Hey, I&apos;m CaseLift
          </h2>
          {!locked && (
            <button onClick={requestCancel} className="rounded-md p-1.5 text-slate-400 transition hover:bg-surface-800 hover:text-white">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        <div className="p-6">
          {/* Permission requesting */}
          {phase === 'requesting' && (
            <div className="flex flex-col items-center py-10 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
              <p className="mt-4 text-sm text-slate-400">Requesting microphone access…</p>
            </div>
          )}

          {/* Permission denied */}
          {phase === 'denied' && (
            <div className="flex flex-col items-center py-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-400">
                <MicOff className="h-7 w-7" />
              </div>
              <p className="mt-4 text-sm font-semibold text-slate-200">Microphone access is blocked</p>
              <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-slate-500">
                {native ? (
                  <>Open <span className="text-slate-300">Settings → CaseLift → Microphone</span> and turn it on, then try again.</>
                ) : (
                  <>Click the camera/lock icon in your browser's address bar, set Microphone to{' '}
                  <span className="text-slate-300">Allow</span>, then try again. On iPhone, allow mic access in
                  Settings → Safari.</>
                )}
              </p>
              <div className="mt-5 flex gap-2">
                <button onClick={onClose} className="btn-ghost">Close</button>
                <button onClick={() => initStream(micId || undefined)} className="btn-primary">
                  <Mic className="h-4 w-4" /> Try again
                </button>
              </div>
            </div>
          )}

          {/* Ready / recording / paused */}
          {(phase === 'ready' || recording || paused) && (
            <div className="flex flex-col items-center">
              {patient && (
                <div className="mb-4 w-full rounded-lg border border-surface-700 bg-surface-800/50 p-3 text-center">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500">Recording consult for</p>
                  <p className="mt-0.5 flex items-center justify-center gap-2 text-sm font-semibold text-white">
                    {patientName}
                    {treatmentTypeLabel && (
                      <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary-300">
                        {treatmentTypeLabel}
                      </span>
                    )}
                  </p>
                  {patient.phone && <p className="text-xs text-slate-500">{patient.phone}</p>}
                </div>
              )}
              {/* Visualizer - native has no MediaStream to analyse, so show a
                  mic indicator (pulses while recording) instead of the canvas. */}
              {native ? (
                <div className="flex h-16 w-full max-w-[320px] items-center justify-center rounded-lg bg-surface-800/50">
                  <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary-400">
                    {recording && <span className="absolute inset-0 animate-ping rounded-full bg-primary/30" />}
                    <Mic className="relative h-4 w-4" />
                  </span>
                </div>
              ) : (
                <canvas
                  ref={canvasRef}
                  width={360}
                  height={72}
                  className="h-16 w-full max-w-[320px] rounded-lg bg-surface-800/50"
                />
              )}

              {/* Timer */}
              <p className="mt-4 font-mono text-4xl font-bold tracking-tight text-white tabular-nums">
                {fmt(seconds)}
              </p>
              <p className="mt-1 h-4 text-xs font-medium">
                {recording && <span className="text-primary-400">CaseLift is listening…</span>}
                {paused && <span className="text-amber-300">❚❚ Paused</span>}
                {phase === 'ready' && <span className="text-slate-500">Hey, I&apos;m CaseLift. I&apos;m ready to listen to your consult.</span>}
              </p>

              {/* Big record button */}
              {phase === 'ready' && (
                <button
                  onClick={start}
                  className="mt-6 flex h-20 w-20 items-center justify-center rounded-full bg-primary !text-white shadow-lg transition hover:bg-primary-700"
                  title="Start recording"
                >
                  <Mic className="h-8 w-8" />
                </button>
              )}

              {(recording || paused) && (
                <div className="mt-6 flex items-center gap-4">
                  {recording ? (
                    <button onClick={pause} className="flex h-12 w-12 items-center justify-center rounded-full border border-surface-700 bg-surface-800 text-slate-200 transition hover:bg-surface-700" title="Pause">
                      <Pause className="h-5 w-5" />
                    </button>
                  ) : (
                    <button onClick={resume} className="flex h-12 w-12 items-center justify-center rounded-full border border-surface-700 bg-surface-800 text-slate-200 transition hover:bg-surface-700" title="Resume">
                      <Play className="h-5 w-5" />
                    </button>
                  )}

                  {/* Pulsing record indicator */}
                  <div className="relative flex h-16 w-16 items-center justify-center">
                    {recording && <span className="absolute inset-0 animate-ping rounded-full bg-primary/40" />}
                    <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-primary !text-white">
                      <Mic className="h-7 w-7" />
                    </span>
                  </div>

                  <button onClick={stopAndAnalyze} className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-primary transition hover:bg-slate-100" title="Stop & analyze">
                    <Square className="h-5 w-5 fill-current" />
                  </button>
                </div>
              )}

              {(recording || paused) && (
                <button onClick={stopAndAnalyze} className="btn-primary mt-6 w-full">
                  <Sparkles className="h-4 w-4" /> Stop &amp; Analyze
                </button>
              )}

              {/* Mic selection */}
              {phase === 'ready' && mics.length > 1 && (
                <label className="mt-6 flex w-full items-center gap-2 text-xs text-slate-500">
                  <SettingsIcon className="h-3.5 w-3.5 shrink-0" />
                  <select
                    value={micId}
                    onChange={(e) => chooseMic(e.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-surface-700 bg-surface-800 px-2.5 py-1.5 text-xs text-slate-200 focus:border-primary focus:outline-none"
                  >
                    <option value="">Default microphone</option>
                    {mics.map((m) => (
                      <option key={m.deviceId} value={m.deviceId}>
                        {m.label || `Microphone ${m.deviceId.slice(0, 6)}`}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}

          {/* Uploading - brief; transcription continues in the background */}
          {phase === 'processing' && (
            <div className="flex flex-col items-center py-10 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary-300" />
              <p className="mt-4 text-sm font-semibold text-white">CaseLift is transcribing your recording…</p>
              <p className="mt-1 text-xs text-slate-500">This only takes a moment.</p>
            </div>
          )}

          {/* Outcome - fires the instant the upload finishes, before transcription. */}
          {phase === 'outcome' && (
            <div className="py-1">
              <h3 className="text-center text-lg font-bold text-white">How did the consult go?</h3>
              <p className="mt-1 text-center text-sm text-slate-400">
                This determines whether we start the follow-up sequence.
              </p>
              <div className="mt-5 space-y-2.5">
                {OUTCOME_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    onClick={() => chooseOutcome(o)}
                    className={`flex w-full items-center gap-3.5 rounded-xl border px-4 py-3.5 text-left transition ${o.tone}`}
                  >
                    <span className="text-2xl leading-none">{o.emoji}</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{o.title}</span>
                      <span className="block text-xs text-slate-400">{o.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
              <button
                onClick={skipOutcome}
                className="mx-auto mt-4 block text-xs font-medium text-slate-500 transition hover:text-slate-300"
              >
                Skip for now
              </button>
            </div>
          )}

          {/* Confirmation - shown for ~1s before redirecting to the consult. */}
          {phase === 'confirmed' && (
            <div className="flex flex-col items-center py-10 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <p className="mt-4 text-sm font-semibold text-white">
                {chosenOutcome?.title ? `${chosenOutcome.emoji} ${chosenOutcome.title}` : 'Saved'}
              </p>
              <p className="mt-1 text-xs text-slate-500">Opening the consult…</p>
            </div>
          )}

          {/* Error */}
          {phase === 'error' && (
            <div className="flex flex-col items-center py-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-400">
                <AlertTriangle className="h-7 w-7" />
              </div>
              <p className="mt-4 text-sm font-semibold text-slate-200">Couldn't finish processing</p>
              <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-slate-500">{error}</p>
              <button onClick={onClose} className="btn-ghost mt-5">Close</button>
            </div>
          )}
        </div>
      </div>

      {/* Cancel confirmation */}
      {confirmCancel && (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => setConfirmCancel(false)} />
          <div className="relative z-10 w-full max-w-xs rounded-xl border border-surface-700 bg-surface-900 p-5 text-center">
            <p className="text-sm font-semibold text-white">Discard this recording?</p>
            <p className="mt-1 text-xs text-slate-500">Your audio won't be saved or analyzed.</p>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setConfirmCancel(false)} className="btn-ghost flex-1">Keep recording</button>
              <button onClick={confirmCancelYes} className="flex-1 rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold !text-white transition hover:bg-rose-500">
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
