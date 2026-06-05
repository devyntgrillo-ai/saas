import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { Loader2, ArrowRight } from 'lucide-react'
import Logo from '../components/Logo'
import { supabase } from '../lib/supabase'

// Post-recording processing state. The recording is uploaded and transcription
// runs in the background (status: analyzing → transcribed → analyzed). Instead of
// dropping the TC onto a blank consult page, we hold here, poll for completion,
// and auto-advance once the transcript exists. They can also leave and come back.
const MESSAGES = [
  'Transcribing the recording...',
  'Identifying treatment type and case value...',
  'Detecting objections...',
  'Building your follow-up sequence...',
  'Generating coaching insights...',
]

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

  // Animate the bar from 0 → 90% over ~30s; it never completes until we navigate.
  useEffect(() => {
    const step = 90 / (30000 / 250)
    const t = setInterval(() => setProgress((p) => Math.min(90, p + step)), 250)
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
      <Logo size="lg" />

      {/* Animated waveform */}
      <div className="mt-10 flex h-16 items-end gap-1.5" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <span
            key={i}
            className="w-2 rounded-full bg-primary animate-pulse"
            style={{ height: `${30 + ((i * 37) % 70)}%`, animationDelay: `${i * 0.12}s`, animationDuration: '1s' }}
          />
        ))}
      </div>

      <h1 className="mt-8 text-2xl font-bold text-white sm:text-3xl">Analyzing your consultation...</h1>

      {/* Cycling subtext with a fade between messages */}
      <p key={msgIndex} className="animate-dropdown mt-3 h-5 text-sm font-medium text-primary-300">
        {MESSAGES[msgIndex]}
      </p>

      {/* Progress bar (caps at 90% until actually done) */}
      <div className="mt-7 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-surface-800">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300 ease-linear"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Info box */}
      <div className="mt-8 max-w-md rounded-xl border border-white/[0.07] bg-surface-800/60 px-5 py-4 text-left text-sm text-slate-300">
        <p className="flex items-start gap-2">
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-slate-400" />
          <span>
            You can leave this page — we'll keep working in the background. Come back to view your
            transcript, coaching insights, and follow-up status.
          </span>
        </p>
        {willFollowUp && (
          <p className="mt-3 border-t border-white/[0.07] pt-3 font-medium text-primary-300">
            ✓ Follow-up sequence will begin automatically once transcription is complete.
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={() => navigate('/')}
          className="inline-flex items-center gap-2 rounded-lg border border-surface-700 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-surface-800"
        >
          Go to Dashboard <ArrowRight className="h-4 w-4" />
        </button>
        <span className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Staying — opens automatically when ready
        </span>
      </div>
    </div>
  )
}
