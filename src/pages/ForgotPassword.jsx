import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, MailCheck } from 'lucide-react'
import Logo from '../components/Logo'
import { supabase } from '../lib/supabase'
import { AUDIT, logAuthEvent } from '../lib/audit'

// Step 1 of the secure password reset: request a reset email. Uses Supabase's
// built-in resetPasswordForEmail, which sends a one-time recovery link (the link
// / OTP expires after 1 hour, see otp_expiry in supabase/config.toml). The
// redirect lands on /reset-password, where the user sets a new password.
export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const redirectTo = `${window.location.origin}/reset-password`
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo })
    setLoading(false)

    // Record the request for the audit trail (non-PHI). Routed through the
    // log-audit edge function since there's no active session here.
    logAuthEvent(AUDIT.PASSWORD_RESET_REQUESTED, {
      email: email.trim(),
      details: { email: email.trim() },
    })

    // Always show the same confirmation, even on error, so we don't disclose
    // whether an email is registered (account enumeration protection).
    if (resetError) console.warn('[auth] password reset request error', resetError.message)
    setSent(true)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>

        <div className="card p-8">
          {sent ? (
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15">
                <MailCheck className="h-6 w-6 text-emerald-300" />
              </div>
              <h1 className="mt-4 text-2xl font-bold text-white">Check your email</h1>
              <p className="mt-2 text-sm text-slate-400">
                If an account exists for <span className="text-slate-200">{email.trim()}</span>, we&apos;ve sent a
                password reset link. It expires in 1 hour.
              </p>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-white">Reset your password</h1>
              <p className="mt-1 text-sm text-slate-400">
                Enter your email and we&apos;ll send you a secure link to set a new password.
              </p>

              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                <div>
                  <label className="label" htmlFor="email">Email</label>
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

                {error && (
                  <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                    {error}
                  </p>
                )}

                <button type="submit" className="btn-primary w-full" disabled={loading}>
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  {loading ? 'Sending…' : 'Send reset link'}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-sm text-slate-400">
          <Link to="/login" className="font-medium text-primary-400 hover:text-primary-300">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
