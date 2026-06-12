import { useCallback, useMemo, useState } from 'react'
import { UserPlus, CheckCircle2, Copy, Check, Settings2, AlertTriangle, Mail, Loader2, CalendarCheck } from 'lucide-react'
import HelcimCardForm from '../../components/HelcimCardForm'
import Confetti from '../../components/Confetti'
import BookingCalendar from '../../components/BookingCalendar'
import { adminOnboardPractice } from '../../lib/billing'
import { supabase } from '../../lib/supabase'

// Super-admin "close the deal on a sales call" page. The rep collects the
// customer's details + card, charges immediately (custom amount, $997 default)
// or starts a trial (hidden under More options), and the server provisions the
// account + emails a welcome with a set-password link and temp password.
const RECOMMENDED_AMOUNT = 997
const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)

function CopyField({ label, value }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* noop */ }
  }
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex gap-2">
        <input className="input flex-1 font-mono text-sm" readOnly value={value} onFocus={(e) => e.target.select()} />
        <button type="button" onClick={copy} className="btn-ghost shrink-0">
          {copied ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}

export default function NewSignup() {
  const [practiceName, setPracticeName] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [amountStr, setAmountStr] = useState(String(RECOMMENDED_AMOUNT))

  const [moreOpen, setMoreOpen] = useState(false)
  const [isTrial, setIsTrial] = useState(false)
  const [trialDaysStr, setTrialDaysStr] = useState('14')
  const [trialAmountStr, setTrialAmountStr] = useState(String(RECOMMENDED_AMOUNT))

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [sessionBooked, setSessionBooked] = useState(false)

  // Rep books the Setup Session with the customer on the success screen. Stamp
  // it on the freshly-provisioned practice so it reflects on their dashboard.
  // Best-effort — the rep booked it live regardless of whether GHL posts back.
  const handleSessionBooked = useCallback(async () => {
    setSessionBooked(true)
    const pid = result?.practice_id
    if (!pid) return
    try {
      await supabase.from('practices').update({ setup_session_booked_at: new Date().toISOString() }).eq('id', pid)
    } catch { /* best-effort */ }
  }, [result])

  const amount = Number(amountStr)
  const trialDays = Number(trialDaysStr)
  const trialAmount = Number(trialAmountStr)
  const mode = isTrial ? 'trial' : 'charge'

  const detailsValid = practiceName.trim() && ownerName.trim() && isEmail(ownerEmail.trim().toLowerCase())
  const payValid = mode === 'trial' ? trialDays > 0 && trialAmount > 0 : amount > 0
  const ready = Boolean(detailsValid && payValid && !submitting)

  // The recurring charge amount drives the Helcim.js inline charge. In trial mode
  // we tokenize the card at $0 (verify) and bill after the trial.
  const chargeAmount = useMemo(() => (mode === 'trial' ? undefined : amount), [mode, amount])

  async function handleApproved(res) {
    setSubmitting(true)
    setError('')
    try {
      const data = await adminOnboardPractice({
        practiceName: practiceName.trim(),
        ownerName: ownerName.trim(),
        ownerEmail: ownerEmail.trim().toLowerCase(),
        mode,
        amount: mode === 'charge' ? amount : undefined,
        trialDays: mode === 'trial' ? trialDays : undefined,
        trialAmount: mode === 'trial' ? trialAmount : undefined,
        cardToken: res.cardToken,
        customerCode: res.customerCode,
        cardLast4: res.cardNumberMasked,
        cardType: res.cardType,
        date: res.date,
      })
      setResult(data)
    } catch (e) {
      setError(e?.message || 'Could not create the account. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  function reset() {
    setPracticeName(''); setOwnerName(''); setOwnerEmail('')
    setAmountStr(String(RECOMMENDED_AMOUNT))
    setMoreOpen(false); setIsTrial(false); setTrialDaysStr('14'); setTrialAmountStr(String(RECOMMENDED_AMOUNT))
    setError(''); setResult(null); setSessionBooked(false)
  }

  // ---- Success: celebrate, then hand the rep the login details ----
  if (result) {
    return (
      <>
        <Confetti variant="burst" />
        <div className="relative z-10 mx-auto max-w-xl space-y-6">
          <div className="text-center">
            <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-300" />
            <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-white">Welcome aboard!</h1>
            <p className="mt-2 text-sm text-slate-400">
              {result.mode === 'trial'
                ? `${result.trial_days}-day trial started. $${Number(result.plan_amount).toLocaleString()}/mo after.`
                : `Charged $${Number(result.plan_amount).toLocaleString()}. Subscription active.`}
            </p>
          </div>

          <div className="card space-y-4 p-6">
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <Mail className={`h-4 w-4 ${result.email_sent ? 'text-emerald-300' : 'text-amber-300'}`} />
              {result.email_sent
                ? <>Welcome email sent to <span className="font-medium text-white">{result.owner_email}</span>.</>
                : <>Email could not be sent{result.email_reason ? ` (${result.email_reason})` : ''}. Share the login below with <span className="font-medium text-white">{result.owner_email}</span> directly.</>}
            </div>
            <CopyField label="Set-password / login link" value={result.login_link} />
            <CopyField label="Temporary password (fallback)" value={result.temp_password} />
            <p className="text-xs text-slate-500">
              They can click the link to set their own password, or sign in at /login with the temporary password.
              The first time they log in they'll confirm a one-page HIPAA BAA, then they're straight into their account.
            </p>
          </div>

          {/* Book the Setup Session with the customer right here, live on the call. */}
          <div className="card space-y-4 p-6">
            <div className="flex items-center gap-2">
              <CalendarCheck className="h-5 w-5 shrink-0 text-primary-300" />
              <div>
                <h2 className="text-sm font-semibold text-white">Book their Setup Session</h2>
                <p className="text-sm text-slate-400">
                  Grab a 20-minute time with {ownerName.trim() || 'them'} now — we'll connect their PMS, messaging, and team together on the call.
                </p>
              </div>
            </div>
            {sessionBooked && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                <CheckCircle2 className="h-4 w-4 shrink-0" /> Setup Session booked — it'll show on their dashboard.
              </div>
            )}
            <BookingCalendar onBooked={handleSessionBooked} idSuffix="admin_setup" minHeight={680} />
          </div>

          <div className="text-center">
            <button onClick={reset} className="btn-primary">
              <UserPlus className="h-4 w-4" /> Onboard another
            </button>
          </div>
        </div>
      </>
    )
  }

  // ---- Submitting: full loading state while the charge + provisioning runs ----
  if (submitting) {
    return (
      <div className="relative isolate min-h-[85vh]">
        <Confetti variant="ambient" />
        <div className="relative z-10 mx-auto flex max-w-xl flex-col items-center justify-center gap-4 py-24 text-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary-300" />
          <h1 className="text-xl font-bold text-white">Setting up the account…</h1>
          <p className="text-sm text-slate-400">Processing payment and creating their login. Hang tight, don't close this tab.</p>
        </div>
      </div>
    )
  }

  // ---- Form ----
  return (
    <div className="relative isolate min-h-[85vh]">
      <Confetti variant="ambient" />
      <div className="relative z-10 mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">New Signup</h1>
        <p className="mt-1 text-sm text-slate-400">Instantly provision your CaseLift account and start growing your production.</p>
      </div>

      <div className="card space-y-4 p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Customer</h2>
        <div>
          <label className="label">Practice name</label>
          <input className="input" value={practiceName} onChange={(e) => setPracticeName(e.target.value)} placeholder="Pinnacle Dental" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Account Owner Name</label>
            <input className="input" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Dr. Jane Smith" />
          </div>
          <div>
            <label className="label">Account Owner Email</label>
            <input className="input" type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="jane@practice.com" />
          </div>
        </div>
      </div>

      <div className="card space-y-4 p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Plan</h2>
        {!isTrial && (
          <div>
            <label className="label">Monthly subscription (USD)</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
              <input className="input pl-7" type="number" min={1} value={amountStr} onChange={(e) => setAmountStr(e.target.value)} />
            </div>
          </div>
        )}

        {/* Trial lives under More options so a screen-shared customer doesn't see
            it unless the rep chooses to offer one. */}
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-medium text-slate-400 transition hover:text-slate-200"
        >
          <Settings2 className="h-3.5 w-3.5" /> {moreOpen ? 'Hide options' : 'More options'}
        </button>
        {moreOpen && (
          <div className="space-y-4 rounded-lg border border-surface-700 bg-surface-800/40 p-4">
            <label className="flex items-center gap-2.5 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={isTrial}
                onChange={(e) => setIsTrial(e.target.checked)}
                className="h-4 w-4 rounded border-surface-600 bg-surface-800 text-primary focus:ring-primary/40"
              />
              Start a free trial instead of charging now
            </label>
            {isTrial && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Trial length (days)</label>
                  <input className="input" type="number" min={1} max={365} value={trialDaysStr} onChange={(e) => setTrialDaysStr(e.target.value)} />
                </div>
                <div>
                  <label className="label">Charge after trial (USD/mo)</label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                    <input className="input pl-7" type="number" min={1} value={trialAmountStr} onChange={(e) => setTrialAmountStr(e.target.value)} />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card space-y-4 p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Payment</h2>
        {mode === 'charge' && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Submitting charges the card <strong>${amount.toLocaleString()}</strong> immediately and creates the account.
          </div>
        )}
        <HelcimCardForm
          key={mode} // re-mount when switching charge/trial so Helcim.js reinitializes
          amount={chargeAmount}
          verify={mode === 'trial'}
          submitLabel={mode === 'trial' ? 'Save card & start trial' : 'Subscribe & create account'}
          showAmountInLabel={false}
          disabled={!ready}
          onApproved={handleApproved}
          onDeclined={(res) => setError(res?.message || 'The card was declined. Try a different card.')}
          onError={(msg) => setError(msg || 'Could not start the payment.')}
        />
        {!ready && (
          <p className="text-xs text-amber-300">
            {!detailsValid
              ? 'Add the practice name, account owner name, and a valid email before submitting.'
              : mode === 'trial'
                ? 'Enter a valid trial length and post-trial amount.'
                : 'Enter a valid charge amount.'}
          </p>
        )}
        {error && (
          <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>
        )}
      </div>
      </div>
    </div>
  )
}
