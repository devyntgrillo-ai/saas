import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Loader2, UserPlus, ShieldCheck, AlertTriangle } from 'lucide-react'
import Logo from '../components/Logo'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { useInvitation } from '../lib/queries'
import { ACCESS_LABELS } from '../lib/permissions'

export default function AcceptInvitation() {
  const { token } = useParams()
  const navigate = useNavigate()
  const { user, signUp, signIn, refreshProfile, refreshAgency } = useAuth()

  const { data: invite, isLoading: loading } = useInvitation(token)
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const scopeName = invite?.agency_name || invite?.practice_name || 'CaseLift'
  const expired = invite && (invite.accepted_at || new Date(invite.expires_at) < new Date())

  async function finalize() {
    const { data, error: e } = await supabase.rpc('accept_invitation', { p_token: token })
    if (e || !data?.ok) {
      setError(e?.message || data?.error || 'Could not accept the invitation.')
      return false
    }
    await Promise.all([refreshProfile?.(), refreshAgency?.()])
    return true
  }

  async function acceptAsExisting() {
    setBusy(true)
    setError('')
    const ok = await finalize()
    setBusy(false)
    if (ok) navigate('/', { replace: true })
  }

  async function acceptAsNew(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error: suErr } = await signUp(invite.email, password, { full_name: name })
    if (suErr) {
      setError(suErr.message)
      setBusy(false)
      return
    }
    // Ensure we have a session (some projects auto-confirm; otherwise sign in).
    const { data: sess } = await supabase.auth.getSession()
    if (!sess.session) {
      const { error: siErr } = await signIn(invite.email, password)
      if (siErr) {
        setError('Account created. Please sign in to finish accepting.')
        setBusy(false)
        return
      }
    }
    const ok = await finalize()
    setBusy(false)
    if (ok) navigate('/', { replace: true })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center"><Logo /></div>
        <div className="card p-8">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-slate-500" /></div>
          ) : !invite ? (
            <Invalid />
          ) : expired ? (
            <Invalid expired />
          ) : (
            <>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary-400">
                <UserPlus className="h-5 w-5" />
              </div>
              <h1 className="mt-4 text-xl font-bold text-white">You're invited to {scopeName}</h1>
              <p className="mt-1 text-sm text-slate-400">
                {invite.inviter_email ? `${invite.inviter_email} invited ` : 'You were invited '}
                <span className="text-slate-200">{invite.email}</span> as{' '}
                <span className="font-medium text-primary-300">{ACCESS_LABELS[invite.role] || invite.role}</span>.
              </p>
              {invite.personal_message && (
                <p className="mt-3 rounded-lg border border-surface-700 bg-surface-800/50 p-3 text-sm italic text-slate-300">
                  “{invite.personal_message}”
                </p>
              )}

              {user ? (
                <button onClick={acceptAsExisting} disabled={busy} className="btn-primary mt-6 w-full">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  Accept invitation
                </button>
              ) : (
                <form onSubmit={acceptAsNew} className="mt-6 space-y-4">
                  <div>
                    <label className="label">Your name</label>
                    <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jordan Rivera" />
                  </div>
                  <div>
                    <label className="label">Create a password</label>
                    <input className="input" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
                  </div>
                  <button type="submit" disabled={busy} className="btn-primary w-full">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                    Accept &amp; create account
                  </button>
                </form>
              )}

              {error && <p className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Invalid({ expired }) {
  return (
    <div className="py-6 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-400">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <p className="mt-4 text-sm font-semibold text-slate-200">
        {expired ? 'This invitation has expired or was already used' : 'Invitation not found'}
      </p>
      <p className="mt-1 text-xs text-slate-500">Ask whoever invited you to send a fresh link.</p>
    </div>
  )
}
