import { useRef, useState } from 'react'
import { Play, Pause, FileText } from 'lucide-react'

// Deterministic pseudo-waveform from a seed so a given clip looks stable.
function waveBars(seed) {
  const s = String(seed || 'x')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  let x = Math.abs(h) || 7
  const out = []
  for (let i = 0; i < 40; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff
    out.push(22 + (x % 78))
  }
  return out
}
function fmtDur(s) {
  if (s == null) return ''
  const m = Math.floor(s / 60)
  const x = Math.floor(s % 60)
  return `${m}:${String(x).padStart(2, '0')}`
}

// Slack-style voice memo: play/pause + waveform + duration, with an expandable
// transcript below.
export default function AudioClip({ url, durationSec, transcript, seed }) {
  const ref = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [showT, setShowT] = useState(false)
  const bars = waveBars(seed || url)

  function toggle() {
    const a = ref.current
    if (!a) return
    if (playing) a.pause()
    else a.play().catch(() => {})
  }

  return (
    <div className="mt-1 w-fit max-w-sm">
      <div className="flex items-center gap-2.5 rounded-2xl border border-surface-700 bg-surface-800 px-3 py-2">
        <button onClick={toggle} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary !text-white transition hover:bg-primary-700">
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-[1px]" />}
        </button>
        <div className="flex h-7 flex-1 items-center gap-[2px]">
          {bars.map((b, i) => (
            <span key={i} className={`w-[2px] rounded-full ${playing ? 'bg-primary/70' : 'bg-slate-400/60'}`} style={{ height: `${b}%` }} />
          ))}
        </div>
        <span className="shrink-0 text-xs tabular-nums text-slate-400">{fmtDur(durationSec)}</span>
        <audio ref={ref} src={url} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} className="hidden" />
      </div>
      {transcript && (
        <button onClick={() => setShowT((v) => !v)} className="mt-1 flex items-center gap-1 text-[11px] text-primary-300 transition hover:underline">
          <FileText className="h-3 w-3" /> {showT ? 'Hide transcript' : 'Show transcript'}
        </button>
      )}
      {showT && transcript && (
        <p className="mt-1 max-w-sm rounded-lg bg-surface-800/60 p-2 text-xs leading-relaxed text-slate-300">{transcript}</p>
      )}
    </div>
  )
}
