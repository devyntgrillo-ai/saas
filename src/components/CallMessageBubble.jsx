import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Loader2,
  Play,
  Pause,
  Square,
  Volume2,
  VolumeX,
  Download,
  PhoneIncoming,
  PhoneOutgoing,
} from 'lucide-react'
import { loadRecordingUrl } from '../lib/voice'
import { supabase } from '../lib/supabase'

function formatPlayerTime(secs) {
  const s = Math.max(0, Math.floor(secs || 0))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function callMessageTime(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
}

const SPEEDS = [1, 1.25, 1.5, 2]

function CallRecordingPlayer({ callLogId, durationHint }) {
  const audioRef = useRef(null)
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [audioSrc, setAudioSrc] = useState(null)
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(durationHint || 0)
  const [muted, setMuted] = useState(false)
  const [speedIdx, setSpeedIdx] = useState(0)

  // Fetch recording blob URL (Twilio media requires auth proxy).
  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setError('')
    setPlaying(false)
    setCurrent(0)

    loadRecordingUrl(callLogId)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url)
          return
        }
        setAudioSrc(url)
        setStatus('ready')
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message || 'Could not load recording')
          setStatus('error')
        }
      })

    return () => {
      cancelled = true
    }
  }, [callLogId])

  // Revoke blob URL on unmount / when call changes.
  useEffect(() => {
    return () => {
      if (audioSrc) URL.revokeObjectURL(audioSrc)
    }
  }, [audioSrc])

  // Attach src after <audio> is mounted and blob URL is ready.
  useEffect(() => {
    const el = audioRef.current
    if (!el || !audioSrc || status !== 'ready') return
    el.src = audioSrc
    el.load()
  }, [audioSrc, status])

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[speedIdx]
  }, [speedIdx, status])

  const togglePlay = useCallback(async () => {
    const el = audioRef.current
    if (!el || status !== 'ready' || !audioSrc) return
    try {
      if (playing) {
        el.pause()
      } else {
        await el.play()
      }
    } catch {
      setError('Playback failed — try again')
      setPlaying(false)
    }
  }, [playing, status, audioSrc])

  const stop = useCallback(() => {
    const el = audioRef.current
    if (!el) return
    el.pause()
    el.currentTime = 0
    setCurrent(0)
    setPlaying(false)
  }, [])

  const onSeek = (e) => {
    const el = audioRef.current
    if (!el) return
    const v = Number(e.target.value)
    el.currentTime = v
    setCurrent(v)
  }

  const cycleSpeed = () => {
    const next = (speedIdx + 1) % SPEEDS.length
    setSpeedIdx(next)
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[next]
  }

  const downloadRecording = () => {
    if (!audioSrc) return
    const a = document.createElement('a')
    a.href = audioSrc
    a.download = `call-recording-${callLogId}.mp3`
    a.click()
  }

  const dur = Math.max(duration || durationHint || 0, 1)
  const progress = dur > 0 ? Math.min(100, (current / dur) * 100) : 0
  const controlsDisabled = status !== 'ready'

  return (
    <div className="mt-2 w-full min-w-[260px] max-w-[340px] rounded-md border border-gray-200 bg-gray-50 px-2 py-2">
      {/* Always mounted so ref is valid when the blob URL arrives. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audioRef}
        className="hidden"
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={() => setCurrent(audioRef.current?.currentTime || 0)}
        onLoadedMetadata={() => {
          const d = audioRef.current?.duration
          if (Number.isFinite(d) && d > 0) setDuration(Math.floor(d))
        }}
        onDurationChange={() => {
          const d = audioRef.current?.duration
          if (Number.isFinite(d) && d > 0) setDuration(Math.floor(d))
        }}
        onEnded={() => {
          setPlaying(false)
          setCurrent(0)
        }}
        onError={() => {
          setError('Could not play this recording')
          setPlaying(false)
          setStatus('error')
        }}
      />

      {status === 'loading' && (
        <div className="flex h-10 items-center justify-center gap-2 text-xs text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading recording…
        </div>
      )}

      {status === 'error' && (
        <p className="text-xs text-rose-500">{error || 'Could not load recording'}</p>
      )}

      {status === 'ready' && (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={stop}
            disabled={controlsDisabled}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-gray-300 bg-white text-gray-600 transition hover:bg-gray-100 disabled:opacity-40"
            aria-label="Stop"
          >
            <Square className="h-3 w-3 fill-current" />
          </button>
          <button
            type="button"
            onClick={togglePlay}
            disabled={controlsDisabled}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-gray-300 bg-white text-gray-700 transition hover:bg-gray-100 disabled:opacity-40"
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? (
              <Pause className="h-3.5 w-3.5 fill-current" />
            ) : (
              <Play className="h-3.5 w-3.5 fill-current" />
            )}
          </button>
          <span className="shrink-0 text-[11px] tabular-nums text-gray-500">{formatPlayerTime(current)}</span>
          <input
            type="range"
            min={0}
            max={dur}
            step={0.1}
            value={Math.min(current, dur)}
            onChange={onSeek}
            disabled={controlsDisabled}
            style={{ background: `linear-gradient(to right, #3b82f6 ${progress}%, #e5e7eb ${progress}%)` }}
            className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full accent-blue-500 disabled:opacity-40"
            aria-label="Playback position"
          />
          <span className="shrink-0 text-[11px] tabular-nums text-gray-500">
            {formatPlayerTime(duration || durationHint || 0)}
          </span>
          <button
            type="button"
            onClick={() => {
              const el = audioRef.current
              if (!el) return
              el.muted = !muted
              setMuted(!muted)
            }}
            disabled={controlsDisabled}
            className="flex h-7 w-7 shrink-0 items-center justify-center text-gray-500 transition hover:text-gray-700 disabled:opacity-40"
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={cycleSpeed}
            disabled={controlsDisabled}
            className="shrink-0 rounded px-1 text-[11px] font-medium text-gray-600 transition hover:bg-gray-200 disabled:opacity-40"
            aria-label="Playback speed"
          >
            x{SPEEDS[speedIdx]}
          </button>
          <button
            type="button"
            onClick={downloadRecording}
            disabled={controlsDisabled}
            className="flex h-7 w-7 shrink-0 items-center justify-center text-gray-500 transition hover:text-gray-700 disabled:opacity-40"
            aria-label="Download recording"
          >
            <Download className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  )
}

function CallTranscript({ callLogId, status: initialStatus, text: initialText, error: initialError, hasRecording }) {
  const [status, setStatus] = useState(initialStatus)
  const [text, setText] = useState(initialText || '')
  const [error, setError] = useState(initialError || '')

  useEffect(() => {
    setStatus(initialStatus)
    setText(initialText || '')
    setError(initialError || '')
  }, [callLogId, initialStatus, initialText, initialError])

  useEffect(() => {
    if (!callLogId || !hasRecording || status !== 'pending') return

    let cancelled = false
    const poll = async () => {
      const { data } = await supabase
        .from('call_logs')
        .select('transcript_status, transcript_deidentified, transcript_error')
        .eq('id', callLogId)
        .maybeSingle()
      if (cancelled || !data) return
      setStatus(data.transcript_status)
      setText(data.transcript_deidentified || '')
      setError(data.transcript_error || '')
    }

    poll()
    const timer = setInterval(poll, 4000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [callLogId, hasRecording, status])

  if (!hasRecording || !callLogId) return null

  if (status === 'pending') {
    return (
      <div className="mt-2 flex items-center gap-2 pl-0 text-xs text-gray-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Transcribing call…
      </div>
    )
  }

  if (status === 'failed') {
    return (
      <p className="mt-2 text-xs text-rose-500">
        {error || 'Transcription failed'}
      </p>
    )
  }

  if (status === 'skipped' || !text?.trim()) return null

  return (
    <div className="mt-2 rounded-md border border-gray-200 bg-white px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Transcript</p>
      <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-gray-700">{text}</p>
    </div>
  )
}

/**
 * GHL-style call log row in the conversation thread (inbound left + avatar, outbound right).
 */
export default function CallMessageBubble({
  inbound,
  sentAt,
  callLogId,
  hasRecording,
  recordingDuration,
  transcriptStatus,
  transcriptText,
  transcriptError,
  avatarClass,
  patientInitials,
  meta,
}) {
  const label = inbound ? 'Inbound Call' : 'Outbound Call'
  const durSec = meta?.duration_sec
  const durTxt = durSec != null ? formatPlayerTime(durSec) : meta?.duration_min ? `${meta.duration_min} min` : null
  const extra = [meta?.outcome, durTxt].filter(Boolean).join(' · ')

  const iconWrap = inbound ? 'bg-rose-500 text-white' : 'bg-emerald-500 text-white'
  const Icon = inbound ? PhoneIncoming : PhoneOutgoing

  const card = (
    <div className="min-w-0 max-w-[min(100%,380px)]">
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded ${iconWrap}`}>
          <Icon className="h-4 w-4" strokeWidth={2.5} />
        </span>
        <span className="text-sm font-semibold text-gray-800">{label}</span>
      </div>
      {extra && <p className="mt-0.5 pl-9 text-xs text-gray-500">{extra}</p>}
      {meta?.note && (
        <p className="mt-0.5 max-w-[320px] pl-9 text-xs italic text-gray-500">“{meta.note}”</p>
      )}
      {hasRecording && callLogId && (
        <div className={inbound ? 'pl-9' : ''}>
          <CallRecordingPlayer callLogId={callLogId} durationHint={recordingDuration} />
          <CallTranscript
            callLogId={callLogId}
            status={transcriptStatus}
            text={transcriptText}
            error={transcriptError}
            hasRecording={hasRecording}
          />
        </div>
      )}
      <p className={`mt-1 text-[11px] tabular-nums text-gray-400 ${inbound ? 'pl-9' : ''}`}>
        {callMessageTime(sentAt)}
      </p>
    </div>
  )

  if (inbound) {
    return (
      <div className="flex items-start gap-2">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${avatarClass}`}
        >
          {patientInitials}
        </div>
        {card}
      </div>
    )
  }

  return <div className="flex justify-end">{card}</div>
}
