import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Loader2, ArrowRight, Rocket, PartyPopper } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useRecorder } from '../context/RecorderContext'
import { useUpdatePractice } from '../lib/queries'
import InviteModal from '../components/InviteModal'
import KnowledgeBaseQuickForm from '../components/KnowledgeBaseQuickForm'
import {
  LAUNCHPAD_STEPS,
  LAUNCHPAD_TOTAL,
  loadLaunchpadStatus,
  markStepsComplete,
  launchpadComplete,
} from '../lib/launchpad'

function Badge({ children }) {
  const tone = children === 'Required for SMS'
    ? 'bg-rose-500/15 text-rose-300'
    : 'bg-sky-500/15 text-sky-300'
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>{children}</span>
}

export default function Launchpad() {
  const { practice, practiceId, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const { openRecorder } = useRecorder()
  const updatePractice = useUpdatePractice()

  const [done, setDone] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [inviting, setInviting] = useState(false)
  const [kbOpen, setKbOpen] = useState(false)
  const [justCompleted, setJustCompleted] = useState(false)
  const stampedRef = useRef(false)

  const completedAt = practice?.launchpad_completed_at

  const refresh = useCallback(async () => {
    if (!practiceId) return
    const s = await loadLaunchpadStatus(practiceId, practice)
    setDone(s)
    setLoading(false)
  }, [practiceId, practice])

  useEffect(() => { refresh() }, [refresh])

  // Re-check when the window regains focus (e.g. after recording or visiting a
  // settings tab in another flow) so checkmarks land without a manual reload.
  useEffect(() => {
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  // Stamp completion exactly once when all steps are done.
  useEffect(() => {
    if (loading || completedAt || stampedRef.current) return
    if (launchpadComplete(done)) {
      stampedRef.current = true
      updatePractice.mutate(
        { practiceId, patch: { launchpad_completed_at: new Date().toISOString() } },
        { onSuccess: () => { setJustCompleted(true); refreshProfile() } },
      )
    }
  }, [done, loading, completedAt, practiceId, updatePractice, refreshProfile])

  function handleAction(step) {
    const a = step.action
    if (a === 'invite') setInviting(true)
    else if (a === 'record') openRecorder()
    else if (a === 'kb') setKbOpen(true)
    else if (a?.startsWith('nav:')) navigate(a.slice(4))
  }

  const completedCount = LAUNCHPAD_STEPS.filter((s) => done.has(s.key)).length
  const pct = Math.round((completedCount / LAUNCHPAD_TOTAL) * 100)
  const nextKey = LAUNCHPAD_STEPS.find((s) => !done.has(s.key))?.key

  // ── Completion screen ──────────────────────────────────────────────────────
  if (completedAt || justCompleted) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="card overflow-hidden p-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-300">
            <PartyPopper className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold text-white">🎉 You’re fully set up!</h1>
          <p className="mt-2 text-slate-300">CaseLift is working in the background. Here’s what to expect this week:</p>
          <ul className="mx-auto mt-5 max-w-md space-y-2 text-left text-sm text-slate-300">
            {[
              'Record consults and CaseLift transcribes + analyzes each one automatically.',
              'Personalized follow-up sequences go out by text and email, no manual work.',
              'You’ll get notified the moment a patient replies, right here and by email.',
              'Recovered cases show up on your Dashboard so you can see the ROI.',
            ].map((t) => (
              <li key={t} className="flex gap-2.5">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> {t}
              </li>
            ))}
          </ul>
          <button onClick={() => navigate('/')} className="btn-primary mx-auto mt-7">
            Go to Dashboard <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    )
  }

  // ── Checklist ──────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary-300">
          <Rocket className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">Setup Progress</h1>
          <p className="text-sm text-slate-400">A few quick steps to get the most out of CaseLift.</p>
        </div>
      </div>

      {/* Progress */}
      <div className="card p-5">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-slate-200">Setup progress: {completedCount} of {LAUNCHPAD_TOTAL} complete</span>
          <span className="text-slate-500">{pct}%</span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-800">
          <div className="h-full rounded-full bg-emerald-400 transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Items */}
      {loading ? (
        <div className="card flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-500" /></div>
      ) : (
        <div className="space-y-3">
          {LAUNCHPAD_STEPS.map((step) => {
            const checked = done.has(step.key)
            const isNext = step.key === nextKey
            return (
              <div
                key={step.key}
                className={[
                  'rounded-2xl border bg-surface-900 p-5 transition',
                  checked
                    ? 'border-emerald-500/30 opacity-70'
                    : isNext
                    ? 'border-surface-700 border-l-[3px] !border-l-primary'
                    : 'border-surface-700',
                ].join(' ')}
              >
                <div className="flex items-start gap-4">
                  <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${checked ? 'bg-emerald-500 !text-white' : 'border-2 border-surface-600 bg-surface-800'}`}>
                    {checked && <Check className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className={`text-sm font-semibold ${checked ? 'text-slate-400' : 'text-white'}`}>{step.title}</h3>
                      {step.badge && !checked && <Badge>{step.badge}</Badge>}
                      {step.time && !checked && <span className="text-xs text-slate-500">· {step.time}</span>}
                    </div>
                    <p className="mt-0.5 text-sm text-slate-400">{step.description}</p>
                  </div>
                  {!checked && step.action && (
                    <button onClick={() => handleAction(step)} className={isNext ? 'btn-primary shrink-0' : 'btn-secondary shrink-0'}>
                      {step.cta} <ArrowRight className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {inviting && (
        <InviteModal
          scope="practice"
          practiceId={practiceId}
          onClose={() => setInviting(false)}
          onSent={async () => { await markStepsComplete(practiceId, ['team_invited']); refresh() }}
        />
      )}
      {kbOpen && (
        <KnowledgeBaseQuickForm
          onClose={() => setKbOpen(false)}
          onSaved={async () => { setKbOpen(false); await markStepsComplete(practiceId, ['knowledge_base_added']); refresh() }}
        />
      )}
    </div>
  )
}
