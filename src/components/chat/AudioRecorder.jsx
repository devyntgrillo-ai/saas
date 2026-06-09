import { useEffect, useRef, useState } from 'react'
import { X, Send, Loader2, RefreshCcw, Square } from 'lucide-react'
import AudioClip from './AudioClip'

function fmt(s) {
  const m = Math.floor(s / 60)
  const x = s % 60
  return `${m}:${String(x).padStart(2, '0')}`
}

// Inline voice-memo recorder. Records with a live waveform, then drops into a
// review state (replay / re-record / send) — nothing sends until the user hits
// Send. onSend(blob, durationSec).
export default function AudioRecorder({ onSend, onCancel }) {
  const [phase, setPhase] = useState('recording') // recording | review
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [blob, setBlob] = useState(null)
  const [blobUrl, setBlobUrl] = useState(null)
  const [dur, setDur] = useState(0)

  const streamRef = useRef(null)
  const recRef = useRef(null)
  const chunksRef = useRef([])
  const canvasRef = useRef(null)
  const rafRef = useRef(null)
  const audioCtxRef = useRef(null)
  const timerRef = useRef(null)
  const startRef = useRef(0)

  function cleanupStream() {
    if (timerRef.current) clearInterval(timerRef.current)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (audioCtxRef.current) audioCtxRef.current.close().catch(() => {})
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  async function startRecording() {
    setError('')
    setSeconds(0)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const AC = window.AudioContext || window.webkitAudioContext
      const ac = new AC()
      audioCtxRef.current = ac
      const src = ac.createMediaStreamSource(stream)
      const an = ac.createAnalyser()
      an.fftSize = 256
      src.connect(an)
      const data = new Uint8Array(an.frequencyBinCount)
      const draw = () => {
        rafRef.current = requestAnimationFrame(draw)
        const c = canvasRef.current
        if (!c) return
        const x = c.getContext('2d')
        const w = c.width
        const h = c.height
        an.getByteFrequencyData(data)
        x.clearRect(0, 0, w, h)
        const n = 36
        const step = Math.floor(data.length / n)
        const bw = w / n
        for (let i = 0; i < n; i++) {
          const v = data[i * step] / 255
          const bh = Math.max(2, v * h)
          x.fillStyle = `rgba(14,165,233,${0.4 + v * 0.6})`
          x.fillRect(i * bw + 1, (h - bh) / 2, bw - 2, bh)
        }
      }
      draw()
      const mr = new MediaRecorder(stream)
      chunksRef.current = []
      mr.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data)
      mr.start()
      recRef.current = mr
      startRef.current = Date.now()
      timerRef.current = setInterval(() => setSeconds(Math.floor((Date.now() - startRef.current) / 1000)), 250)
    } catch {
      setError('Microphone access is blocked. Allow it in your browser, then try again.')
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    startRecording()
    return () => cleanupStream()
  }, [])
  useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl) }, [blobUrl])

  function stopToReview() {
    const mr = recRef.current
    if (!mr) { onCancel?.(); return }
    const finalDur = Math.max(1, seconds)
    mr.onstop = () => {
      const b = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' })
      cleanupStream()
      setBlob(b)
      setDur(finalDur)
      setBlobUrl(URL.createObjectURL(b))
      setPhase('review')
    }
    try { mr.stop() } catch { onCancel?.() }
  }

  function reRecord() {
    if (blobUrl) URL.revokeObjectURL(blobUrl)
    setBlob(null)
    setBlobUrl(null)
    setPhase('recording')
    startRecording()
  }

  async function sendIt() {
    if (!blob || sending) return
    setSending(true)
    await onSend?.(blob, dur)
  }

  function cancel() {
    try { recRef.current?.stop() } catch { /* noop */ }
    cleanupStream()
    onCancel?.()
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
        <span className="flex-1">{error}</span>
        <button onClick={onCancel} className="rounded-md p-1 text-slate-400 hover:text-white"><X className="h-4 w-4" /></button>
      </div>
    )
  }

  if (phase === 'review') {
    return (
      <div className="rounded-2xl border border-surface-700 bg-surface-800 p-2">
        <AudioClip url={blobUrl} durationSec={dur} seed="preview" />
        <div className="mt-2 flex items-center gap-2">
          <button onClick={cancel} disabled={sending} className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-surface-700 hover:text-white" title="Discard">
            <X className="h-4 w-4" />
          </button>
          <button onClick={reRecord} disabled={sending} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs text-slate-300 transition hover:bg-surface-700">
            <RefreshCcw className="h-3.5 w-3.5" /> Re-record
          </button>
          <button onClick={sendIt} disabled={sending} className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold !text-white transition hover:bg-primary-700">
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 rounded-2xl border border-surface-700 bg-surface-800 px-3 py-2">
      <button onClick={cancel} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-surface-700 hover:text-white" title="Cancel">
        <X className="h-4 w-4" />
      </button>
      <span className="flex items-center gap-1.5 text-xs font-medium text-rose-400">
        <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500/70" /><span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" /></span>
        {fmt(seconds)}
      </span>
      <canvas ref={canvasRef} width={320} height={28} className="h-7 min-w-0 flex-1" />
      <button onClick={stopToReview} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary !text-white transition hover:bg-primary-700" title="Stop & review">
        <Square className="h-3.5 w-3.5 fill-current" />
      </button>
    </div>
  )
}
