import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Loader2, AlertCircle } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { applyPrimaryColor } from '../lib/whitelabel'
import { money } from '../lib/resellerSaas'

// White-labeled client signup for a reseller's SaaS offer: /signup/<reseller-slug>.
// Resolves the reseller brand + offer via the public get_reseller_signup RPC,
// creates the account through the reseller-signup edge function, then signs the
// new client straight into the app.
export default function ResellerSignup() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const { signIn } = useAuth()

  const [offer, setOffer] = useState(null) // { company_name, logo_url, primary_color, client_price, trial_enabled, trial_days, ... }
  const [resolving, setResolving] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [form, setForm] = useState({ practice: '', firstName: '', lastName: '', email: '', phone: '', password: '' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  // Resolve the reseller offer/brand for this slug.
  useEffect(() => {
    let active = true
    ;(async () => {
      setResolving(true)
      try {
        const { data, error: err } = await supabase.rpc('get_reseller_signup', { p_slug: slug })
        if (!active) return
        if (err || !data) {
          setNotFound(true)
        } else {
          setOffer(data)
          if (data.primary_color) applyPrimaryColor(data.primary_color)
          document.title = `${data.company_name} — Get Started`
        }
      } catch {
        if (active) setNotFound(true)
      } finally {
        if (active) setResolving(false)
      }
    })()
    return () => {
      active = false
    }
  }, [slug])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const { data, error: err } = await supabase.functions.invoke('reseller-signup', {
        body: {
          slug,
          practice_name: form.practice,
          first_name: form.firstName,
          last_name: form.lastName,
          email: form.email,
          phone: form.phone,
          password: form.password,
          app_url: window.location.origin,
        },
      })
      if (err) throw new Error(await edgeErrorMessage(err))
      if (data?.error) throw new Error(data.error)

      // Account created — sign the client straight in, then into onboarding.
      const { error: signInErr } = await signIn(form.email.trim().toLowerCase(), form.password)
      if (signInErr) {
        // Account exists but auto-login failed — send them to login.
        navigate('/login', { replace: true })
        return
      }
      navigate('/baa', { replace: true })
    } catch (e2) {
      setError(e2.message || 'Could not create your account.')
      setSubmitting(false)
    }
  }

  if (resolving) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
      </div>
    )
  }

  if (notFound || !offer) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface px-4">
        <div className="card max-w-md p-8 text-center">
          <AlertCircle className="mx-auto h-10 w-10 text-amber-400" />
          <h1 className="mt-4 text-xl font-bold text-white">This signup link isn’t active</h1>
          <p className="mt-2 text-sm text-slate-400">Double-check the link, or contact whoever shared it with you.</p>
          <Link to="/login" className="btn-primary mt-6 inline-flex">Go to sign in</Link>
        </div>
      </div>
    )
  }

  const trial = offer.trial_enabled && Number(offer.trial_days) > 0
  const price = Number(offer.client_price) || 0

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-10">
      <div className="w-full max-w-md">
        {/* Reseller brand header */}
        <div className="mb-8 flex flex-col items-center text-center">
          {offer.logo_url ? (
            <img src={offer.logo_url} alt={offer.company_name} className="h-12 max-w-[200px] object-contain" />
          ) : (
            <span className="text-xl font-bold text-white">{offer.company_name}</span>
          )}
        </div>

        <div className="card p-8">
          <h1 className="text-2xl font-bold text-white">Get Started with {offer.company_name}</h1>
          <p className="mt-1 text-sm text-slate-400">
            {trial
              ? `Start your ${offer.trial_days}-day free trial — no payment required today.`
              : `Get started for ${money(price)}/month.`}
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label className="label" htmlFor="practice">Practice name</label>
              <input id="practice" required className="input" placeholder="Bright Smile Dental" value={form.practice} onChange={set('practice')} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="first">First name</label>
                <input id="first" required className="input" value={form.firstName} onChange={set('firstName')} />
              </div>
              <div>
                <label className="label" htmlFor="last">Last name</label>
                <input id="last" required className="input" value={form.lastName} onChange={set('lastName')} />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" type="email" required autoComplete="email" className="input" placeholder="you@practice.com" value={form.email} onChange={set('email')} />
            </div>
            <div>
              <label className="label" htmlFor="phone">Phone</label>
              <input id="phone" type="tel" className="input" placeholder="(555) 123-4567" value={form.phone} onChange={set('phone')} />
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input id="password" type="password" required minLength={6} autoComplete="new-password" className="input" placeholder="At least 6 characters" value={form.password} onChange={set('password')} />
            </div>

            {!trial && price > 0 && (
              <p className="rounded-lg border border-surface-700 bg-surface-900 px-3 py-2 text-xs text-slate-400">
                Payment is arranged directly with {offer.company_name}.
              </p>
            )}
            {error && (
              <p className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
              </p>
            )}

            <button type="submit" className="btn-primary w-full" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting ? 'Creating account…' : trial ? 'Start free trial' : 'Get started'}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          {offer.company_name} · Powered by CaseLift
        </p>
      </div>
    </div>
  )
}

// Pull the real `error` field out of a non-2xx edge response.
async function edgeErrorMessage(error) {
  try {
    const body = await error?.context?.json?.()
    if (body?.error) return body.error
  } catch {
    /* not JSON */
  }
  return error?.message || 'Request failed'
}
