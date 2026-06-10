import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck, ShieldOff, Loader2, Check, Copy, KeyRound, AlertTriangle } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { generateBackupCodes, hashBackupCodes } from '../lib/mfa'
import { auditMfaEnrolled, auditMfaDisabled } from '../lib/audit'
import Modal from './Modal'

// Settings → Your Profile → Two-Factor Authentication.
// Full TOTP enrollment lifecycle via the Supabase MFA APIs:
//   enroll() → show QR + secret → challenge() + verify() with a 6-digit code →
//   show one-time backup codes. Disabling requires re-entering the password.
export default function MfaSetup() {
  const { user } = useAuth()
  const [factors, setFactors] = useState([])
  const [loading, setLoading] = useState(true)

  // Enrollment wizard state.
  const [enrolling, setEnrolling] = useState(false)
  const [factor, setFactor] = useState(null) // { id, totp: { qr_code, secret } }
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [backupCodes, setBackupCodes] = useState(null)
  const [copied, setCopied] = useState(false)

  // Disable confirmation.
  const [showDisable, setShowDisable] = useState(false)

  const verifiedFactor = factors.find((f) => f.status === 'verified') || null
  const mfaEnabled = Boolean(verifiedFactor)

  const refreshFactors = useCallback(async () => {
    setLoading(true)
    const { data, error: listError } = await supabase.auth.mfa.listFactors()
    if (listError) setError(listError.message)
    setFactors(data?.totp ?? data?.all ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshFactors()
  }, [refreshFactors])

  // Clean up an unverified factor if the user bails mid-enrollment, so a stale
  // pending factor doesn't accumulate.
  async function cancelEnrollment() {
    if (factor?.id) {
      try {
        await supabase.auth.mfa.unenroll({ factorId: factor.id })
      } catch {
        /* best-effort */
      }
    }
    setEnrolling(false)
    setFactor(null)
    setCode('')
    setError('')
  }

  async function startEnroll() {
    setError('')
    setBusy(true)
    // Clear any stale unverified factor from an abandoned attempt so the new
    // enrollment doesn't collide on the friendly name.
    for (const f of factors) {
      if (f.status !== 'verified') {
        try {
          await supabase.auth.mfa.unenroll({ factorId: f.id })
        } catch {
          /* best-effort */
        }
      }
    }
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `CaseLift Authenticator (${user?.email || 'account'})`,
    })
    setBusy(false)
    if (enrollError) {
      // Supabase Pro feature, surface a clear message if MFA isn't enabled on the project.
      setError(
        /not enabled|disabled|unsupported/i.test(enrollError.message)
          ? 'Two-factor authentication is not enabled on this project yet. Enable TOTP MFA in the Supabase dashboard (Auth → Sign In / Providers → Multi-Factor).'
          : enrollError.message,
      )
      return
    }
    setFactor(data)
    setEnrolling(true)
  }

  async function verifyEnroll(e) {
    e?.preventDefault?.()
    if (!factor?.id) return
    setError('')
    setBusy(true)

    const { data: ch, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: factor.id })
    if (challengeError) {
      setBusy(false)
      setError(challengeError.message)
      return
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: factor.id,
      challengeId: ch.id,
      code: code.trim(),
    })
    if (verifyError) {
      setBusy(false)
      setError('That code didn’t match. Check your authenticator app and try again.')
      return
    }

    // Activated. Generate one-time backup codes and persist only their hashes.
    const codes = generateBackupCodes()
    try {
      const hashes = await hashBackupCodes(codes)
      await supabase.auth.updateUser({ data: { mfa_backup_codes: hashes } })
    } catch (err) {
      console.warn('[mfa] could not store backup code hashes', err?.message)
    }

    auditMfaEnrolled({ factor_id: factor.id, method: 'totp' })

    setBackupCodes(codes)
    setEnrolling(false)
    setFactor(null)
    setCode('')
    setBusy(false)
    await refreshFactors()
  }

  async function disableMfa(password) {
    setError('')
    setBusy(true)

    // Re-authenticate by re-entering the password before unenrolling.
    const { error: pwError } = await supabase.auth.signInWithPassword({
      email: user?.email,
      password,
    })
    if (pwError) {
      setBusy(false)
      return 'Incorrect password.'
    }

    // Unenroll every verified TOTP factor.
    for (const f of factors) {
      try {
        await supabase.auth.mfa.unenroll({ factorId: f.id })
      } catch (err) {
        console.warn('[mfa] unenroll failed', f.id, err?.message)
      }
    }
    try {
      await supabase.auth.updateUser({ data: { mfa_backup_codes: null } })
    } catch {
      /* non-blocking */
    }

    auditMfaDisabled({ method: 'totp' })

    setBusy(false)
    setShowDisable(false)
    await refreshFactors()
    return null
  }

  function copyBackupCodes() {
    if (!backupCodes) return
    navigator.clipboard?.writeText(backupCodes.join('\n')).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="card p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-white">
            <ShieldCheck className="h-[18px] w-[18px] text-emerald-400" />
            Two-Factor Authentication
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Add a second layer of security with a one-time code from an authenticator app
            (Google Authenticator, Authy, 1Password).
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
            mfaEnabled
              ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/20'
              : 'bg-slate-500/15 text-slate-300 ring-surface-700'
          }`}
        >
          {mfaEnabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>

      {error && !enrolling && (
        <p className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
          {error}
        </p>
      )}

      {loading ? (
        <p className="mt-4 text-sm text-slate-500">Loading…</p>
      ) : mfaEnabled ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm text-emerald-300">
            <Check className="h-4 w-4" /> Two-factor authentication is active on your account.
          </p>
          <button onClick={() => setShowDisable(true)} className="btn-ghost text-rose-300 hover:text-rose-200">
            <ShieldOff className="h-4 w-4" /> Disable MFA
          </button>
        </div>
      ) : (
        <div className="mt-5">
          <button onClick={startEnroll} disabled={busy} className="btn-primary">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Enable Two-Factor Authentication
          </button>
        </div>
      )}

      {/* Enrollment wizard: QR + verify */}
      {enrolling && factor && (
        <Modal title="Set up two-factor authentication" onClose={cancelEnrollment}>
          <div className="space-y-4">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-400">
              <li>Open your authenticator app and scan this QR code.</li>
              <li>Enter the 6-digit code it generates to confirm.</li>
            </ol>

            <div className="flex justify-center">
              {factor.totp?.qr_code ? (
                <img
                  src={factor.totp.qr_code}
                  alt="Two-factor QR code"
                  className="h-48 w-48 rounded-lg bg-white p-2"
                />
              ) : (
                <p className="text-sm text-slate-500">QR code unavailable, use the key below.</p>
              )}
            </div>

            {factor.totp?.secret && (
              <div className="rounded-lg border border-surface-700 bg-surface-800/60 px-3 py-2 text-center">
                <p className="text-xs text-slate-500">Can&apos;t scan? Enter this key manually:</p>
                <p className="mt-1 break-all font-mono text-sm text-slate-200">{factor.totp.secret}</p>
              </div>
            )}

            <form onSubmit={verifyEnroll} className="space-y-3">
              <div>
                <label className="label" htmlFor="mfa-code">6-digit code</label>
                <input
                  id="mfa-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  className="input text-center font-mono text-lg tracking-[0.4em]"
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                />
              </div>

              {error && (
                <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                  {error}
                </p>
              )}

              <div className="flex items-center justify-end gap-3">
                <button type="button" onClick={cancelEnrollment} className="btn-ghost">Cancel</button>
                <button type="submit" disabled={busy || code.length !== 6} className="btn-primary">
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Verify &amp; activate
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}

      {/* Backup codes shown once, after successful activation */}
      {backupCodes && (
        <Modal title="Save your backup codes" onClose={() => setBackupCodes(null)}>
          <div className="space-y-4">
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Store these somewhere safe. Each code can be used once if you lose access to your
                authenticator. <strong>They won&apos;t be shown again.</strong>
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 rounded-lg border border-surface-700 bg-surface-800/60 p-4">
              {backupCodes.map((c) => (
                <span key={c} className="flex items-center gap-1.5 font-mono text-sm text-slate-200">
                  <KeyRound className="h-3.5 w-3.5 text-slate-500" />
                  {c}
                </span>
              ))}
            </div>

            <div className="flex items-center justify-end gap-3">
              <button onClick={copyBackupCodes} className="btn-ghost">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Copied' : 'Copy codes'}
              </button>
              <button onClick={() => setBackupCodes(null)} className="btn-primary">
                I&apos;ve saved them
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Disable confirmation, requires the account password */}
      {showDisable && (
        <DisableMfaModal busy={busy} onCancel={() => setShowDisable(false)} onConfirm={disableMfa} />
      )}
    </div>
  )
}

function DisableMfaModal({ busy, onCancel, onConfirm }) {
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')

  async function submit(e) {
    e.preventDefault()
    setErr('')
    const result = await onConfirm(password)
    if (result) setErr(result)
  }

  return (
    <Modal title="Disable two-factor authentication" onClose={onCancel}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-400">
          This removes the extra security on your account. Confirm your password to continue.
        </p>
        <div>
          <label className="label" htmlFor="disable-mfa-pw">Password</label>
          <input
            id="disable-mfa-pw"
            type="password"
            autoComplete="current-password"
            className="input"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {err && (
          <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{err}</p>
        )}
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onCancel} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={busy || !password} className="btn-primary !bg-rose-600 hover:!bg-rose-700">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            <ShieldOff className="h-4 w-4" /> Disable MFA
          </button>
        </div>
      </form>
    </Modal>
  )
}
