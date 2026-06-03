import { useEffect, useState } from 'react'
import {
  Phone,
  Copy,
  Check,
  Loader2,
  MessageSquare,
  Mail,
  ShieldCheck,
  Lock,
  Signal,
  Wifi,
  BatteryFull,
  AlertCircle,
  Clock,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import {
  fetchOptOutCount,
  pollA2PStatus,
  sendTestEmail,
  sendTestSms,
  smsProvisioningStatus,
  a2pMeta,
} from '../lib/messaging'
import PhoneSetupWizard from '../components/PhoneSetupWizard'

// Format a stored phone number for display: +1 (509) 555-0100.
function formatPhone(raw) {
  if (!raw) return ''
  const d = String(raw).replace(/\D/g, '')
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d
  if (ten.length === 10) return `+1 (${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`
  return raw
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

function Toggle({ checked, onChange, label, description }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-slate-200">{label}</p>
        {description && <p className="text-xs text-slate-500">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
          checked ? 'bg-primary' : 'bg-surface-700'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  )
}

// Per-section save button: owns its own busy + "Saved" flash so each card
// saves independently. onSave returns a truthy error to suppress the flash.
function SaveBar({ onSave, label = 'Save changes' }) {
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  async function click() {
    setBusy(true)
    const err = await onSave()
    setBusy(false)
    if (!err) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    }
  }
  return (
    <div className="mt-5 flex items-center justify-end gap-3">
      {saved && (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-300">
          <Check className="h-3.5 w-3.5" /> Saved
        </span>
      )}
      <button onClick={click} disabled={busy} className="btn-primary">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {label}
      </button>
    </div>
  )
}

// Settings → Phone & Messaging. Self-serve number purchase + A2P registration.
export default function PhoneMessaging() {
  const { practice, practiceId, refreshProfile } = useAuth()
  const [setupOpen, setSetupOpen] = useState(false)

  // ---- form state, seeded from the practice record --------------------------
  const [smsEnabled, setSmsEnabled] = useState(true)
  const [smsSender, setSmsSender] = useState('')
  const [emailEnabled, setEmailEnabled] = useState(true)
  const [emailFromName, setEmailFromName] = useState('')
  const [emailReplyTo, setEmailReplyTo] = useState('')
  const [optOuts, setOptOuts] = useState(null)
  const [testSmsTo, setTestSmsTo] = useState('')
  const [testSmsState, setTestSmsState] = useState('idle')
  const [testSmsError, setTestSmsError] = useState('')
  const [testEmail, setTestEmail] = useState('')
  const [testEmailState, setTestEmailState] = useState('idle') // idle | sending | ok | err
  const [testEmailError, setTestEmailError] = useState('')

  useEffect(() => {
    if (!practice) return
    const docName = [practice.doctor_first, practice.doctor_last].filter(Boolean).join(' ')
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSmsEnabled(practice.sms_enabled ?? true)
    setSmsSender(practice.sms_sender_name || '')
    setEmailEnabled(practice.email_enabled ?? true)
    setEmailFromName(
      practice.email_from_name ||
        (docName ? `${docName} - ${practice.name || ''}`.replace(/ - $/, '') : practice.name || ''),
    )
    setEmailReplyTo(practice.email_reply_to || practice.email || '')
  }, [practice])

  useEffect(() => {
    if (practiceId) fetchOptOutCount(practiceId).then(setOptOuts)
  }, [practiceId])

  const provStatus = smsProvisioningStatus(practice)
  const phoneNumber = practice?.twilio_phone_number || practice?.phone_number || ''
  const hasNumber = Boolean(phoneNumber)
  const smsFullyActive = provStatus === 'active'

  useEffect(() => {
    if (!practiceId || provStatus !== 'pending') return
    let active = true
    const tick = async () => {
      try {
        await pollA2PStatus(practiceId)
        if (active) await refreshProfile()
      } catch {
        /* ignore */
      }
    }
    tick()
    const id = setInterval(tick, 20000)
    return () => {
      active = false
      clearInterval(id)
    }
  }, [practiceId, provStatus, refreshProfile])

  async function update(patch) {
    if (!practiceId) return 'No practice'
    const { error } = await supabase.from('practices').update(patch).eq('id', practiceId)
    if (!error) await refreshProfile()
    return error
  }

  // SMS sender shown to patients - fall back to a sensible default in the preview.
  const previewSender = (smsSender || practice?.name || 'Your Practice').slice(0, 11)

  return (
    <div className="space-y-6">
      {provStatus === 'pending' && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div>
            <p className="font-medium">SMS registration pending</p>
            <p className="mt-0.5 text-amber-200/80">
              Your number can receive replies. Outbound follow-up texts unlock after US carrier approval (usually 1–7 business days).
            </p>
          </div>
        </div>
      )}
      {provStatus === 'failed' && (
        <div className="flex items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-medium">SMS registration needs attention</p>
            {practice?.a2p_failure_reason && (
              <p className="mt-0.5 text-rose-200/80">{practice.a2p_failure_reason}</p>
            )}
            <button type="button" onClick={() => setSetupOpen(true)} className="btn-primary mt-3">
              Resubmit registration
            </button>
          </div>
        </div>
      )}

      <PhoneNumberCard
        phoneNumber={phoneNumber}
        hasNumber={hasNumber}
        provStatus={provStatus}
        practice={practice}
        onSetup={() => setSetupOpen(true)}
      />

      {setupOpen && (
        <PhoneSetupWizard
          embedded
          practiceId={practiceId}
          practiceName={practice?.name}
          onClose={() => setSetupOpen(false)}
          onComplete={async () => {
            await refreshProfile()
            setSetupOpen(false)
          }}
        />
      )}

      {/* ── SECTION 2: SMS Settings ────────────────────────────────────── */}
      <div className="card p-6">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary-400" />
          <h2 className="text-base font-semibold text-white">SMS Settings</h2>
        </div>
        <p className="mt-1 text-sm text-slate-400">
          Text-message follow-ups sent to patients after a consult.
        </p>

        <div className="mt-5 border-y border-surface-700 py-3">
          <Toggle
            label="Enable SMS follow-up sequences"
            description={
              smsFullyActive
                ? 'Send the SMS touches in your follow-up sequence automatically.'
                : 'Complete phone setup and A2P approval to enable outbound SMS.'
            }
            checked={smsEnabled && smsFullyActive}
            onChange={(v) => smsFullyActive && setSmsEnabled(v)}
          />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-2">
          <Field
            label="SMS sender name"
            hint="Appears before the message. Max 11 characters - this is the business name patients see."
          >
            <input
              className="input"
              maxLength={11}
              value={smsSender}
              onChange={(e) => setSmsSender(e.target.value)}
              placeholder="Dr. Perry"
            />
            <p className="mt-1.5 text-right text-xs text-slate-500">{smsSender.length}/11</p>
          </Field>

          {/* Live iPhone SMS preview */}
          <div>
            <label className="label">Preview</label>
            <PhonePreview
              sender={previewSender}
              body={`Hi Margaret, it's ${
                practice?.doctor_first || 'Sarah'
              } from ${previewSender}. Great meeting you about your treatment - any questions come up since your visit?`}
            />
          </div>
        </div>

        {smsFullyActive && hasNumber && (
          <div className="mt-5 rounded-lg border border-surface-700 bg-surface-800/40 p-4">
            <p className="text-sm font-medium text-slate-200">Send test SMS</p>
            <p className="mt-1 text-xs text-slate-500">
              Sends from your practice number ({formatPhone(phoneNumber)}).
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                className="input flex-1"
                type="tel"
                value={testSmsTo}
                onChange={(e) => setTestSmsTo(e.target.value)}
                placeholder="+1 555 010 1234"
              />
              <button
                type="button"
                disabled={!practiceId || !testSmsTo.trim() || testSmsState === 'sending'}
                className="btn-secondary shrink-0"
                onClick={async () => {
                  setTestSmsState('sending')
                  setTestSmsError('')
                  try {
                    await sendTestSms(practiceId, testSmsTo.trim())
                    setTestSmsState('ok')
                  } catch (e) {
                    setTestSmsState('err')
                    setTestSmsError(e.message || 'Send failed')
                  }
                }}
              >
                {testSmsState === 'sending' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MessageSquare className="h-4 w-4" />
                )}
                Send test
              </button>
            </div>
            {testSmsState === 'ok' && (
              <p className="mt-2 text-xs text-emerald-300">Test SMS queued — check the handset.</p>
            )}
            {testSmsState === 'err' && (
              <p className="mt-2 text-xs text-rose-300">{testSmsError}</p>
            )}
          </div>
        )}

        <SaveBar
          onSave={() => update({ sms_enabled: smsEnabled, sms_sender_name: smsSender || null })}
        />
      </div>

      {/* ── SECTION 3: Email Settings ──────────────────────────────────── */}
      <div className="card p-6">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-primary-400" />
          <h2 className="text-base font-semibold text-white">Email Settings</h2>
        </div>
        <p className="mt-1 text-sm text-slate-400">
          Email follow-ups sent to patients after a consult.
        </p>

        <div className="mt-5 border-y border-surface-700 py-3">
          <Toggle
            label="Enable email follow-up sequences"
            description="Send the email touches in your follow-up sequence automatically."
            checked={emailEnabled}
            onChange={setEmailEnabled}
          />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="From name">
            <input
              className="input"
              value={emailFromName}
              onChange={(e) => setEmailFromName(e.target.value)}
              placeholder="Dr. Perry - Perry Family Dentistry"
            />
          </Field>
          <Field label="Reply-to email address">
            <input
              className="input"
              type="email"
              value={emailReplyTo}
              onChange={(e) => setEmailReplyTo(e.target.value)}
              placeholder="frontdesk@perryfamilydental.com"
            />
          </Field>
        </div>

        <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-surface-700 bg-surface-800/50 px-4 py-3 text-sm text-slate-400">
          <Mail className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
          Emails are sent via Hope AI's delivery system - no setup required.
        </div>

        <div className="mt-5 rounded-lg border border-surface-700 bg-surface-800/40 p-4">
          <p className="text-sm font-medium text-slate-200">Send test email</p>
          <p className="mt-1 text-xs text-slate-500">Verify Mailgun delivery to any inbox.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              className="input flex-1"
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="you@example.com"
            />
            <button
              type="button"
              disabled={!practiceId || !testEmail.trim() || testEmailState === 'sending'}
              className="btn-secondary shrink-0"
              onClick={async () => {
                setTestEmailState('sending')
                setTestEmailError('')
                try {
                  await sendTestEmail(practiceId, testEmail.trim())
                  setTestEmailState('ok')
                } catch (e) {
                  setTestEmailState('err')
                  setTestEmailError(e.message || 'Send failed')
                }
              }}
            >
              {testEmailState === 'sending' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Mail className="h-4 w-4" />
              )}
              Send test
            </button>
          </div>
          {testEmailState === 'ok' && (
            <p className="mt-2 text-xs text-emerald-300">Test email queued — check the inbox (and spam).</p>
          )}
          {testEmailState === 'err' && (
            <p className="mt-2 text-xs text-rose-300">{testEmailError}</p>
          )}
        </div>

        <SaveBar
          onSave={() =>
            update({
              email_enabled: emailEnabled,
              email_from_name: emailFromName || null,
              email_reply_to: emailReplyTo || null,
            })
          }
        />
      </div>

      {/* ── SECTION 4: Opt-Out Settings ────────────────────────────────── */}
      <div className="card p-6">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-400" />
          <h2 className="text-base font-semibold text-white">Opt-Out Settings</h2>
        </div>

        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-sky-500/25 bg-sky-500/10 px-4 py-3 text-sm text-sky-200">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Hope AI automatically handles STOP/UNSUBSCRIBE replies and removes patients from
            sequences. This is required for TCPA compliance and cannot be disabled.
          </span>
        </div>

        <div className="mt-4 flex items-center justify-between rounded-lg border border-surface-700 bg-surface-800/50 px-4 py-3.5">
          <span className="text-sm text-slate-300">Patients who have opted out</span>
          <span className="text-2xl font-bold text-white">
            {optOuts === null ? <Loader2 className="h-5 w-5 animate-spin text-slate-500" /> : optOuts}
          </span>
        </div>
      </div>
    </div>
  )
}

// ── Section 1 card ──────────────────────────────────────────────────────────
function PhoneNumberCard({ phoneNumber, hasNumber, provStatus, practice, onSetup }) {
  const [copied, setCopied] = useState(false)
  const brandMeta = a2pMeta(practice?.a2p_brand_status)
  const campaignMeta = a2pMeta(practice?.a2p_campaign_status)

  async function copy() {
    try {
      await navigator.clipboard.writeText(phoneNumber)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="card p-6">
      <div className="flex items-center gap-2">
        <Phone className="h-4 w-4 text-primary-400" />
        <h2 className="text-base font-semibold text-white">Practice Phone Number</h2>
      </div>
      <p className="mt-1 text-sm text-slate-400">
        The number your practice sends and receives text messages from.
      </p>

      {hasNumber ? (
        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-surface-700 bg-surface-800/50 px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-primary-300">
                <Phone className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xl font-bold text-white">{formatPhone(phoneNumber)}</p>
                <span
                  className={`mt-0.5 inline-flex items-center gap-1.5 text-xs font-medium ${
                    provStatus === 'active' ? 'text-emerald-300' : 'text-amber-300'
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      provStatus === 'active' ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'
                    }`}
                  />
                  {provStatus === 'active' ? 'Active — SMS enabled' : 'Number active — registration pending'}
                </span>
              </div>
            </div>
            <button onClick={copy} className="btn-ghost shrink-0" type="button">
              {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border border-surface-700 bg-surface-800/40 px-3 py-2">
              <span className="text-slate-500">Brand</span>
              <p className={`mt-0.5 font-medium ${brandMeta.text}`}>{brandMeta.label}</p>
            </div>
            <div className="rounded-lg border border-surface-700 bg-surface-800/40 px-3 py-2">
              <span className="text-slate-500">Campaign</span>
              <p className={`mt-0.5 font-medium ${campaignMeta.text}`}>{campaignMeta.label}</p>
            </div>
          </div>
          {provStatus !== 'active' && (
            <button type="button" onClick={onSetup} className="btn-secondary">
              Continue setup
            </button>
          )}
        </div>
      ) : (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-surface-700 bg-surface-800/50 px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-700 text-slate-500">
              <Phone className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-medium text-slate-300">No phone number assigned</p>
              <p className="text-xs text-slate-500">Search by area code and register for US business texting.</p>
            </div>
          </div>
          <button type="button" onClick={onSetup} className="btn-primary shrink-0">
            Set up texting
          </button>
        </div>
      )}
    </div>
  )
}

// ── Live iPhone SMS bubble preview ──────────────────────────────────────────
function PhonePreview({ sender, body }) {
  return (
    <div className="mx-auto w-full max-w-[260px] rounded-[2rem] border border-surface-700 bg-black p-2 shadow-lg">
      <div className="overflow-hidden rounded-[1.6rem] bg-surface-900">
        {/* status bar */}
        <div className="flex items-center justify-between px-4 pt-2 text-[10px] font-semibold text-slate-300">
          <span>9:41</span>
          <span className="flex items-center gap-1">
            <Signal className="h-3 w-3" />
            <Wifi className="h-3 w-3" />
            <BatteryFull className="h-3 w-3" />
          </span>
        </div>
        {/* contact header */}
        <div className="flex flex-col items-center border-b border-surface-800 px-4 pb-2.5 pt-1.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-700 text-xs font-semibold text-slate-200">
            {(sender || '?').slice(0, 1).toUpperCase()}
          </span>
          <span className="mt-1 max-w-full truncate text-xs font-semibold text-slate-200">
            {sender || 'Sender name'}
          </span>
        </div>
        {/* thread */}
        <div className="space-y-2 px-3 py-3">
          <p className="text-center text-[9px] text-slate-600">Text Message · Today 9:41 AM</p>
          <div className="flex">
            <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-surface-700 px-3 py-2 text-[11px] leading-snug text-slate-100">
              {body}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
