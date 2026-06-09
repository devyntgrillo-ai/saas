import { useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import Logo from '../components/Logo'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = location.state?.from?.pathname || '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [forgot, setForgot] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [resetting, setResetting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error: signInError } = await signIn(email, password)
    setLoading(false)
    if (signInError) {
      setError(signInError.message)
      return
    }
    navigate(from, { replace: true })
  }

  async function handleForgotPassword(e) {
    e.preventDefault()
    setError('')
    setResetSent(false)
    if (!email.trim()) {
      setError('Enter your email address first.')
      return
    }
    setResetting(true)
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/accept-invite`,
    })
    setResetting(false)
    if (resetError) {
      setError(resetError.message)
      return
    }
    setResetSent(true)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>

        <div className="card p-8">
          <h1 className="text-2xl font-bold text-white">
            {forgot ? 'Reset your password' : 'Welcome to CaseLift'}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {forgot
              ? "We'll email you a link to choose a new password."
              : 'The heavy lifting starts here.'}
          </p>

          {forgot ? (
            <form onSubmit={handleForgotPassword} className="mt-6 space-y-4">
              <div>
                <label className="label" htmlFor="reset-email">
                  Email
                </label>
                <input
                  id="reset-email"
                  type="email"
                  required
                  autoComplete="email"
                  className="input"
                  placeholder="you@practice.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              {error && (
                <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  {error}
                </p>
              )}
              {resetSent && (
                <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
                  Check your inbox for a password reset link.
                </p>
              )}

              <button type="submit" className="btn-primary w-full" disabled={resetting}>
                {resetting && <Loader2 className="h-4 w-4 animate-spin" />}
                {resetting ? 'Sending…' : 'Send reset link'}
              </button>

              <button
                type="button"
                onClick={() => { setForgot(false); setError(''); setResetSent(false) }}
                className="w-full text-center text-sm text-slate-400 transition hover:text-slate-200"
              >
                Back to sign in
              </button>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label className="label" htmlFor="email">
                  Email
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
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <label className="label mb-0" htmlFor="password">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => { setForgot(true); setError(''); setResetSent(false) }}
                    className="text-xs font-medium text-primary-400 transition hover:text-primary-300"
                  >
                    Forgot password?
                  </button>
                </div>
                <input
                  id="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  className="input"
                  placeholder="••••••••"
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
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          )}

          <p className="mt-5 text-center text-xs text-slate-500">
            🔒 HIPAA Compliant · 256-bit encryption · SOC 2
          </p>
        </div>

        {!forgot && (
          <p className="mt-6 text-center text-sm text-slate-400">
            Don't have an account?{' '}
            <Link to="/signup" className="font-medium text-primary-400 hover:text-primary-300">
              Create one
            </Link>
          </p>
        )}

        <p className="mt-6 text-center text-xs text-slate-500">
          © 2026 CaseLift · caselift.io
        </p>
      </div>
    </div>
  )
}
