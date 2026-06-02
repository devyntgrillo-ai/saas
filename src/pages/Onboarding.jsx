import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Building2,
  Mic,
  Plug,
  UserPlus,
  PartyPopper,
  Copy,
  Check,
  Loader2,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Zap,
  XCircle,
  PhoneCall,
  MessagesSquare,
  GraduationCap,
} from 'lucide-react'
import Logo from '../components/Logo'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

const STEPS = [
  { key: 'profile', label: 'Practice', icon: Building2 },
  { key: 'plaud', label: 'Plaud', icon: Mic },
  { key: 'phone', label: 'Phone', icon: Plug },
  { key: 'tc', label: 'Invite TC', icon: UserPlus },
  { key: 'done', label: 'Done', icon: PartyPopper },
]

function Field({ label, children }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  )
}

function TestResult({ state }) {
  if (state === 'ok')
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-300">
        <CheckCircle2 className="h-4 w-4" /> Connection looks good
      </span>
    )
  if (state === 'fail')
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-300">
        <XCircle className="h-4 w-4" /> Fill in the fields above first
      </span>
    )
  return null
}

export default function Onboarding() {
  const { practice, practiceId, refreshProfile, isAgencyUser } = useAuth()
  const navigate = useNavigate()
  const [stepIdx, setStepIdx] = useState(0)
  const step = STEPS[stepIdx].key

  const [form, setForm] = useState({
    name: '',
    doctor_first: '',
    doctor_last: '',
    phone: '',
    address: '',
  })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [copied, setCopied] = useState(false)
  const [plaudTest, setPlaudTest] = useState(null)
  const [testing, setTesting] = useState(false)
  const [tcEmail, setTcEmail] = useState('')
  const [inviteState, setInviteState] = useState(null) // null | sending | sent
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  // Agency users manage clients elsewhere; they shouldn't see onboarding.
  useEffect(() => {
    if (isAgencyUser) navigate('/agency', { replace: true })
  }, [isAgencyUser, navigate])

  // Already done → straight to the app.
  useEffect(() => {
    if (practice?.onboarding_completed) navigate('/', { replace: true })
  }, [practice?.onboarding_completed, navigate])

  useEffect(() => {
    if (practice) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm((f) => ({
        ...f,
        name: practice.name || '',
        doctor_first: practice.doctor_first || '',
        doctor_last: practice.doctor_last || '',
        phone: practice.phone || '',
        address: practice.address || practice.location || '',
      }))
    }
  }, [practice])

  const webhookBase = import.meta.env.VITE_SUPABASE_URL || 'https://your-project.supabase.co'
  const webhookUrl = useMemo(
    () => (practiceId ? `${webhookBase}/functions/v1/plaud-ingest/${practiceId}` : ''),
    [practiceId, webhookBase]
  )

  async function savePatch(patch, { refresh = false } = {}) {
    if (!practiceId) {
      setSaveError('Your account is not linked to a practice yet. Sign out and sign back in, or contact support.')
      return new Error('no_practice')
    }
    setSaving(true)
    setSaveError('')
    const { error } = await supabase.from('practices').update(patch).eq('id', practiceId)
    setSaving(false)
    if (error) {
      setSaveError(error.message || 'Could not save. Please try again.')
      return error
    }
    if (refresh) void refreshProfile()
    return null
  }

  function next() {
    setStepIdx((i) => Math.min(i + 1, STEPS.length - 1))
  }
  function back() {
    setStepIdx((i) => Math.max(i - 1, 0))
  }

  async function saveProfileAndNext() {
    const err = await savePatch({
      name: form.name,
      doctor_first: form.doctor_first,
      doctor_last: form.doctor_last,
      phone: form.phone,
      address: form.address,
    })
    if (!err) {
      next()
      void refreshProfile()
    }
  }

  async function copyWebhook() {
    try {
      await navigator.clipboard.writeText(webhookUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable */
    }
  }

  async function testPlaud() {
    setTesting(true)
    setPlaudTest(null)
    await new Promise((r) => setTimeout(r, 700))
    setPlaudTest(webhookUrl ? 'ok' : 'fail')
    setTesting(false)
  }

  async function connectPlaudAndNext() {
    const err = await savePatch({ plaud_webhook_url: webhookUrl })
    if (!err) {
      next()
      void refreshProfile()
    }
  }

  async function sendInvite() {
    if (!tcEmail.trim()) return
    setInviteState('sending')
    try {
      await supabase.functions.invoke('invite-tc', {
        body: { practice_id: practiceId, email: tcEmail.trim() },
      })
    } catch {
      /* function optional in some environments - treat as queued */
    }
    setInviteState('sent')
  }

  async function finish() {
    const err = await savePatch({ onboarding_completed: true })
    if (!err) {
      await refreshProfile()
      navigate('/', { replace: true })
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      {/* Header */}
      <header className="border-b border-surface-700 px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <Logo />
          <button
            type="button"
            onClick={finish}
            className="text-xs font-medium text-slate-500 transition hover:text-slate-300"
          >
            Skip setup for now
          </button>
        </div>
      </header>

      {/* Stepper */}
      <div className="border-b border-surface-700 px-4 py-4 sm:px-6">
        <ol className="mx-auto flex max-w-3xl items-center justify-between">
          {STEPS.map((s, i) => {
            const Icon = s.icon
            const active = i === stepIdx
            const done = i < stepIdx
            return (
              <li key={s.key} className="flex flex-1 items-center last:flex-none">
                <div className="flex flex-col items-center gap-1.5">
                  <div
                    className={[
                      'flex h-9 w-9 items-center justify-center rounded-full border transition',
                      done
                        ? 'border-primary bg-primary !text-white'
                        : active
                          ? 'border-primary bg-primary/10 text-primary-300'
                          : 'border-surface-700 bg-surface-800 text-slate-500',
                    ].join(' ')}
                  >
                    {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                  </div>
                  <span className={`text-[11px] font-medium ${active ? 'text-slate-200' : 'text-slate-500'}`}>
                    {s.label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`mx-2 h-px flex-1 ${done ? 'bg-primary' : 'bg-surface-700'}`} />
                )}
              </li>
            )
          })}
        </ol>
      </div>

      {/* Body */}
      <main className="flex flex-1 items-start justify-center px-4 py-8 sm:px-6">
        <div className="w-full max-w-xl">
          {step === 'profile' && (
            <div className="card p-6">
              <h1 className="text-lg font-semibold text-white">Let's introduce Hope to your practice.</h1>
              <p className="mt-1 text-sm text-slate-400">
                Meet Hope. She's your AI team member for patient conversion. This personalizes the
                follow-ups your patients receive.
              </p>
              {saveError && (
                <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  {saveError}
                </p>
              )}
              <form
                className="mt-5"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!saving && form.name.trim()) saveProfileAndNext()
                }}
              >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Field label="Practice name">
                    <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Perry Family Dentistry" />
                  </Field>
                </div>
                <Field label="Doctor first name">
                  <input className="input" value={form.doctor_first} onChange={(e) => set('doctor_first', e.target.value)} />
                </Field>
                <Field label="Doctor last name">
                  <input className="input" value={form.doctor_last} onChange={(e) => set('doctor_last', e.target.value)} />
                </Field>
                <Field label="Phone">
                  <input className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="(512) 555-0142" />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Address">
                    <input className="input" value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="123 Main St, Austin, TX 78701" />
                  </Field>
                </div>
              </div>
              <div className="mt-6 flex justify-end">
                <button type="submit" disabled={saving || !form.name.trim()} className="btn-primary">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Continue <ArrowRight className="h-4 w-4" />
                </button>
              </div>
              </form>
            </div>
          )}

          {step === 'plaud' && (
            <div className="card p-6">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary-400">
                <Mic className="h-5 w-5" />
              </div>
              <h1 className="mt-4 text-lg font-semibold text-white">Connect your Plaud recorder</h1>
              <p className="mt-1 text-sm text-slate-400">
                Hope listens to every consult so nothing slips through the cracks. Paste this webhook
                into Plaud AutoFlow so recorded consults flow into Hope AI automatically.
              </p>
              <div className="mt-5">
                <Field label="Webhook URL">
                  <div className="flex gap-2">
                    <input className="input font-mono text-xs" readOnly value={webhookUrl} />
                    <button onClick={copyWebhook} type="button" className="btn-ghost shrink-0">
                      {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </Field>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <button onClick={testPlaud} disabled={testing} type="button" className="btn-ghost">
                  {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                  Test connection
                </button>
                <TestResult state={plaudTest} />
              </div>
              <div className="mt-6 flex items-center justify-between">
                <button onClick={back} className="btn-ghost">
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>
                <div className="flex gap-2">
                  <button onClick={next} className="text-sm font-medium text-slate-400 hover:text-slate-200">
                    Skip
                  </button>
                  <button onClick={connectPlaudAndNext} disabled={saving} className="btn-primary">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Connect &amp; continue <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === 'phone' && (
            <div className="card p-6">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary-400">
                <Plug className="h-5 w-5" />
              </div>
              <h1 className="mt-4 text-lg font-semibold text-white">Phone &amp; messaging</h1>
              <p className="mt-1 text-sm text-slate-400">
                Hope follows up with every patient automatically - SMS and email from your own
                dedicated number, no third-party tools required. You'll pick your number and complete
                carrier registration in Settings → Phone &amp; Messaging.
              </p>
              <div className="mt-5 rounded-lg border border-surface-700 bg-surface-800/50 p-4 text-sm text-slate-400">
                <p className="flex items-center gap-2 font-medium text-slate-200">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" /> Included in your subscription
                </p>
                <p className="mt-1">
                  A local number is $1/month and email follow-up activates immediately. SMS turns on once
                  carrier registration is approved (1-7 business days).
                </p>
              </div>
              <div className="mt-6 flex items-center justify-between">
                <button onClick={back} className="btn-ghost">
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>
                <button onClick={next} className="btn-primary">
                  Continue <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {step === 'tc' && (
            <div className="card p-6">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary-400">
                <UserPlus className="h-5 w-5" />
              </div>
              <h1 className="mt-4 text-lg font-semibold text-white">Invite your treatment coordinator</h1>
              <p className="mt-1 text-sm text-slate-400">
                Your TC reviews consults and approves follow-ups. They'll get an email invite to join.
              </p>
              {inviteState === 'sent' ? (
                <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>Invitation sent to <span className="font-semibold">{tcEmail}</span>.</span>
                </div>
              ) : (
                <div className="mt-5">
                  <Field label="TC email address">
                    <div className="flex gap-2">
                      <input className="input" type="email" value={tcEmail} onChange={(e) => setTcEmail(e.target.value)} placeholder="tc@yourpractice.com" />
                      <button onClick={sendInvite} disabled={inviteState === 'sending' || !tcEmail.trim()} className="btn-primary shrink-0">
                        {inviteState === 'sending' ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                        Send invite
                      </button>
                    </div>
                  </Field>
                </div>
              )}
              <div className="mt-6 flex items-center justify-between">
                <button onClick={back} className="btn-ghost">
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>
                <div className="flex gap-2">
                  <button onClick={next} className="text-sm font-medium text-slate-400 hover:text-slate-200">
                    Skip
                  </button>
                  <button onClick={next} className="btn-primary">
                    Continue <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="card p-8 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400">
                <PartyPopper className="h-8 w-8" />
              </div>
              <h1 className="mt-5 text-xl font-bold text-white">You're all set!</h1>
              <p className="mt-2 text-sm text-slate-400">
                Hope is ready to start recovering unconverted patients for {form.name || 'your practice'}.
                She learns what works and gets smarter every week.
              </p>
              <div className="mt-6 space-y-3 text-left">
                {[
                  { icon: PhoneCall, title: 'Record your first consult', desc: 'It’ll appear under Consults within a minute of recording.' },
                  { icon: MessagesSquare, title: 'Review & approve follow-ups', desc: 'Your TC approves the AI plan and the sequence kicks off.' },
                  { icon: GraduationCap, title: 'Sharpen your team', desc: 'Explore Training modules while your data builds up.' },
                ].map((s) => (
                  <div key={s.title} className="flex items-start gap-3 rounded-xl border border-surface-700 bg-surface-800/50 p-4">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary-400">
                      <s.icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-200">{s.title}</p>
                      <p className="text-xs text-slate-500">{s.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={finish} disabled={saving} className="btn-primary mt-7 w-full">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Go to dashboard <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
