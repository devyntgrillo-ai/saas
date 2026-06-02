import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2, CheckCircle2, Gift } from 'lucide-react'
import Logo from '../components/Logo'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { REF_STORAGE_KEY } from '../components/ReferralRedirect'

export default function Signup() {
  const { signUp, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [practiceName, setPracticeName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  // Referral: code comes from ?ref= or localStorage (set by /r/[code]). We
  // resolve it to the referrer so we can both welcome them by name and stamp
  // the new practice with referred_by_practice_id.
  const [refCode] = useState(() => {
    let stored = ''
    try {
      stored = localStorage.getItem(REF_STORAGE_KEY) || ''
    } catch {
      /* storage unavailable */
    }
    return (searchParams.get('ref') || stored || '').trim()
  })
  const [referrer, setReferrer] = useState(null) // { practice_id, practice_name }

  useEffect(() => {
    if (!refCode) return
    let active = true
    ;(async () => {
      const { data } = await supabase.rpc('resolve_referral_code', { p_code: refCode })
      if (active && Array.isArray(data) && data[0]) setReferrer(data[0])
    })()
    return () => {
      active = false
    }
  }, [refCode])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    // Create the auth user. A trigger provisions the public.users row.
    const { data, error: signUpError } = await signUp(email, password, {
      practice_name: practiceName,
    })

    if (signUpError) {
      setLoading(false)
      setError(signUpError.message)
      return
    }

    // If we have an active session (email confirmation disabled), create the
    // practice and link the user to it.
    if (data.session && data.user) {
      const { data: practice, error: practiceError } = await supabase
        .from('practices')
        .insert({
          name: practiceName,
          email,
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

      // Referral consumed - don't re-stamp a future signup on this device.
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
        setError(linkError.message || 'Practice created but could not link to your account.')
        return
      }

      await refreshProfile()
      setLoading(false)
      navigate('/baa', { replace: true })
      return
    }

    // Otherwise email confirmation is required.
    setLoading(false)
    setDone(true)
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface px-4">
        <div className="w-full max-w-md text-center">
          <div className="mb-6 flex justify-center">
            <Logo />
          </div>
          <div className="card p-8">
            <CheckCircle2 className="mx-auto h-12 w-12 text-primary-400" />
            <h1 className="mt-4 text-xl font-bold text-white">Check your email</h1>
            <p className="mt-2 text-sm text-slate-400">
              We sent a confirmation link to <span className="text-slate-200">{email}</span>.
              Confirm it to finish setting up your practice.
            </p>
            <Link to="/login" className="btn-primary mt-6 w-full">
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>

        <div className="card p-8">
          {referrer && (
            <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary-200">
              <Gift className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                You were referred by <span className="font-semibold">{referrer.practice_name}</span>{' '}
                — welcome to Hope AI.
              </span>
            </div>
          )}
          <h1 className="text-2xl font-bold text-white">Create your account</h1>
          <p className="mt-1 text-sm text-slate-400">
            Start recovering unconverted high-value treatment patients.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label className="label" htmlFor="practice">
                Practice name
              </label>
              <input
                id="practice"
                type="text"
                required
                className="input"
                placeholder="Bright Smile Dental"
                value={practiceName}
                onChange={(e) => setPracticeName(e.target.value)}
              />
            </div>

            <div>
              <label className="label" htmlFor="email">
                Work email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                className="input"
                placeholder="you@practice.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div>
              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                className="input"
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error && (
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {error}
              </p>
            )}

            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-slate-400">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-primary-400 hover:text-primary-300">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
