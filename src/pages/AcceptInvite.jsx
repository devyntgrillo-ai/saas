import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2, ShieldCheck, KeyRound } from 'lucide-react'
import Logo from '../components/Logo'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { logAudit, AUDIT } from '../lib/audit'
import { useUpdatePassword } from '../lib/queries'

// Landing page for every Supabase auth invite / recovery / magic link.
// detectSessionInUrl establishes the session from the URL hash; the user sets
// (or resets) their password here, then continues into the app.
export default function AcceptInvite() {
  const { session, loading, signIn, refreshProfile, refreshAgency } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const invitationToken = searchParams.get('invitation')
  // Optional post-set-password landing path (e.g. a rep-provisioned owner is sent
  // to /onboarding). Only same-origin paths are honored; anything else → '/'.
  const nextParam = searchParams.get('next')
  const nextPath = nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/'
  const updatePassword = useUpdatePassword()
  const [submitting, setSubmitting] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')

  const linkType = useMemo(() => {
    if (typeof window === 'undefined') return 'invite'
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    return params.get('type') || 'invite'
  }, [])
  const isRecovery = linkType === 'recovery'
  const mustSetPassword = isRecovery || linkType === 'invite' || linkType === 'signup' || Boolean(invitationToken)

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

    // Invitation-token path: completes server-side from the token alone, so it
    // works even when the Supabase one-time link was consumed by an email
    // scanner or expired (no active session required). The token in the query
    // param is only spent by this POST, never by a link pre-fetch.
    if (invitationToken) {
      setSubmitting(true)
      try {
        const { data, error: fnErr } = await supabase.functions.invoke('accept-invite', {
          body: { token: invitationToken, password },
        })
        if (fnErr || data?.error || !data?.ok) {
          throw new Error(data?.error || fnErr?.message || 'Could not accept the invitation.')
        }
        // Establish a session with the password they just set.
        const { error: siErr } = await signIn(data.email, password)
        if (siErr) {
          setError('Password set — please sign in to continue.')
          return
        }
        logAudit(AUDIT.PASSWORD_CHANGED, { resourceType: 'auth', details: { context: 'invite_accept' } })
        await Promise.all([refreshProfile?.(), refreshAgency?.()])
        navigate('/', { replace: true })
      } catch (err) {
        setError(err?.message || 'Could not accept the invitation.')
      } finally {
        setSubmitting(false)
      }
      return
    }

    // Recovery / signup link with an active session: update password directly.
    try {
      await updatePassword.mutateAsync({ password })
      logAudit(AUDIT.PASSWORD_CHANGED, {
        resourceType: 'auth',
        details: { context: isRecovery ? 'password_reset' : 'invite_accept' },
      })
      navigate(nextPath, { replace: true })
    } catch (err) {
      setError(err?.message || 'Could not update password.')
    }
  }

  // With an invitation token we can complete WITHOUT a session, so a consumed/
  // expired Supabase link is no longer a dead end — only show "expired" when
  // there's no token to fall back on.
  const noSession = checked && !loading && !session && !invitationToken
  const busy = updatePassword.isPending || submitting

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
              <h1 className="mt-3 text-lg font-bold text-white">
                {isRecovery ? 'Reset link expired' : 'Invite link expired'}
              </h1>
              <p className="mt-1 text-sm text-slate-400">
                {isRecovery
                  ? 'This password reset link is invalid or has already been used. Request a new one from the sign-in page.'
                  : 'This invite link is invalid or has already been used. Ask your admin to resend it.'}
              </p>
              <Link to="/login" className="btn-primary mt-6 w-full">Go to sign in</Link>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 text-primary-300">
                <ShieldCheck className="h-5 w-5" />
                <span className="text-xs font-semibold uppercase tracking-wide">Welcome to CaseLift</span>
              </div>
              <h1 className="mt-3 text-xl font-bold text-white">
                {isRecovery ? 'Choose a new password' : 'Set your password'}
              </h1>
              <p className="mt-1 text-sm text-slate-400">
                {isRecovery
                  ? 'Enter a new password for your account.'
                  : invitationToken
                    ? 'Create a password to finish joining your team.'
                    : 'Create a password to finish activating your account.'}
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
                <button type="submit" disabled={busy || (checked && !session && !invitationToken)} className="btn-primary w-full">
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  {busy ? 'Saving…' : isRecovery ? 'Update password & continue' : 'Set password & continue'}
                </button>
              </form>

              {!mustSetPassword && session && (
                <button
                  type="button"
                  onClick={() => navigate('/', { replace: true })}
                  className="mt-4 w-full text-center text-sm text-slate-400 transition hover:text-slate-200"
                >
                  Already set your password? Continue to dashboard
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
