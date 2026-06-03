import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldCheck, Loader2, FileText } from 'lucide-react'
import Logo from '../components/Logo'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

export default function BAA() {
  const { user, practice, baaAccepted, refreshProfile, signOut } = useAuth()
  const navigate = useNavigate()
  const [agreed, setAgreed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [linking, setLinking] = useState(false)

  // Recover from signup race: if the auth user has practice_name metadata but
  // no linked practice yet, finish provisioning before showing the BAA form.
  useEffect(() => {
    if (practice?.id || !user?.id) return
    const practiceName = user.user_metadata?.practice_name?.trim()
    if (!practiceName) return

    let active = true
    ;(async () => {
      setLinking(true)
      setError('')
      try {
        const { data: existing } = await supabase
          .from('users')
          .select('practice_id')
          .eq('id', user.id)
          .maybeSingle()

        if (existing?.practice_id) {
          await refreshProfile()
          return
        }

        const { data: byEmail } = await supabase
          .from('practices')
          .select('id')
          .eq('email', user.email)
          .maybeSingle()

        if (byEmail?.id) {
          const { error: linkError } = await supabase
            .from('users')
            .update({ practice_id: byEmail.id })
            .eq('id', user.id)
          if (linkError) throw linkError
          await refreshProfile()
          return
        }

        const { data: created, error: practiceError } = await supabase
          .from('practices')
          .insert({ name: practiceName, email: user.email })
          .select()
          .single()
        if (practiceError) throw practiceError

        const { error: linkError } = await supabase
          .from('users')
          .update({ practice_id: created.id })
          .eq('id', user.id)
        if (linkError) throw linkError

        await refreshProfile()
      } catch (e) {
        if (active) setError(e.message || 'Could not finish practice setup.')
      } finally {
        if (active) setLinking(false)
      }
    })()

    return () => {
      active = false
    }
  }, [practice?.id, user, refreshProfile])

  // Already accepted (e.g. landed here directly) - send them in.
  if (baaAccepted) {
    navigate('/', { replace: true })
    return null
  }

  const handleAccept = async () => {
    if (!agreed || !practice?.id) return
    setSaving(true)
    setError('')
    const { error: updateError } = await supabase
      .from('practices')
      .update({ baa_accepted_at: new Date().toISOString() })
      .eq('id', practice.id)

    if (updateError) {
      setSaving(false)
      setError(updateError.message)
      return
    }
    await refreshProfile()
    navigate('/', { replace: true })
  }

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-10">
      <div className="w-full max-w-2xl">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>

        <div className="card overflow-hidden">
          <div className="flex items-center gap-3 border-b border-surface-700 px-6 py-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary-400">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">Business Associate Agreement</h1>
              <p className="text-sm text-slate-400">
                Required before accessing protected health information.
              </p>
            </div>
          </div>

          {!practice?.id ? (
            <div className="px-6 py-10 text-center">
              <FileText className="mx-auto h-8 w-8 text-slate-600" />
              {linking ? (
                <>
                  <Loader2 className="mx-auto mt-3 h-6 w-6 animate-spin text-primary-400" />
                  <p className="mt-3 text-sm text-slate-300">Setting up your practice…</p>
                </>
              ) : (
                <>
                  <p className="mt-3 text-sm text-slate-300">
                    Your account isn't linked to a practice yet.
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    A practice must exist before the BAA can be accepted. Finish setup, then return here.
                  </p>
                  {error && (
                    <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                      {error}
                    </p>
                  )}
                  <button onClick={handleSignOut} className="btn-ghost mt-6">
                    Sign out
                  </button>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="max-h-[46vh] overflow-y-auto px-6 py-5 text-sm leading-relaxed text-slate-300">
                <p className="text-xs text-slate-500">
                  Between <span className="text-slate-300">CaseLift, Inc.</span> ("Business
                  Associate") and{' '}
                  <span className="text-slate-300">{practice?.name || 'your practice'}</span>{' '}
                  ("Covered Entity"), effective on acceptance.
                </p>

                <h2 className="mt-5 font-semibold text-slate-100">1. Purpose</h2>
                <p className="mt-1">
                  This Agreement governs the use and disclosure of Protected Health Information
                  ("PHI") by CaseLift in the course of providing AI-assisted consult analysis and
                  patient follow-up services to the Covered Entity, in compliance with HIPAA
                  (45 CFR Parts 160 and 164).
                </p>

                <h2 className="mt-5 font-semibold text-slate-100">2. Permitted Uses</h2>
                <p className="mt-1">
                  CaseLift will use PHI solely to perform the services described, including
                  de-identification, analysis, and follow-up messaging. PHI will not be used or
                  disclosed for any other purpose without authorization.
                </p>

                <h2 className="mt-5 font-semibold text-slate-100">3. Safeguards</h2>
                <p className="mt-1">
                  CaseLift implements administrative, physical, and technical safeguards including:
                  de-identification of all transcripts via automated PHI detection before analysis;
                  encryption of data in transit and at rest; row-level access controls scoped to
                  your practice; and a tamper-resistant audit log of every access to patient
                  records and communications.
                </p>

                <h2 className="mt-5 font-semibold text-slate-100">4. De-identification</h2>
                <p className="mt-1">
                  Raw consult transcripts are never stored. CaseLift strips direct identifiers
                  (names, phone numbers, email addresses, dates of birth, and addresses) before any
                  third-party AI processing, and retains only the de-identified version.
                </p>

                <h2 className="mt-5 font-semibold text-slate-100">5. Breach Notification</h2>
                <p className="mt-1">
                  CaseLift will report any use or disclosure of PHI not provided for by this
                  Agreement, including breaches of unsecured PHI, without unreasonable delay.
                </p>

                <h2 className="mt-5 font-semibold text-slate-100">6. Term &amp; Termination</h2>
                <p className="mt-1">
                  This Agreement remains in effect for the duration of your use of CaseLift. Upon
                  termination, CaseLift will return or destroy all PHI where feasible.
                </p>
              </div>

              <div className="border-t border-surface-700 bg-surface-900 px-6 py-5">
                {error && (
                  <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                    {error}
                  </p>
                )}
                <label className="flex cursor-pointer items-start gap-3 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-surface-600 bg-surface-800 text-primary focus:ring-primary-500/40"
                  />
                  <span>
                    On behalf of {practice?.name || 'my practice'}, I have read and agree to the
                    Business Associate Agreement
                    {user?.email ? ` (accepting as ${user.email})` : ''}.
                  </span>
                </label>

                <div className="mt-4 flex items-center justify-between gap-3">
                  <button onClick={handleSignOut} className="text-sm text-slate-400 hover:text-slate-200">
                    Sign out
                  </button>
                  <button
                    onClick={handleAccept}
                    disabled={!agreed || saving}
                    className="btn-primary"
                  >
                    {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                    {saving ? 'Recording acceptance…' : 'Accept & continue'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
