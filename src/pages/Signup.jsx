import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2, Gift, Check, CreditCard, ArrowLeft, Building2 } from 'lucide-react'
import Logo from '../components/Logo'
import PasswordField from '../components/PasswordField'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { createCheckout } from '../lib/billing'
import { validatePassword } from '../lib/passwordPolicy'
import { REF_STORAGE_KEY } from '../components/ReferralRedirect'

const HEARD_FROM_OPTIONS = ['Referral', 'Instagram', 'Facebook', 'Google', 'Podcast', 'Other']

// Plan amount comes from ?plan= (e.g. /signup?plan=797). Default 997. The real
// price is validated server-side in create-checkout; this is display only.
function parsePlanAmount(searchParams) {
  const raw = Number(searchParams.get('plan'))
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 997
}

export default function Signup() {
  const { signUp, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [step, setStep] = useState(1)
  const [form, setForm] = useState({
    practiceName: '',
    phone: '',
    contactName: '',
    email: '',
    password: '',
    heardFrom: '',
  })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [practiceId, setPracticeId] = useState(null) // set once the account+practice exist
  const planAmount = useMemo(() => parsePlanAmount(searchParams), [searchParams])

  // "Add another location" funnel: ?parent_practice= links the new location to an
  // existing owner's account so they can switch between locations. ?locations= is
  // how many they intend to add (display only here).
  const parentPracticeId = useMemo(() => (searchParams.get('parent_practice') || '').trim(), [searchParams])
  const locationCount = useMemo(() => {
    const n = Number(searchParams.get('locations'))
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 1
  }, [searchParams])

  // Referral: code comes from ?ref= or localStorage (set by /r/[code]). Resolve
  // it to the referrer so we can welcome them and stamp the new practice.
  const [refCode] = useState(() => {
    let stored = ''
    try {
      stored = localStorage.getItem(REF_STORAGE_KEY) || ''
    } catch {
      /* storage unavailable */
    }
    return (searchParams.get('ref') || stored || '').trim()
  })
  const [referrer, setReferrer] = useState(null)

  useEffect(() => {
    if (!refCode) return
    let active = true
    ;(async () => {
      try {
        const { data } = await supabase.rpc('resolve_referral_code', { p_code: refCode })
        if (active && Array.isArray(data) && data[0]) setReferrer(data[0])
      } catch {
        // referral lookup is best-effort (requires auth; silent if pre-signup)
      }
    })()
    return () => {
      active = false
    }
  }, [refCode])

  function splitContactName(full) {
    const parts = (full || '').trim().split(/\s+/)
    return { doctor_first: parts[0] || '', doctor_last: parts.slice(1).join(' ') || '' }
  }

  // Step 1 → create the auth user + practice, then advance to payment. If the
  // account already exists (user clicked Back then Continue), just move forward.
  async function handleStep1(e) {
    e.preventDefault()
    setError('')

    if (practiceId) {
      setStep(2)
      return
    }

    // Enforce the password policy before hitting the auth API (mirrors the
    // server-side rule in Supabase config). Keeps weak passwords out of HIPAA-
    // scoped accounts.
    const pwCheck = validatePassword(form.password)
    if (!pwCheck.valid) {
      setError(pwCheck.errors[0])
      return
    }

    setLoading(true)
    const { data, error: signUpError } = await signUp(form.email, form.password, {
      practice_name: form.practiceName,
    })
    if (signUpError) {
      setLoading(false)
      setError(signUpError.message)
      return
    }
    // Payment-first funnel needs an active session to start checkout. If email
    // confirmation is on (no session), we can't proceed to hosted checkout here.
    if (!data.session || !data.user) {
      setLoading(false)
      setError(
        'Please confirm your email, then sign in to complete payment. (Email confirmation is enabled on this project.)',
      )
      return
    }

    const { doctor_first, doctor_last } = splitContactName(form.contactName)
    const { data: practice, error: practiceError } = await supabase
      .from('practices')
      .insert({
        name: form.practiceName,
        email: form.email,
        phone: form.phone,
        doctor_first,
        doctor_last,
        pms_type: null,
        heard_from: form.heardFrom || null,
        plan_amount: planAmount,
        ...(refCode ? { referred_by_code: refCode } : {}),
        ...(referrer?.practice_id ? { referred_by_practice_id: referrer.practice_id } : {}),
      })
      .select()
      .single()
    if (practiceError) {
      setLoading(false)
      setError(practiceError.message || 'Could not create your practice.')
      return
    }

    try {
      localStorage.removeItem(REF_STORAGE_KEY)
    } catch {
      /* storage unavailable */
    }

    const { error: linkError } = await supabase
      .from('users')
      .update({ practice_id: practice.id })
      .eq('id', data.user.id)
    if (linkError) {
      setLoading(false)
      setError(linkError.message || 'Practice created but could not link it to your account.')
      return
    }

    // Multi-location: link this new location to the parent owner's account so it
    // shows up in their practice switcher. Runs server-side (service role), RLS
    // blocks a user from self-inserting memberships. Non-fatal if it fails.
    if (parentPracticeId) {
      try {
        await supabase.functions.invoke('link-location', {
          body: { parent_practice_id: parentPracticeId, new_practice_id: practice.id },
        })
      } catch {
        /* non-blocking: they can still be linked later from the parent account */
      }
    }

    await refreshProfile()
    setPracticeId(practice.id)
    setLoading(false)
    // Hand off to the multi-step onboarding (payment, BAA, A2P, invites live there).
    navigate('/onboarding', { replace: true })
  }

  // Step 2 → start hosted checkout. On success, the provider redirects back to
  // /baa (the next gate); the billing webhook flips the practice to active.
  async function handlePayNow() {
    if (!practiceId) return
    setError('')
    setLoading(true)
    try {
      const { url } = await createCheckout({
        practiceId,
        email: form.email,
        planAmount,
        redirectPath: '/baa?welcome=1',
      })
      window.location.href = url
    } catch (e) {
      setError(
        /not configured/i.test(e?.message || '')
          ? 'Online checkout isn’t available yet, please contact support@caselift.io.'
          : e?.message || 'Could not start checkout. Please try again.',
      )
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo forceDefault />
        </div>

        {/* Progress indicator */}
        <div className="mb-6 flex items-center gap-3">
          {[
            { n: 1, label: 'Practice info' },
            { n: 2, label: 'Payment' },
          ].map((s, i) => {
            const active = step === s.n
            const done = step > s.n
            return (
              <div key={s.n} className="flex flex-1 items-center gap-3">
                <div className="flex items-center gap-2">
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1 ring-inset transition ${
                      done
                        ? 'bg-primary text-white ring-primary'
                        : active
                          ? 'bg-primary/15 text-primary-300 ring-primary/40'
                          : 'bg-surface-800 text-slate-500 ring-surface-700'
                    }`}
                  >
                    {done ? <Check className="h-4 w-4" /> : s.n}
                  </span>
                  <span className={`text-sm font-medium ${active || done ? 'text-slate-200' : 'text-slate-500'}`}>
                    Step {s.n}
                  </span>
                </div>
                {i === 0 && <div className={`h-px flex-1 ${step > 1 ? 'bg-primary/50' : 'bg-surface-700'}`} />}
              </div>
            )
          })}
        </div>

        <div className="card p-8">
          {parentPracticeId && step === 1 && (
            <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              <Building2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Adding a new location to your account at the discounted{' '}
                <span className="font-semibold">${planAmount.toLocaleString()}/mo</span> rate
                {locationCount > 1 ? `, set up the first of ${locationCount} locations below.` : '.'}
              </span>
            </div>
          )}

          {referrer && step === 1 && (
            <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary-200">
              <Gift className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                You were referred by <span className="font-semibold">{referrer.practice_name}</span>, welcome to
                CaseLift.
              </span>
            </div>
          )}

          {step === 1 ? (
            <>
              <h1 className="text-2xl font-bold text-white">Create your account</h1>
              <p className="mt-1 text-sm text-slate-400">
                Start recovering unconverted high-value treatment patients.
              </p>

              <form onSubmit={handleStep1} className="mt-6 space-y-4">
                <div>
                  <label className="label" htmlFor="practiceName">Practice name</label>
                  <input id="practiceName" type="text" required className="input"
                    placeholder="Bright Smile Dental" value={form.practiceName} onChange={set('practiceName')} />
                </div>

                <div>
                  <label className="label" htmlFor="phone">Office phone</label>
                  <input id="phone" type="tel" required className="input"
                    placeholder="(555) 123-4567" value={form.phone} onChange={set('phone')} />
                </div>

                <div>
                  <label className="label" htmlFor="contactName">Your name</label>
                  <input id="contactName" type="text" required className="input"
                    placeholder="Dr. Jane Smith" value={form.contactName} onChange={set('contactName')} />
                </div>

                <div>
                  <label className="label" htmlFor="email">Work email</label>
                  <input id="email" type="email" required autoComplete="email" className="input"
                    placeholder="you@practice.com" value={form.email} onChange={set('email')}
                    disabled={Boolean(practiceId)} />
                </div>

                {!practiceId && (
                  <PasswordField
                    id="password"
                    value={form.password}
                    onChange={(v) => setForm((f) => ({ ...f, password: v }))}
                  />
                )}

                <div>
                  <label className="label" htmlFor="heardFrom">Where did you hear about us?</label>
                  <select id="heardFrom" required className="input" value={form.heardFrom} onChange={set('heardFrom')}>
                    <option value="" disabled>Select one</option>
                    {HEARD_FROM_OPTIONS.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>

                {error && (
                  <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
                )}

                <button type="submit" className="btn-primary w-full" disabled={loading}>
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  {loading ? 'Creating account…' : 'Continue to payment'}
                </button>
              </form>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-white">Confirm &amp; pay</h1>
              <p className="mt-1 text-sm text-slate-400">
                You’re activating CaseLift for <span className="text-slate-200">{form.practiceName}</span>.
              </p>

              {/* Order summary */}
              <div className="mt-6 rounded-xl border border-surface-700 bg-surface-800/50 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Order summary</p>
                    <p className="mt-1 text-base font-semibold text-white">CaseLift, Month 1</p>
                    <p className="mt-0.5 text-sm text-slate-400">Billed monthly · cancel anytime</p>
                  </div>
                  <p className="text-2xl font-bold text-white">${planAmount.toLocaleString()}</p>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-surface-700 pt-3 text-sm">
                  <span className="text-slate-400">Due today</span>
                  <span className="font-semibold text-white">${planAmount.toLocaleString()}</span>
                </div>
              </div>

              {error && (
                <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
              )}

              <button onClick={handlePayNow} className="btn-primary mt-6 w-full" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                {loading ? 'Starting secure checkout…' : 'Pay now'}
              </button>
              <button
                type="button"
                onClick={() => { setError(''); setStep(1) }}
                disabled={loading}
                className="mt-3 flex w-full items-center justify-center gap-1.5 text-sm font-medium text-slate-400 transition hover:text-slate-200"
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
              <p className="mt-4 text-center text-xs text-slate-500">
                Secure checkout. You can manage or cancel your subscription anytime from Settings.
              </p>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-sm text-slate-400">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-primary-400 hover:text-primary-300">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
