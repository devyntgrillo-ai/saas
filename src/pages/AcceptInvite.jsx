import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2, ShieldCheck, KeyRound } from 'lucide-react'
import Logo from '../components/Logo'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

// Landing page for the invite link an agency sends to a new practice's TC.
// Supabase has already established a session from the invite token (detectSessionInUrl).
// The TC sets a password here, then the BAA gate routes them to /baa → dashboard.
export default function AcceptInvite() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Give Supabase a moment to parse the token from the URL hash.
  const [checked, setChecked] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setChecked(true), 600)
    return () => clearTimeout(t)
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (password.length < 6) return setError('Password must be at least 6 characters.')
    if (password !== confirm) return setError('Passwords do not match.')
    setSaving(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setSaving(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    // BAA gate will route to /baa, then their dashboard.
    navigate('/', { replace: true })
  }

  const noSession = checked && !loading && !session

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <div className="card p-8">
          {noSession ? (
            <div className="text-center">
              <KeyRound className="mx-auto h-10 w-10 text-slate-600" />
              <h1 className="mt-3 text-lg font-bold text-white">Invite link expired</h1>
              <p className="mt-1 text-sm text-slate-400">
                This invite link is invalid or has already been used. Ask your reseller to resend it.
              </p>
              <Link to="/login" className="btn-primary mt-6 w-full">Go to sign in</Link>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 text-primary-300">
                <ShieldCheck className="h-5 w-5" />
                <span className="text-xs font-semibold uppercase tracking-wide">Welcome to Hope AI</span>
              </div>
              <h1 className="mt-3 text-xl font-bold text-white">Set your password</h1>
              <p className="mt-1 text-sm text-slate-400">
                Create a password to finish activating your account.
              </p>

              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                <div>
                  <label className="label">New password</label>
                  <input className="input" type="password" autoComplete="new-password" required
                    minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 6 characters" />
                </div>
                <div>
                  <label className="label">Confirm password</label>
                  <input className="input" type="password" autoComplete="new-password" required
                    value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                </div>
                {error && (
                  <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                    {error}
                  </p>
                )}
                <button type="submit" disabled={saving || (checked && !session)} className="btn-primary w-full">
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {saving ? 'Setting password…' : 'Set password & continue'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
