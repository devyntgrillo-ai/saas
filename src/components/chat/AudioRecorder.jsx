import { useEffect, useRef, useState } from 'react'
import { X, Send, Loader2 } from 'lucide-react'

function fmt(s) {
  const m = Math.floor(s / 60)
  const x = s % 60
  return `${m}:${String(x).padStart(2, '0')}`
}

// Inline voice-memo recorder with a live waveform. onSend(blob, durationSec).
export default function AudioRecorder({ onSend, onCancel }) {
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const streamRef = useRef(null)
  const recRef = useRef(null)
  const chunksRef = useRef([])
  const canvasRef = useRef(null)
  const rafRef = useRef(null)
  const audioCtxRef = useRef(null)
  const timerRef = useRef(null)
  const startRef = useRef(0)

  function cleanup() {
    if (timerRef.current) clearInterval(timerRef.current)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (audioCtxRef.current) audioCtxRef.current.close().catch(() => {})
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  useEffect(() => {
    let cancelled = false
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
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
        if (!cancelled) setError('Microphone access is blocked. Allow it in your browser, then try again.')
      }
    }
    start()
    return () => { cancelled = true; cleanup() }
  }, [])

  function cancel() {
    try { recRef.current?.stop() } catch { /* noop */ }
    cleanup()
    onCancel?.()
  }

  function stopAndSend() {
    const mr = recRef.current
    if (!mr) { onCancel?.(); return }
    const dur = Math.max(1, seconds)
    mr.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' })
      cleanup()
      setSending(true)
      await onSend?.(blob, dur)
    }
    try { mr.stop() } catch { onCancel?.() }
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
        <span className="flex-1">{error}</span>
        <button onClick={onCancel} className="rounded-md p-1 text-slate-400 hover:text-white"><X className="h-4 w-4" /></button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 rounded-2xl border border-surface-700 bg-surface-800 px-3 py-2">
      <button onClick={cancel} disabled={sending} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-surface-700 hover:text-white" title="Cancel">
        <X className="h-4 w-4" />
      </button>
      <span className="flex items-center gap-1.5 text-xs font-medium text-rose-400">
        <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500/70" /><span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" /></span>
        {fmt(seconds)}
      </span>
      <canvas ref={canvasRef} width={320} height={28} className="h-7 min-w-0 flex-1" />
      <button onClick={stopAndSend} disabled={sending} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary !text-white transition hover:bg-primary-700" title="Send voice memo">
        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
      </button>
    </div>
  )
}
