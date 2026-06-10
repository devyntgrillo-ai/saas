import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  UserCircle,
  Building2,
  CreditCard,
  ShieldCheck,
  UserPlus,
  Check,
  Loader2,
  ArrowRight,
  CheckCircle2,
  Lock,
  Mail,
  Play,
  Mic,
  Sparkles,
} from 'lucide-react'
import Logo from '../components/Logo'
import PasswordField from '../components/PasswordField'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { validatePassword } from '../lib/passwordPolicy'
import { recordBaaAcceptance } from '../lib/baa'
import {
  useSaveOnboardingPatch,
  usePersistOnboardingStep,
  useCreateOnboardingAccount,
  useOnboardingTeamInvite,
  useStartCheckout,
} from '../lib/queries'
import { REF_STORAGE_KEY } from '../components/ReferralRedirect'

const HEARD_FROM_OPTIONS = ['Referral', 'Instagram', 'Facebook', 'Google', 'Podcast', 'Other']

function parsePlanAmount(searchParams) {
  const raw = Number(searchParams.get('plan'))
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 997
}
// Steps are intentionally NOT labeled "Step 1 of 5" anywhere — the sidebar just
// lists the named stages with quiet completion ticks (Asana/ClickUp feel). Each
// stage saves independently so a practice can leave and resume any time.
// Public signup handles account + payment; the in-app onboarding starts at the
// BAA (required) and then the streamlined Welcome → Invite → Demo steps.
const STEPS = [
  { key: 'account', label: 'Create your account', icon: UserCircle, blurb: 'A few details to get started.' },
  { key: 'payment', label: 'Activate your plan', icon: CreditCard, blurb: 'Start your subscription.' },
  { key: 'baa', label: 'Sign the BAA', icon: ShieldCheck, blurb: 'HIPAA business associate agreement.' },
  { key: 'welcome', label: 'Welcome', icon: Building2, blurb: 'A couple quick details.' },
  { key: 'invite', label: 'Invite your team', icon: UserPlus, blurb: 'Who will record consults?' },
  { key: 'demo', label: 'See how it works', icon: Play, blurb: 'A quick walkthrough.' },
]

const CONSULTS_PER_WEEK = ['1-2', '3-5', '6-10', '10+']
const INVITE_ROLES = ['Owner/Doctor', 'Front Desk', 'Office Manager', 'Other']

function Field({ label, children }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  )
}

export default function Onboarding() {
  const { signUp, practice, practiceId, refreshProfile, isAgencyUser } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [active, setActive] = useState(0)
  const [seeded, setSeeded] = useState(false)
  const savePatchMutation = useSaveOnboardingPatch()
  const persistStepMutation = usePersistOnboardingStep()
  const createAccountMutation = useCreateOnboardingAccount()
  const teamInviteMutation = useOnboardingTeamInvite()
  const checkoutMutation = useStartCheckout()
  const saving = savePatchMutation.isPending || createAccountMutation.isPending || checkoutMutation.isPending
  const [saveError, setSaveError] = useState('')

  // Step 1 (pre-auth): create the account. Carries referral / multi-location /
  // plan context from the URL, mirroring the old standalone signup page.
  const planAmount = useMemo(() => parsePlanAmount(searchParams), [searchParams])
  const parentPracticeId = useMemo(() => (searchParams.get('parent_practice') || '').trim(), [searchParams])
  const [refCode] = useState(() => {
    let stored = ''
    try { stored = localStorage.getItem(REF_STORAGE_KEY) || '' } catch { /* storage unavailable */ }
    return (searchParams.get('ref') || stored || '').trim()
  })
  const [referrer, setReferrer] = useState(null)
  const [acct, setAcct] = useState({ practiceName: '', phone: '', contactName: '', email: '', password: '', heardFrom: '' })
  const setA = (k) => (e) => setAcct((f) => ({ ...f, [k]: e.target.value }))

  const [form, setForm] = useState({ name: '', doctor_first: '', doctor_last: '', phone: '', address: '', consults_per_week: '' })
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  useEffect(() => {
    if (!refCode) return
    let on = true
    supabase.rpc('resolve_referral_code', { p_code: refCode }).then(({ data }) => {
      if (on && Array.isArray(data) && data[0]) setReferrer(data[0])
    }, () => {})
    return () => { on = false }
  }, [refCode])

  const [baaAgree, setBaaAgree] = useState(false)
  const [inviteName, setInviteName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState(INVITE_ROLES[0])
  const [invited, setInvited] = useState([])

  // Agency users manage clients elsewhere — they never see practice onboarding.
  useEffect(() => {
    if (isAgencyUser) navigate('/agency', { replace: true })
  }, [isAgencyUser, navigate])

  // Per-step completion, derived from the practice's own data so it stays correct
  // across reloads and the Chargebee redirect round-trip.
  const done = useMemo(() => {
    const p = practice || {}
    return {
      account: Boolean(practiceId),
      payment: p.subscription_status === 'active',
      baa: Boolean(p.baa_accepted_at),
      welcome: Boolean((p.name || '').trim() && p.consults_per_week),
      invite: Boolean(p.onboarding_completed) || invited.length > 0,
      demo: Boolean(p.onboarding_completed),
    }
  }, [practice, practiceId, invited.length])
  const doneList = STEPS.map((s) => done[s.key])

  // Seed the form + open the right step once the practice loads. Prefer the
  // saved onboarding_step; otherwise the first incomplete step. Returning from
  // Chargebee (?success) refreshes and lands on payment.
  useEffect(() => {
    if (!practice || seeded) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm({
      name: practice.name || '',
      doctor_first: practice.doctor_first || '',
      doctor_last: practice.doctor_last || '',
      phone: practice.phone || '',
      address: practice.address || practice.location || '',
      consults_per_week: practice.consults_per_week || '',
    })
    const firstIncomplete = STEPS.findIndex((s) => !done[s.key])
    const fromUrl = searchParams.get('step')
    const initial = searchParams.get('success')
      ? 1
      : fromUrl != null
        ? Math.max(0, Math.min(STEPS.length - 1, Number(fromUrl)))
        : typeof practice.onboarding_step === 'number' && practice.onboarding_step > 0
          ? Math.min(practice.onboarding_step, STEPS.length - 1)
          : firstIncomplete === -1 ? STEPS.length - 1 : firstIncomplete
    setActive(initial)
    setSeeded(true)
    if (searchParams.get('success')) { void refreshProfile() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [practice, seeded])

  function persistStep(idx) {
    if (!practiceId) return
    persistStepMutation.mutate({ practiceId, step: idx })
  }

  function goTo(idx) {
    // Can't jump past account creation until the account exists.
    if (!practiceId && idx > 0) return
    setActive(idx)
    setSaveError('')
    void persistStep(idx)
    try { setSearchParams({}, { replace: true }) } catch { /* noop */ }
  }
  function nextStep() { goTo(Math.min(active + 1, STEPS.length - 1)) }

  async function savePatch(patch, { refresh = true } = {}) {
    if (!practiceId) { setSaveError('Your account is not linked to a practice yet. Sign out and back in, or contact support.'); return false }
    setSaveError('')
    try {
      await savePatchMutation.mutateAsync({ practiceId, patch })
      if (refresh) await refreshProfile()
      return true
    } catch (e) {
      setSaveError(e?.message || 'Could not save. Please try again.')
      return false
    }
  }

  async function createAccount(e) {
    e?.preventDefault?.()
    setSaveError('')
    // Enforce the HIPAA password policy before creating the account.
    const pwCheck = validatePassword(acct.password)
    if (!pwCheck.valid) { setSaveError(pwCheck.errors[0]); return }
    try {
      await createAccountMutation.mutateAsync({
        signUp,
        email: acct.email,
        password: acct.password,
        practiceName: acct.practiceName,
        phone: acct.phone,
        contactName: acct.contactName,
        heardFrom: acct.heardFrom,
        planAmount,
        refCode,
        referrerPracticeId: referrer?.practice_id,
        parentPracticeId,
      })
      try { localStorage.removeItem(REF_STORAGE_KEY) } catch { /* noop */ }
      await refreshProfile()
      setActive(1)
      navigate('/onboarding', { replace: true })
    } catch (e) {
      setSaveError(e?.message || 'Could not create your account.')
    }
  }

  async function saveWelcome() {
    const ok = await savePatch({ name: form.name, doctor_first: form.doctor_first, consults_per_week: form.consults_per_week || null })
    if (ok) nextStep()
  }

  async function startCheckout() {
    setSaveError('')
    try {
      const { url } = await checkoutMutation.mutateAsync({
        practiceId,
        email: practice?.email,
        planAmount: practice?.plan_amount,
        redirectPath: '/onboarding?success=true',
      })
      window.location.href = url
    } catch (e) {
      setSaveError(e?.message || 'Could not start checkout. Please try again.')
    }
  }

  async function acceptBaa() {
    if (!baaAgree) return
    const ok = await recordBaaAcceptance(practiceId)
    if (ok) nextStep()
  }

  async function sendInvite() {
    const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
    const email = inviteEmail.trim().toLowerCase()
    if (!isEmail(email)) { setSaveError('Enter a valid email address.'); return }
    setSaveError('')
    try {
      // All onboarding invitees are recorders/team members (access role 'member');
      // the role dropdown captures their job for context, not access level.
      await teamInviteMutation.mutateAsync({ practiceId, email, role: 'member', name: inviteName.trim() || undefined })
    } catch { /* treat as queued */ }
    setInvited((prev) => [...new Set([...prev, email])])
    setInviteName(''); setInviteEmail('')
    nextStep() // → demo
  }

  async function finish({ record = false } = {}) {
    const ok = await savePatch({ onboarding_completed: true })
    if (ok) navigate(record ? '/?record=1' : '/', { replace: true })
  }

  const stepKey = STEPS[active].key
  const planPrice = Number(practice?.plan_amount) > 0 ? Number(practice.plan_amount) : 997

  return (
    <div className="flex min-h-screen flex-col bg-surface lg:flex-row">
      {/* ── Sidebar: brand + stage list (no "step N of 5" anywhere) ─────────── */}
      <aside className="shrink-0 border-b border-surface-700 bg-surface-900 px-6 py-6 lg:w-80 lg:border-b-0 lg:border-r lg:py-8">
        {/* Onboarding (incl. activate-plan + BAA) is always CaseLift-branded. */}
        <Logo forceDefault />
        <p className="mt-6 hidden text-sm font-medium text-slate-300 lg:block">Welcome to CaseLift</p>
        <p className="mt-0.5 hidden text-xs text-slate-500 lg:block">Let’s get your practice set up. You can leave and pick up right where you left off.</p>

        <ol className="mt-6 space-y-1">
          {STEPS.map((s, i) => {
            const Icon = s.icon
            const isActive = i === active
            const isDone = doneList[i]
            const locked = !practiceId && i > 0
            return (
              <li key={s.key}>
                <button
                  type="button"
                  onClick={() => goTo(i)}
                  disabled={locked}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                    locked ? 'cursor-not-allowed opacity-50' : isActive ? 'bg-surface-800' : 'hover:bg-surface-800/60'
                  }`}
                >
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs transition ${
                      isDone
                        ? 'border-emerald-500 bg-emerald-500 !text-white'
                        : isActive
                          ? 'border-primary bg-primary/15 text-primary-300'
                          : 'border-surface-600 bg-surface-800 text-slate-500'
                    }`}
                  >
                    {isDone ? <Check className="h-3.5 w-3.5" /> : locked ? <Lock className="h-3 w-3" /> : <Icon className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0">
                    <span className={`block truncate text-sm font-medium ${isActive || isDone ? 'text-slate-100' : 'text-slate-400'}`}>{s.label}</span>
                    <span className="block truncate text-[11px] text-slate-500">{isDone ? 'Completed' : s.blurb}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>

        {practiceId && (
          <button
            type="button"
            onClick={() => navigate('/', { replace: true })}
            className="mt-6 text-xs font-medium text-slate-500 transition hover:text-slate-300"
          >
            I’ll finish later
          </button>
        )}
      </aside>

      {/* ── Content panel ──────────────────────────────────────────────────── */}
      <main className="flex flex-1 items-start justify-center px-4 py-8 sm:px-8 lg:py-14">
        <div className="w-full max-w-xl">
          {saveError && (
            <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{saveError}</p>
          )}

          {/* 1. Create account (pre-auth) */}
          {stepKey === 'account' && (
            done.account ? (
              <section>
                <h1 className="text-2xl font-bold tracking-tight text-white">Account created</h1>
                <p className="mt-1.5 text-sm text-slate-400">You’re signed in. Continue setting up your practice.</p>
                <div className="mt-6 flex justify-end">
                  <button onClick={nextStep} className="btn-primary">Continue <ArrowRight className="h-4 w-4" /></button>
                </div>
              </section>
            ) : (
              <section>
                <h1 className="text-2xl font-bold tracking-tight text-white">Create your account</h1>
                <p className="mt-1.5 text-sm text-slate-400">Just a few details to get started. You can finish the rest of setup any time.</p>
                {referrer?.name && (
                  <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                    {referrer.name} referred you to CaseLift. Welcome!
                  </div>
                )}
                <form className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={createAccount}>
                  <div className="sm:col-span-2">
                    <Field label="Practice name"><input className="input" required value={acct.practiceName} onChange={setA('practiceName')} placeholder="Pinnacle Dental" /></Field>
                  </div>
                  <Field label="Your name"><input className="input" required value={acct.contactName} onChange={setA('contactName')} placeholder="Dr. Jordan Rivera" /></Field>
                  <Field label="Office phone"><input className="input" value={acct.phone} onChange={setA('phone')} placeholder="(480) 555-0142" /></Field>
                  <Field label="Work email"><input className="input" type="email" required value={acct.email} onChange={setA('email')} placeholder="you@yourpractice.com" /></Field>
                  <PasswordField id="password" value={acct.password} onChange={(v) => setAcct((a) => ({ ...a, password: v }))} />
                  <div className="sm:col-span-2">
                    <Field label="Where did you hear about us?">
                      <select className="input" required value={acct.heardFrom} onChange={setA('heardFrom')}>
                        <option value="" disabled>Select one</option>
                        {HEARD_FROM_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </Field>
                  </div>
                  <div className="sm:col-span-2 mt-2 flex items-center justify-between">
                    <Link to="/login" className="text-sm font-medium text-slate-400 hover:text-slate-200">Already have an account? Log in</Link>
                    <button type="submit" disabled={saving} className="btn-primary">
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Create account <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </form>
              </section>
            )
          )}

          {/* Welcome — only 3 quick things (≈2 min). */}
          {stepKey === 'welcome' && (
            <section>
              <h1 className="text-2xl font-bold tracking-tight text-white">Welcome to CaseLift{form.doctor_first ? `, ${form.doctor_first}` : ''}!</h1>
              <p className="mt-1.5 text-sm text-slate-400">Just confirm a couple details and you’re in.</p>
              <form className="mt-6 space-y-4" onSubmit={(e) => { e.preventDefault(); if (!saving) saveWelcome() }}>
                <Field label="Practice name"><input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Pinnacle Dental" /></Field>
                <Field label="Doctor / owner first name"><input className="input" value={form.doctor_first} onChange={(e) => set('doctor_first', e.target.value)} placeholder="Jordan" /></Field>
                <Field label="How many consults per week, on average?">
                  <select className="input" value={form.consults_per_week} onChange={(e) => set('consults_per_week', e.target.value)}>
                    <option value="" disabled>Select one</option>
                    {CONSULTS_PER_WEEK.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </Field>
                <div className="pt-2">
                  <button type="submit" disabled={saving} className="btn-primary w-full justify-center text-base">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Let’s go <ArrowRight className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={nextStep} className="mt-3 block w-full text-center text-xs font-medium text-slate-500 hover:text-slate-300">
                    You can fill in the rest later
                  </button>
                </div>
              </form>
            </section>
          )}

          {/* 2. Activate plan (payment) */}
          {stepKey === 'payment' && (
            <section>
              <h1 className="text-2xl font-bold tracking-tight text-white">Activate your plan</h1>
              <p className="mt-1.5 text-sm text-slate-400">Your subscription activates your account so CaseLift can start recovering cases.</p>

              {done.payment ? (
                <div className="mt-6 flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-4">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
                  <div>
                    <p className="text-sm font-semibold text-emerald-200">Your plan is active</p>
                    <p className="mt-0.5 text-sm text-emerald-200/80">You’re all set on billing. Continue to the next step.</p>
                  </div>
                </div>
              ) : (
                <div className="mt-6 rounded-2xl border border-surface-700 bg-surface-900 p-6">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-3xl font-bold text-white">${planPrice.toLocaleString()}</span>
                    <span className="text-sm text-slate-400">/month</span>
                  </div>
                  <ul className="mt-4 space-y-2 text-sm text-slate-300">
                    {['AI consult analysis on every recording', 'Automated SMS + email follow-up sequences', 'Your own dedicated phone number', 'Unlimited team members'].map((f) => (
                      <li key={f} className="flex items-center gap-2"><Check className="h-4 w-4 shrink-0 text-emerald-400" /> {f}</li>
                    ))}
                  </ul>
                  <button onClick={startCheckout} disabled={saving} className="btn-primary mt-6 w-full justify-center">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />} Activate — secure checkout
                  </button>
                  <p className="mt-2 text-center text-[11px] text-slate-500">Powered by Chargebee. Cancel anytime.</p>
                </div>
              )}

              <div className="mt-6 flex justify-end">
                <button onClick={nextStep} className="btn-ghost">Continue <ArrowRight className="h-4 w-4" /></button>
              </div>
            </section>
          )}

          {/* 3. BAA */}
          {stepKey === 'baa' && (
            <section>
              <h1 className="text-2xl font-bold tracking-tight text-white">Business Associate Agreement</h1>
              <p className="mt-1.5 text-sm text-slate-400">Required for HIPAA compliance before we handle any patient information.</p>

              {done.baa ? (
                <div className="mt-6 flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-4">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
                  <p className="text-sm font-semibold text-emerald-200">BAA signed. Thank you.</p>
                </div>
              ) : (
                <>
                  <div className="mt-5 max-h-64 overflow-y-auto rounded-xl border border-surface-700 bg-surface-900 p-4 text-xs leading-relaxed text-slate-400">
                    <p className="font-semibold text-slate-200">CaseLift Business Associate Agreement (summary)</p>
                    <p className="mt-2">CaseLift acts as a Business Associate to your practice (the Covered Entity). We will use and disclose Protected Health Information (PHI) only to provide the agreed services, as permitted by this agreement, or as required by law.</p>
                    <p className="mt-2">We implement administrative, physical, and technical safeguards to protect PHI, will report any breach or impermissible use without unreasonable delay, ensure our subcontractors agree to equivalent restrictions, and will return or destroy PHI upon termination where feasible.</p>
                    <p className="mt-2">Your practice agrees to obtain any patient consents required for recording and follow-up communications. This summary is provided for convenience; the full agreement governs.</p>
                    <button type="button" onClick={() => navigate('/baa')} className="mt-3 font-medium text-primary-300 hover:underline">Read the full agreement</button>
                  </div>
                  <label className="mt-4 flex items-start gap-2.5 text-sm text-slate-300">
                    <input type="checkbox" checked={baaAgree} onChange={(e) => setBaaAgree(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-surface-600 bg-surface-800 text-primary focus:ring-primary/40" />
                    I have read and agree to the CaseLift Business Associate Agreement on behalf of my practice.
                  </label>
                  <div className="mt-6 flex justify-end">
                    <button onClick={acceptBaa} disabled={!baaAgree || saving} className="btn-primary">
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Accept &amp; continue
                    </button>
                  </div>
                </>
              )}
            </section>
          )}

          {/* Invite — who will record consultations (skippable) */}
          {stepKey === 'invite' && (
            <section>
              <h1 className="text-2xl font-bold tracking-tight text-white">Who will be recording consultations?</h1>
              <p className="mt-1.5 text-sm text-slate-400">This could be you, a front desk team member, or anyone who sits in on consults.</p>

              <div className="mt-6 space-y-4">
                <Field label="Name"><input className="input" value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="Alex Morgan" /></Field>
                <Field label="Email"><input className="input" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="alex@yourpractice.com" /></Field>
                <Field label="Role">
                  <select className="input" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                    {INVITE_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </Field>
              </div>

              {invited.length > 0 && (
                <ul className="mt-4 space-y-1.5">
                  {invited.map((em) => (
                    <li key={em} className="flex items-center gap-2 rounded-lg border border-surface-700 bg-surface-800/50 px-3 py-2 text-sm text-slate-300">
                      <Mail className="h-4 w-4 text-slate-500" /> {em}
                      <span className="ml-auto inline-flex items-center gap-1 text-xs text-emerald-300"><Check className="h-3.5 w-3.5" /> Invited</span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-8 flex items-center justify-between gap-4">
                <button type="button" onClick={nextStep} className="text-sm font-medium text-slate-400 hover:text-slate-200">
                  Skip — I’ll record myself
                </button>
                <button onClick={sendInvite} disabled={teamInviteMutation.isPending || !inviteEmail.trim()} className="btn-primary">
                  {teamInviteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Send Invite
                </button>
              </div>
            </section>
          )}

          {/* See how it works — a simulated walkthrough (skippable, no live record) */}
          {stepKey === 'demo' && (
            <section>
              <div className="flex items-center gap-2 text-primary-300"><Sparkles className="h-5 w-5" /><span className="text-xs font-semibold uppercase tracking-wide">See CaseLift in action</span></div>
              <h1 className="mt-2 text-2xl font-bold tracking-tight text-white">Watch how a consult becomes a follow-up sequence</h1>
              <p className="mt-1.5 text-sm text-slate-400">Here’s a real example from Pinnacle Dental — how one recorded consultation gets analyzed and turned into a personalized follow-up.</p>

              <ol className="mt-6 space-y-3">
                {[
                  { n: 1, t: 'A consult is recorded', d: '“…I love the idea of the implants, I just need to talk to my husband about the $28,000 before we commit.”', tag: 'Transcript' },
                  { n: 2, t: 'CaseLift analyzes it', d: 'Primary objection: cost / spouse approval. Sentiment: warm. Recommended: financing reassurance + spouse-friendly recap.', tag: 'AI analysis' },
                  { n: 3, t: 'It builds the follow-up sequence', d: 'Day 1 text: financing options · Day 3 email: spouse-friendly treatment recap · Day 7 text: gentle check-in.', tag: 'Sequence' },
                  { n: 4, t: 'The patient replies', d: '“We talked it over — the monthly number works. When can we get on the schedule?”', tag: 'Patient reply' },
                ].map((s) => (
                  <li key={s.n} className="flex gap-3 rounded-2xl border border-surface-700 bg-surface-900 p-4">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary-300">{s.n}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-white">{s.t}</p>
                        <span className="rounded-full bg-surface-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">{s.tag}</span>
                      </div>
                      <p className="mt-1 text-sm text-slate-400">{s.d}</p>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="mt-7 rounded-2xl border border-primary/30 bg-primary/[0.06] p-5 text-center">
                <p className="text-sm font-semibold text-white">Ready to record your first real consult?</p>
                <p className="mt-1 text-xs text-slate-400">No rush — even a couple consults a week is plenty to start recovering cases.</p>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
                  <button onClick={() => finish({ record: true })} disabled={saving} className="btn-primary justify-center">
                    <Mic className="h-4 w-4" /> Record Now
                  </button>
                  <button onClick={() => finish()} disabled={saving} className="btn-ghost justify-center">
                    I’ll do this later — go to dashboard
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  )
}
