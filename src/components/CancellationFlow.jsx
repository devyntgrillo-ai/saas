import { useEffect, useState } from 'react'
import {
  X,
  Loader2,
  DollarSign,
  PhoneCall,
  Clock,
  Users,
  PauseCircle,
  Sparkles,
  AlertTriangle,
  Heart,
  Download,
  Check,
  ArrowRight,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { formatMoney } from '../lib/analytics'
import {
  DOWNSELL,
  CANCELLATION_REASONS,
  fetchCancellationImpact,
  pauseSubscription,
  acceptDownsell,
  submitCancellationFeedback,
  cancelSubscription,
  exportPracticeData,
} from '../lib/billing'

function Shell({ onClose, children, maxWidth = 'max-w-lg', dismissable = true }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={dismissable ? onClose : undefined} />
      <div className={`relative z-10 w-full ${maxWidth} overflow-hidden rounded-2xl border border-surface-700 bg-surface-900 shadow-2xl`}>
        {dismissable && (
          <button
            onClick={onClose}
            className="absolute right-3 top-3 z-20 rounded-md p-1.5 text-slate-500 transition hover:bg-surface-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        )}
        <div className="max-h-[85vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

function BigStat({ icon: Icon, value, label, danger }) {
  return (
    <div className={`rounded-xl border p-4 ${danger ? 'border-rose-500/30 bg-rose-500/[0.07]' : 'border-surface-700 bg-surface-800/50'}`}>
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${danger ? 'text-rose-400' : 'text-slate-400'}`} />
        <p className="text-2xl font-extrabold tracking-tight text-white">{value}</p>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">{label}</p>
    </div>
  )
}

export default function CancellationFlow({ onClose }) {
  const { practice, practiceId, refreshProfile } = useAuth()
  const [step, setStep] = useState('impact') // impact | pause | downsell | survey | confirm | paused | downsell_done | goodbye
  const [impact, setImpact] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('')
  const [elaboration, setElaboration] = useState('')
  const [pauseInfo, setPauseInfo] = useState(null)
  const [exported, setExported] = useState(false)

  useEffect(() => {
    let active = true
    fetchCancellationImpact(practiceId)
      .then((d) => active && setImpact(d))
      .catch(() => active && setImpact(null))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [practiceId])

  const activePatients = impact?.activePatients ?? 0

  async function doPause(months) {
    setBusy(true)
    try {
      const ends = await pauseSubscription(practiceId, months)
      setPauseInfo({ months, ends })
      await refreshProfile()
      setStep('paused')
    } finally {
      setBusy(false)
    }
  }

  async function doDownsell() {
    setBusy(true)
    try {
      await acceptDownsell(practiceId)
      await refreshProfile()
      setStep('downsell_done')
    } finally {
      setBusy(false)
    }
  }

  async function doCancel() {
    setBusy(true)
    try {
      await submitCancellationFeedback({ practiceId, reason, elaboration, impact })
      await cancelSubscription(practiceId)
      await refreshProfile()
      setStep('goodbye')
    } finally {
      setBusy(false)
    }
  }

  async function doExport() {
    await exportPracticeData(practiceId, practice?.name)
    setExported(true)
  }

  // ---- Step 1: personalized impact -----------------------------------------
  if (step === 'impact') {
    return (
      <Shell onClose={onClose}>
        <div className="border-b border-rose-500/20 bg-gradient-to-b from-rose-950/40 to-transparent px-6 pb-5 pt-7 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/15 text-rose-400">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-xl font-bold text-white">Before you go - here's what CaseLift has done for you</h2>
          <p className="mt-1 text-sm text-slate-400">Cancelling ends this. Take a look first.</p>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
            </div>
          ) : (
            <>
              <div className="rounded-2xl border border-rose-500/30 bg-rose-500/[0.07] p-5 text-center">
                <p className="text-xs font-semibold uppercase tracking-wide text-rose-300">Production recovered</p>
                <p className="mt-1 text-5xl font-black tracking-tight text-white">
                  {formatMoney(impact?.production || 0)}
                </p>
                <p className="mt-1 text-sm text-slate-400">recovered through CaseLift follow-ups</p>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <BigStat
                  icon={PhoneCall}
                  value={`${impact?.consultsAnalyzed || 0}`}
                  label={`consults analyzed and ${impact?.messagesWritten || 0} follow-up messages written for you`}
                />
                <BigStat
                  icon={Clock}
                  value={`${impact?.hoursSaved || 0} hrs`}
                  label="of manual follow-up saved by your automated sequences"
                />
                <BigStat
                  icon={Users}
                  danger
                  value={`${activePatients}`}
                  label="patients are currently in active follow-up - they'll never hear from you again"
                />
                <BigStat
                  icon={DollarSign}
                  value={`${impact?.messagesSent || 0}`}
                  label="messages already sent on your behalf"
                />
              </div>
            </>
          )}

          <div className="mt-6 flex flex-col gap-2">
            <button onClick={onClose} className="btn-primary w-full">
              <Heart className="h-4 w-4" /> Keep my account
            </button>
            <button
              onClick={() => setStep('pause')}
              className="w-full rounded-lg px-4 py-2.5 text-sm font-medium text-slate-500 transition hover:text-slate-300"
            >
              Continue cancelling
            </button>
          </div>
        </div>
      </Shell>
    )
  }

  // ---- Step 2: pause --------------------------------------------------------
  if (step === 'pause') {
    return (
      <Shell onClose={onClose}>
        <div className="p-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent-subtle)] text-[var(--accent)]">
            <PauseCircle className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-xl font-bold text-white">Life gets busy. Want to pause instead?</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-slate-400">
            Take a break with <span className="font-semibold text-slate-200">no charge</span>. Your sequences pause and
            all your data stays exactly where it is.
          </p>

          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[1, 2].map((months) => (
              <button
                key={months}
                onClick={() => doPause(months)}
                disabled={busy}
                className="group rounded-xl border border-surface-700 bg-surface-800/50 p-5 text-left transition hover:border-[var(--accent-border)] hover:bg-[var(--accent-subtle)] disabled:opacity-50"
              >
                <p className="text-lg font-bold text-white">Pause for {months} month{months > 1 ? 's' : ''}</p>
                <p className="mt-1 text-xs text-slate-400">No charge · sequences paused · data preserved</p>
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent)]">
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                  Pause now
                </span>
              </button>
            ))}
          </div>

          <button
            onClick={() => setStep('downsell')}
            disabled={busy}
            className="mt-6 w-full rounded-lg px-4 py-2.5 text-sm font-medium text-slate-500 transition hover:text-slate-300"
          >
            No thanks, continue cancelling
          </button>
        </div>
      </Shell>
    )
  }

  // ---- Step 3: downsell -----------------------------------------------------
  if (step === 'downsell') {
    return (
      <Shell onClose={onClose}>
        <div className="border-b border-primary/20 bg-gradient-to-b from-primary/10 to-transparent px-6 pb-5 pt-7 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary-300">
            <Sparkles className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-xl font-bold text-white">Stay for 3 months at {DOWNSELL.percentOff}% off</h2>
        </div>
        <div className="p-6">
          <div className="rounded-2xl border border-primary/30 bg-primary/[0.06] p-5 text-center">
            <p className="text-sm text-slate-400">
              <span className="text-2xl font-black text-white">${DOWNSELL.price}</span>
              <span className="text-slate-400">/month for {DOWNSELL.months} months</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">then back to $997/month</p>
          </div>

          <ul className="mt-5 space-y-2.5 text-sm text-slate-300">
            <li className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> Keep all your patient data and active sequences</li>
            <li className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> Your practice intelligence keeps learning</li>
            <li className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> Lock in this rate - it won't be offered again</li>
          </ul>

          <div className="mt-6 flex flex-col gap-2">
            <button onClick={doDownsell} disabled={busy} className="btn-primary w-full">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Accept offer
            </button>
            <button
              onClick={() => setStep('survey')}
              disabled={busy}
              className="w-full rounded-lg px-4 py-2.5 text-sm font-medium text-slate-500 transition hover:text-slate-300"
            >
              No thanks, continue cancelling
            </button>
          </div>
        </div>
      </Shell>
    )
  }

  // ---- Step 4: exit survey --------------------------------------------------
  if (step === 'survey') {
    return (
      <Shell onClose={onClose}>
        <div className="p-6">
          <h2 className="text-xl font-bold text-white">Help us understand why</h2>
          <p className="mt-1 text-sm text-slate-400">This is required, and it genuinely helps us improve.</p>

          <div className="mt-5 space-y-2">
            {CANCELLATION_REASONS.map((r) => (
              <button
                key={r.value}
                onClick={() => setReason(r.value)}
                className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition ${
                  reason === r.value
                    ? 'border-primary bg-primary/10 text-white'
                    : 'border-surface-700 bg-surface-800/50 text-slate-300 hover:border-surface-600'
                }`}
              >
                <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${reason === r.value ? 'border-primary bg-primary' : 'border-surface-600'}`}>
                  {reason === r.value && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
                {r.label}
              </button>
            ))}
          </div>

          <textarea
            value={elaboration}
            onChange={(e) => setElaboration(e.target.value)}
            rows={3}
            placeholder="Anything else you'd like to share? (optional)"
            className="input mt-4 resize-y"
          />

          <div className="mt-6 flex flex-col gap-2">
            <button onClick={() => setStep('confirm')} disabled={!reason} className="btn-primary w-full">
              Continue <ArrowRight className="h-4 w-4" />
            </button>
            <button onClick={onClose} className="w-full rounded-lg px-4 py-2.5 text-sm font-medium text-slate-500 transition hover:text-slate-300">
              Never mind, keep my account
            </button>
          </div>
        </div>
      </Shell>
    )
  }

  // ---- Step 5: final confirmation ------------------------------------------
  if (step === 'confirm') {
    return (
      <Shell onClose={busy ? undefined : onClose} dismissable={!busy}>
        <div className="p-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/15 text-rose-400">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-xl font-bold text-white">Are you sure? This cannot be undone.</h2>

          <div className="mt-5 rounded-xl border border-rose-500/30 bg-rose-500/[0.07] p-5">
            <p className="text-3xl font-black text-white">{activePatients}</p>
            <p className="mt-1 text-sm text-rose-200">patients will lose their follow-up forever</p>
          </div>

          <div className="mt-6 flex flex-col gap-2">
            <button onClick={doCancel} disabled={busy} className="w-full rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold !text-white transition hover:bg-rose-500 disabled:opacity-50">
              {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Yes, cancel my subscription'}
            </button>
            <button onClick={onClose} disabled={busy} className="btn-primary w-full">
              <Heart className="h-4 w-4" /> Never mind, keep my account
            </button>
          </div>
        </div>
      </Shell>
    )
  }

  // ---- Pause confirmation ---------------------------------------------------
  if (step === 'paused') {
    return (
      <Shell onClose={onClose}>
        <div className="p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent-subtle)] text-[var(--accent)]">
            <PauseCircle className="h-7 w-7" />
          </div>
          <h2 className="mt-5 text-xl font-bold text-white">Your account is paused</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-slate-400">
            We won't charge you for the next {pauseInfo?.months} month{pauseInfo?.months > 1 ? 's' : ''}. Your sequences are
            on hold and everything is preserved. We'll pick back up automatically
            {pauseInfo?.ends ? ` on ${new Date(pauseInfo.ends).toLocaleDateString()}` : ''}.
          </p>
          <button onClick={onClose} className="btn-primary mt-7 w-full">Done</button>
        </div>
      </Shell>
    )
  }

  // ---- Downsell confirmation ------------------------------------------------
  if (step === 'downsell_done') {
    return (
      <Shell onClose={onClose}>
        <div className="p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400">
            <Check className="h-7 w-7" />
          </div>
          <h2 className="mt-5 text-xl font-bold text-white">You're locked in at ${DOWNSELL.price}/month</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-slate-400">
            That's {DOWNSELL.percentOff}% off for the next {DOWNSELL.months} months. Your data, sequences, and practice
            intelligence all keep running. Thanks for staying with us.
          </p>
          <button onClick={onClose} className="btn-primary mt-7 w-full">Back to billing</button>
        </div>
      </Shell>
    )
  }

  // ---- Goodbye --------------------------------------------------------------
  if (step === 'goodbye') {
    return (
      <Shell onClose={onClose} dismissable={false}>
        <div className="p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-800 text-primary-300">
            <Heart className="h-7 w-7" />
          </div>
          <h2 className="mt-5 text-xl font-bold text-white">Thank you for being a CaseLift client</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
            Your subscription has been cancelled. We've genuinely valued working with {practice?.name || 'your practice'}.
          </p>

          <div className="mt-5 space-y-3 text-left">
            <div className="rounded-xl border border-surface-700 bg-surface-800/50 p-4">
              <p className="text-sm font-medium text-slate-200">Your data is preserved for 90 days</p>
              <p className="mt-1 text-xs text-slate-500">
                Nothing is deleted right away - you can export it any time before then.
              </p>
              <button onClick={doExport} className="btn-ghost mt-3">
                {exported ? <Check className="h-4 w-4 text-emerald-400" /> : <Download className="h-4 w-4" />}
                {exported ? 'Export downloaded' : 'Export my data'}
              </button>
            </div>
            <div className="rounded-xl border border-primary/20 bg-primary/[0.05] p-4">
              <p className="text-sm text-primary-200">
                When you're ready to come back, your practice intelligence will still be here.
              </p>
            </div>
          </div>

          <button onClick={onClose} className="btn-primary mt-7 w-full">Close</button>
        </div>
      </Shell>
    )
  }

  return null
}
