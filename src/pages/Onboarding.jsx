import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  UserCircle,
  Building2,
  CreditCard,
  ShieldCheck,
  MessageSquare,
  UserPlus,
  Check,
  Loader2,
  ArrowRight,
  CheckCircle2,
  Lock,
  Mail,
} from 'lucide-react'
import Logo from '../components/Logo'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { createCheckout } from '../lib/billing'
import PhoneSetupWizard from '../components/PhoneSetupWizard'
import { REF_STORAGE_KEY } from '../components/ReferralRedirect'

const HEARD_FROM_OPTIONS = ['Referral', 'Instagram', 'Facebook', 'Google', 'Podcast', 'Other']

function parsePlanAmount(searchParams) {
  const raw = Number(searchParams.get('plan'))
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 997
}
function splitContactName(full) {
  const parts = (full || '').trim().split(/\s+/)
  return { doctor_first: parts[0] || '', doctor_last: parts.slice(1).join(' ') || '' }
}

// Steps are intentionally NOT labeled "Step 1 of 5" anywhere — the sidebar just
// lists the named stages with quiet completion ticks (Asana/ClickUp feel). Each
// stage saves independently so a practice can leave and resume any time.
const STEPS = [
  { key: 'account', label: 'Create your account', icon: UserCircle, blurb: 'A few details to get started.' },
  { key: 'profile', label: 'Practice details', icon: Building2, blurb: 'Tell us about your practice.' },
  { key: 'payment', label: 'Activate your plan', icon: CreditCard, blurb: 'Start your subscription.' },
  { key: 'baa', label: 'Sign the BAA', icon: ShieldCheck, blurb: 'HIPAA business associate agreement.' },
  { key: 'a2p', label: 'Carrier registration', icon: MessageSquare, blurb: 'Get SMS approved fast.' },
  { key: 'team', label: 'Invite your team', icon: UserPlus, blurb: 'Bring in your coordinators.' },
]

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
  const [saving, setSaving] = useState(false)
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

  const [form, setForm] = useState({ name: '', doctor_first: '', doctor_last: '', phone: '', address: '' })
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
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('member')
  const [inviting, setInviting] = useState(false)
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
      profile: Boolean((p.name || '').trim() && (p.phone || '').trim()),
      payment: p.subscription_status === 'active',
      baa: Boolean(p.baa_accepted_at),
      a2p: Boolean(p.a2p_submitted_at) || (p.a2p_brand_status && p.a2p_brand_status !== 'unregistered') || Boolean(p.twilio_phone_e164 || p.twilio_phone_number),
      team: Boolean(p.onboarding_completed) || invited.length > 0,
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

  async function persistStep(idx) {
    if (!practiceId) return
    await supabase.from('practices').update({ onboarding_step: idx }).eq('id', practiceId).then(() => {}, () => {})
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
    setSaving(true); setSaveError('')
    const { error } = await supabase.from('practices').update(patch).eq('id', practiceId)
    setSaving(false)
    if (error) { setSaveError(error.message || 'Could not save. Please try again.'); return false }
    if (refresh) await refreshProfile()
    return true
  }

  async function createAccount(e) {
    e?.preventDefault?.()
    setSaveError('')
    setSaving(true)
    const { data, error: signUpError } = await signUp(acct.email, acct.password, { practice_name: acct.practiceName })
    if (signUpError) { setSaving(false); setSaveError(signUpError.message); return }
    if (!data.session || !data.user) {
      setSaving(false)
      setSaveError('Please confirm your email, then sign in to continue. (Email confirmation is enabled on this project.)')
      return
    }
    const { doctor_first, doctor_last } = splitContactName(acct.contactName)
    const { data: created, error: practiceError } = await supabase
      .from('practices')
      .insert({
        name: acct.practiceName,
        email: acct.email,
        phone: acct.phone,
        doctor_first,
        doctor_last,
        heard_from: acct.heardFrom || null,
        plan_amount: planAmount,
        ...(refCode ? { referred_by_code: refCode } : {}),
        ...(referrer?.practice_id ? { referred_by_practice_id: referrer.practice_id } : {}),
      })
      .select('id')
      .single()
    if (practiceError) { setSaving(false); setSaveError(practiceError.message || 'Could not create your practice.'); return }
    try { localStorage.removeItem(REF_STORAGE_KEY) } catch { /* noop */ }
    const { error: linkError } = await supabase.from('users').update({ practice_id: created.id }).eq('id', data.user.id)
    if (linkError) { setSaving(false); setSaveError(linkError.message || 'Practice created but could not link it to your account.'); return }
    if (parentPracticeId) {
      try {
        await supabase.functions.invoke('link-location', { body: { parent_practice_id: parentPracticeId, new_practice_id: created.id } })
      } catch { /* non-blocking */ }
    }
    await refreshProfile()
    setSaving(false)
    // Move into the protected onboarding route; the stepper continues at "Practice details".
    setActive(1)
    navigate('/onboarding', { replace: true })
  }

  async function saveProfile() {
    const ok = await savePatch({ name: form.name, doctor_first: form.doctor_first, doctor_last: form.doctor_last, phone: form.phone, address: form.address })
    if (ok) nextStep()
  }

  async function startCheckout() {
    setSaving(true); setSaveError('')
    try {
      const { url } = await createCheckout({
        practiceId,
        email: practice?.email,
        planAmount: practice?.plan_amount,
        redirectPath: '/onboarding?success=true',
      })
      window.location.href = url
    } catch (e) {
      setSaveError(e?.message || 'Could not start checkout. Please try again.')
      setSaving(false)
    }
  }

  async function acceptBaa() {
    if (!baaAgree) return
    const ok = await savePatch({ baa_accepted_at: new Date().toISOString() })
    if (ok) nextStep()
  }

  async function sendInvite() {
    const email = inviteEmail.trim()
    if (!email) return
    setInviting(true)
    try {
      await supabase.functions.invoke('invite-team-member', {
        body: {
          practice_id: practiceId,
          email,
          role: inviteRole,
          access_level: inviteRole === 'admin' ? 'practice_admin' : 'practice_member',
          app_origin: window.location.origin,
        },
      })
    } catch { /* treat as queued */ }
    setInvited((prev) => [...prev, email])
    setInviteEmail('')
    setInviting(false)
  }

  async function finish() {
    const ok = await savePatch({ onboarding_completed: true })
    if (ok) navigate('/', { replace: true })
  }

  const stepKey = STEPS[active].key
  const planPrice = Number(practice?.plan_amount) > 0 ? Number(practice.plan_amount) : 997

  return (
    <div className="flex min-h-screen flex-col bg-surface lg:flex-row">
      {/* ── Sidebar: brand + stage list (no "step N of 5" anywhere) ─────────── */}
      <aside className="shrink-0 border-b border-surface-700 bg-surface-900 px-6 py-6 lg:w-80 lg:border-b-0 lg:border-r lg:py-8">
        <Logo />
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
                  <Field label="Password"><input className="input" type="password" required minLength={6} value={acct.password} onChange={setA('password')} placeholder="At least 6 characters" /></Field>
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

          {/* 2. Practice details */}
          {stepKey === 'profile' && (
            <section>
              <h1 className="text-2xl font-bold tracking-tight text-white">Tell us about your practice</h1>
              <p className="mt-1.5 text-sm text-slate-400">This personalizes the follow-ups your patients receive.</p>
              <form
                className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2"
                onSubmit={(e) => { e.preventDefault(); if (!saving && form.name.trim()) saveProfile() }}
              >
                <div className="sm:col-span-2">
                  <Field label="Practice name"><input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Pinnacle Dental" /></Field>
                </div>
                <Field label="Doctor first name"><input className="input" value={form.doctor_first} onChange={(e) => set('doctor_first', e.target.value)} /></Field>
                <Field label="Doctor last name"><input className="input" value={form.doctor_last} onChange={(e) => set('doctor_last', e.target.value)} /></Field>
                <Field label="Office phone"><input className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="(480) 555-0142" /></Field>
                <div className="sm:col-span-2">
                  <Field label="Address"><input className="input" value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="123 Main St, Phoenix, AZ 85001" /></Field>
                </div>
                <div className="sm:col-span-2 mt-2 flex justify-end">
                  <button type="submit" disabled={saving || !form.name.trim()} className="btn-primary">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save &amp; continue <ArrowRight className="h-4 w-4" />
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

          {/* 4. A2P / carrier registration — reuse the working phone+A2P wizard */}
          {stepKey === 'a2p' && (
            <section>
              <h1 className="text-2xl font-bold tracking-tight text-white">Get your texting approved</h1>
              <p className="mt-1.5 text-sm text-slate-400">Carriers require a quick one-time registration before SMS can send. Doing it now means it’s approved by the time you’re recording consults.</p>
              <div className="mt-6">
                <PhoneSetupWizard practiceId={practiceId} practiceName={practice?.name} embedded onComplete={() => refreshProfile()} />
              </div>
              <div className="mt-6 flex justify-end">
                <button onClick={nextStep} className="btn-ghost">Continue <ArrowRight className="h-4 w-4" /></button>
              </div>
            </section>
          )}

          {/* 5. Invite team */}
          {stepKey === 'team' && (
            <section>
              <h1 className="text-2xl font-bold tracking-tight text-white">Invite your team</h1>
              <p className="mt-1.5 text-sm text-slate-400">Add your treatment coordinators and front desk. They’ll get an email to join your account.</p>

              <div className="mt-6 flex flex-col gap-2 sm:flex-row">
                <input className="input flex-1" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="teammate@yourpractice.com" />
                <select className="input sm:w-36" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                  <option value="member">Team member</option>
                  <option value="admin">Admin</option>
                </select>
                <button onClick={sendInvite} disabled={inviting || !inviteEmail.trim()} className="btn-primary shrink-0">
                  {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Send invite
                </button>
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

              <div className="mt-8 flex items-center justify-between">
                <span className="text-xs text-slate-500">{invited.length ? `${invited.length} invite${invited.length === 1 ? '' : 's'} sent` : 'You can always invite people later in Settings.'}</span>
                <button onClick={finish} disabled={saving} className="btn-primary">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Finish setup
                </button>
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  )
}
