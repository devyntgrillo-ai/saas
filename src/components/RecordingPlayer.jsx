import { useEffect, useRef, useState } from 'react'
import { AudioLines, Loader2, AlertTriangle } from 'lucide-react'
import { supabase } from '../lib/supabase'

// Playback speeds offered for reviewing a consult recording.
const SPEEDS = [1, 1.25, 1.5, 2]

// Recording section for the consult detail page. Always rendered so it's clear
// whether a recording exists. When audio was retained it fetches a short-lived
// signed URL (from get-recording-url, authorized via the caller's RLS) and shows
// a player with speed control; otherwise it explains why there's nothing to play.
export default function RecordingPlayer({ consultId, hasAudio = true, processing = false, deletedAt = null, retentionDays = 30 }) {
  const audioRef = useRef(null)
  const [url, setUrl] = useState(null)
  const [loading, setLoading] = useState(hasAudio)
  const [error, setError] = useState('')
  const [speed, setSpeed] = useState(1)

  useEffect(() => {
    if (!hasAudio) return // nothing to fetch
    let active = true
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true)
    setError('')
    setUrl(null)
    /* eslint-enable react-hooks/set-state-in-effect */
    supabase.functions
      .invoke('get-recording-url', { body: { consult_id: consultId } })
      .then(async ({ data, error: err }) => {
        if (!active) return
        if (err) {
          // functions.invoke reports non-2xx generically; pull the real reason
          // out of the response body so the message is actionable.
          let msg = err.message || 'Recording unavailable.'
          try {
            const body = await err.context?.json?.()
            if (body?.error) msg = body.error
          } catch { /* keep generic message */ }
          setError(msg)
        } else if (data?.error || !data?.url) {
          setError(data?.error || 'Recording unavailable.')
        } else {
          setUrl(data.url)
        }
      })
      .catch((e) => { if (active) setError(e?.message || 'Recording unavailable.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [consultId, hasAudio])

  // Keep the chosen speed applied across element (re)loads.
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed
  }, [url, speed])

  function setRate(r) {
    setSpeed(r)
    if (audioRef.current) audioRef.current.playbackRate = r
  }

  // The "no audio" explanation: still transcribing, deleted after retention, or
  // never retained (older consult predating audio retention).
  const emptyMessage = processing
    ? 'The recording is being processed…'
    : deletedAt
      ? (Number(retentionDays) === 0
          ? 'Recording deleted immediately after transcription. Transcript and analysis are preserved.'
          : `Recording deleted after ${retentionDays}-day retention period. Transcript and analysis are preserved.`)
      : 'Recording not retained for this consult. Audio is kept only for consults recorded recently.'

  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        <AudioLines className="h-3.5 w-3.5" /> Recording
      </p>

      {!hasAudio ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-gray-400">
          {processing && <Loader2 className="h-4 w-4 animate-spin" />}
          {emptyMessage}
        </p>
      ) : loading ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading recording…
        </div>
      ) : error ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-gray-400">
          <AlertTriangle className="h-4 w-4" /> {error}
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          <audio ref={audioRef} src={url} controls preload="metadata" className="h-10 w-full min-w-0 flex-1" />
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="text-xs text-gray-400">Speed</span>
            {SPEEDS.map((r) => (
              <button
                key={r}
                onClick={() => setRate(r)}
                className={`rounded-md px-2 py-1 text-xs font-semibold transition ${
                  speed === r ? 'bg-primary-600 text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {r}×
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
