import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2, CheckCircle2, ShieldAlert } from 'lucide-react'
import Logo from '../components/Logo'
import PasswordField from '../components/PasswordField'
import { supabase } from '../lib/supabase'
import { validatePassword } from '../lib/passwordPolicy'
import { AUDIT, logAuthEvent } from '../lib/audit'

// Step 2 of the secure password reset. The recovery link from the email opens a
// short-lived recovery session (detectSessionInUrl in the Supabase client picks
// it up and fires a PASSWORD_RECOVERY event). Here we:
//   1. enforce the password policy,
//   2. set the new password via updateUser,
//   3. invalidate every OTHER session (signOut scope 'others'),
//   4. log password_changed to the audit trail,
//   5. send the user to sign in fresh.
export default function ResetPassword() {
  const navigate = useNavigate()
  const [ready, setReady] = useState(false) // a recovery/auth session is present
  const [checking, setChecking] = useState(true)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  // Confirm we actually have a session to update against. The recovery link
  // establishes one; arriving here directly (expired/invalid link) does not.
  useEffect(() => {
    let active = true
    // PASSWORD_RECOVERY fires once the URL hash is processed; also cover the case
    // where the session is already established by the time we mount.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      if (event === 'PASSWORD_RECOVERY' || session) setReady(true)
    })
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      if (data?.session) setReady(true)
      setChecking(false)
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    const pwCheck = validatePassword(password)
    if (!pwCheck.valid) {
      setError(pwCheck.errors[0])
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) {
      setLoading(false)
      setError(updateError.message || 'Could not update your password. The link may have expired, request a new one.')
      return
    }

    // Invalidate all OTHER sessions so a previously-compromised login can't
    // outlive the reset. The current (recovery) session stays valid until we
    // navigate to /login below.
    try {
      await supabase.auth.signOut({ scope: 'others' })
    } catch (e) {
      console.warn('[auth] could not revoke other sessions after reset', e?.message)
    }

    logAuthEvent(AUDIT.PASSWORD_CHANGED, { details: { via: 'reset_link', other_sessions_revoked: true } })

    setLoading(false)
    setDone(true)
    // Sign the recovery session out and bounce to login after a short beat.
    setTimeout(async () => {
      await supabase.auth.signOut()
      navigate('/login', { replace: true })
    }, 2500)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>

        <div className="card p-8">
          {done ? (
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15">
                <CheckCircle2 className="h-6 w-6 text-emerald-300" />
              </div>
              <h1 className="mt-4 text-2xl font-bold text-white">Password updated</h1>
              <p className="mt-2 text-sm text-slate-400">
                Your password has been changed and all other sessions were signed out. Redirecting you to sign in…
              </p>
            </div>
          ) : !checking && !ready ? (
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15">
                <ShieldAlert className="h-6 w-6 text-amber-300" />
              </div>
              <h1 className="mt-4 text-2xl font-bold text-white">Link expired or invalid</h1>
              <p className="mt-2 text-sm text-slate-400">
                This password reset link is no longer valid. Reset links expire after 1 hour, request a new one.
              </p>
              <Link to="/forgot-password" className="btn-primary mt-5 w-full justify-center">
                Request a new link
              </Link>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-white">Set a new password</h1>
              <p className="mt-1 text-sm text-slate-400">
                Choose a strong password you don&apos;t use anywhere else.
              </p>

              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                <PasswordField
                  id="new-password"
                  label="New password"
                  value={password}
                  onChange={setPassword}
                  disabled={loading || checking}
                />
                <PasswordField
                  id="confirm-password"
                  label="Confirm new password"
                  value={confirm}
                  onChange={setConfirm}
                  showMeter={false}
                  showChecklist={false}
                  placeholder="Re-enter your new password"
                  disabled={loading || checking}
                />

                {error && (
                  <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                    {error}
                  </p>
                )}

                <button type="submit" className="btn-primary w-full" disabled={loading || checking}>
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  {loading ? 'Updating…' : 'Update password'}
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
