import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import Logo from '../components/Logo'
import { supabase } from '../lib/supabase'

// Post-recording processing state. The recording is uploaded and transcription
// runs in the background (status: analyzing → transcribed → analyzed). Instead of
// dropping the TC onto a blank consult page, we hold here, poll for completion,
// and auto-advance once the transcript exists. They can also leave and come back.
const MESSAGES = [
  'Transcribing the recording...',
  'Identifying treatment type and case value...',
  'Detecting objections raised...',
  'Building your coaching insights...',
  'Preparing your follow-up sequence...',
]

// Organic, clustered node layout (a loose "brain") in a 320×240 viewBox.
const NODES = [
  { cx: 70, cy: 80, r: 11, op: 0.9, glow: true },
  { cx: 108, cy: 54, r: 8, op: 0.7 },
  { cx: 150, cy: 74, r: 13, op: 0.95, glow: true },
  { cx: 95, cy: 116, r: 10, op: 0.8 },
  { cx: 140, cy: 122, r: 9, op: 0.7 },
  { cx: 62, cy: 150, r: 9, op: 0.75, glow: true },
  { cx: 106, cy: 166, r: 12, op: 0.85 },
  { cx: 158, cy: 166, r: 8, op: 0.7 },
  { cx: 192, cy: 56, r: 10, op: 0.8 },
  { cx: 236, cy: 86, r: 13, op: 0.95, glow: true },
  { cx: 206, cy: 120, r: 11, op: 0.85 },
  { cx: 256, cy: 150, r: 9, op: 0.75 },
  { cx: 200, cy: 176, r: 10, op: 0.8, glow: true },
  { cx: 176, cy: 110, r: 14, op: 1, glow: true }, // central hub
]

// Edges between nearby nodes [fromIdx, toIdx].
const EDGES = [
  [0, 1], [1, 2], [0, 3], [3, 5], [5, 6], [6, 4],
  [2, 13], [13, 4], [13, 10], [2, 8], [8, 9], [9, 10],
  [10, 12], [10, 11], [4, 7], [12, 7],
]

// Traveling signal pulses along selected edges, varied speeds.
const SIGNALS = [
  { a: 0, b: 3, dur: 2.2 },
  { a: 3, b: 5, dur: 1.6 },
  { a: 2, b: 13, dur: 2.7 },
  { a: 13, b: 10, dur: 1.9 },
  { a: 8, b: 9, dur: 3 },
  { a: 9, b: 10, dur: 2.4 },
]

const KEYFRAMES = `
@keyframes nnNodePulse { 0%,100% { transform: scale(1); opacity: .7 } 50% { transform: scale(1.3); opacity: 1 } }
@keyframes nnGlowRing { 0% { transform: scale(1); opacity: .5 } 100% { transform: scale(2.4); opacity: 0 } }
@keyframes nnEdgeGlow { 0%,100% { stroke-opacity: .2 } 50% { stroke-opacity: .8 } }
@keyframes nnSubFade { from { opacity: 0; transform: translateY(2px) } to { opacity: 1; transform: none } }
.nn-node, .nn-ring { transform-box: fill-box; transform-origin: center; }
@media (prefers-reduced-motion: reduce) {
  .nn-node, .nn-ring, .nn-edge { animation: none !important; }
}
`

function NeuralNet() {
  return (
    <svg width="320" height="240" viewBox="0 0 320 240" aria-hidden="true" className="overflow-visible">
      <defs>
        <radialGradient id="nnGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#0EA5E9" stopOpacity="0.20" />
          <stop offset="65%" stopColor="#0EA5E9" stopOpacity="0.04" />
          <stop offset="100%" stopColor="#0EA5E9" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Outer "lit up" glow behind the network */}
      <ellipse cx="160" cy="118" rx="155" ry="115" fill="url(#nnGlow)" />

      {/* Connections */}
      {EDGES.map(([a, b], i) => {
        const A = NODES[a]; const B = NODES[b]
        return (
          <line
            key={`e${i}`} className="nn-edge"
            x1={A.cx} y1={A.cy} x2={B.cx} y2={B.cy}
            stroke="#0EA5E9" strokeWidth="1.5" strokeOpacity="0.2"
            style={{ animation: `nnEdgeGlow ${2 + (i % 3) * 0.5}s ease-in-out ${i * 0.18}s infinite` }}
          />
        )
      })}

      {/* Nodes (+ optional expanding glow ring) */}
      {NODES.map((n, i) => (
        <g key={`n${i}`}>
          {n.glow && (
            <circle
              className="nn-ring" cx={n.cx} cy={n.cy} r={n.r}
              fill="none" stroke="#38BDF8" strokeWidth="1.5"
              style={{ animation: `nnGlowRing 2.8s ease-out ${i * 0.2}s infinite` }}
            />
          )}
          <circle
            className="nn-node" cx={n.cx} cy={n.cy} r={n.r}
            fill="#0EA5E9" fillOpacity={n.op}
            style={{ animation: `nnNodePulse 2.4s ease-in-out ${i * 0.15}s infinite` }}
          />
        </g>
      ))}

      {/* Traveling signal pulses */}
      {SIGNALS.map((s, i) => {
        const A = NODES[s.a]; const B = NODES[s.b]
        return (
          <circle key={`s${i}`} r="3" fill="#e0f2fe" style={{ filter: 'drop-shadow(0 0 4px #38bdf8)' }}>
            <animateMotion dur={`${s.dur}s`} repeatCount="indefinite" path={`M${A.cx},${A.cy} L${B.cx},${B.cy}`} />
          </circle>
        )
      })}
    </svg>
  )
}

export default function ProcessingScreen() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  // Outcome chosen on the recording modal; 'pending' means follow-up will run.
  const willFollowUp = location.state?.outcome === 'pending'

  const [msgIndex, setMsgIndex] = useState(0)
  const [progress, setProgress] = useState(0)
  const doneRef = useRef(false)

  // Cycle the status copy every 3s.
  useEffect(() => {
    const t = setInterval(() => setMsgIndex((i) => (i + 1) % MESSAGES.length), 3000)
    return () => clearInterval(t)
  }, [])

  // Animate the bar 0 → 85% over ~45s; never completes until we navigate.
  useEffect(() => {
    const step = 85 / (45000 / 250)
    const t = setInterval(() => setProgress((p) => Math.min(85, p + step)), 250)
    return () => clearInterval(t)
  }, [])

  // Poll the consult until transcription lands, then advance to the real page.
  useEffect(() => {
    if (!id) return
    let active = true
    const check = async () => {
      const { data } = await supabase
        .from('consults')
        .select('status, transcript_deidentified')
        .eq('id', id)
        .maybeSingle()
      if (!active || doneRef.current) return
      const ready = data && (data.transcript_deidentified || (data.status && data.status !== 'analyzing'))
      if (ready) {
        doneRef.current = true
        navigate(`/consults/${id}`, { replace: true })
      }
    }
    check()
    const t = setInterval(check, 5000)
    return () => { active = false; clearInterval(t) }
  }, [id, navigate])

  return (
    <div className="flex min-h-[80vh] flex-col items-center justify-center px-4 py-10 text-center">
      <style>{KEYFRAMES}</style>

      <div className="mb-2"><Logo size="lg" /></div>

      {/* Neural-network analysis animation */}
      <NeuralNet />

      <h1 className="mt-4 text-xl font-semibold text-white">Analyzing your consultation</h1>

      {/* Cycling subtitle (fades between messages) */}
      <p key={msgIndex} className="mt-2 h-5 text-sm text-slate-400" style={{ animation: 'nnSubFade 0.5s ease-out' }}>
        {MESSAGES[msgIndex]}
      </p>

      {/* Progress bar — 240px × 3px, fills to 85% over 45s */}
      <div className="mt-6 h-[3px] w-60 overflow-hidden rounded-full bg-surface-800">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300 ease-linear"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Info box */}
      <div className="mt-7 max-w-[400px] rounded-xl border border-white/[0.07] bg-surface-800/60 px-5 py-4 text-sm text-slate-400">
        You can leave this page — we'll keep working in the background. Check back to see your
        transcript, coaching insights, and follow-up status.
        {willFollowUp && (
          <span className="mt-3 block border-t border-white/[0.07] pt-3 font-medium text-primary-300">
            ✓ Follow-up sequence will begin automatically once analysis is complete
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="mt-7 flex flex-wrap items-center justify-center gap-5">
        <button
          onClick={() => navigate('/')}
          className="inline-flex items-center gap-2 rounded-lg border border-surface-700 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-surface-800"
        >
          Go to Dashboard <ArrowRight className="h-4 w-4" />
        </button>
        <span className="text-sm font-medium text-slate-500">Stay and watch</span>
      </div>
    </div>
  )
}
