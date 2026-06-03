import { useEffect, useState } from 'react'
import {
  X,
  Search,
  Loader2,
  Check,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Clock,
  Phone,
  AlertCircle,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { searchNumbers, purchaseNumber, registerA2P, pollA2PStatus } from '../lib/messaging'

const DEFAULT_SAMPLES = [
  'Hi [name], following up on your implant consult. Any questions about your treatment plan? Reply STOP to opt out.',
]

/**
 * Self-serve phone + A2P wizard (Settings or Agency).
 * onComplete: called when setup finishes or user closes after success.
 */
export default function PhoneSetupWizard({ practiceId, practiceName, onClose, onComplete, embedded = false }) {
  const [step, setStep] = useState(1)
  const [areaCode, setAreaCode] = useState('')
  const [numbers, setNumbers] = useState([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [biz, setBiz] = useState({
    legal_name: practiceName || '',
    business_type: 'LLC',
    ein: '',
    website: '',
    contact_first: '',
    contact_last: '',
    contact_email: '',
    contact_phone: '',
    use_case: 'Post-consult dental implant treatment plan follow-up and scheduling reminders.',
    opt_in_description:
      'Patients provide their mobile number during the in-office consult and agree to receive follow-up texts about their treatment plan.',
    message_samples: DEFAULT_SAMPLES,
  })

  useEffect(() => {
    supabase
      .from('practices')
      .select('name, address, doctor_first, doctor_last, email, phone, twilio_phone_number, a2p_brand_status, a2p_campaign_status')
      .eq('id', practiceId)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return
        const zipMatch = String(data.address || '').match(/\b(\d{5})\b/)
        if (zipMatch) setAreaCode(zipMatch[1].slice(0, 3))
        if (data.twilio_phone_number && data.a2p_brand_status === 'approved') {
          setStep(5)
        } else if (data.twilio_phone_number && (data.a2p_brand_status === 'pending' || data.a2p_campaign_status === 'pending')) {
          setStep(4)
        } else if (data.twilio_phone_number) {
          setStep(3)
        }
        setBiz((b) => ({
          ...b,
          legal_name: data.name || b.legal_name,
          contact_first: data.doctor_first || '',
          contact_last: data.doctor_last || '',
          contact_email: data.email || '',
          contact_phone: data.phone || '',
        }))
      })
  }, [practiceId])

  useEffect(() => {
    if (step !== 4) return
    let active = true
    const tick = async () => {
      try {
        const res = await pollA2PStatus(practiceId)
        if (!active) return
        if (res.brandStatus === 'approved' && res.campaignStatus === 'approved') {
          onComplete?.()
          setStep(5)
        } else if (res.brandStatus === 'failed' || res.campaignStatus === 'failed') {
          setError(res.failureReason || 'Registration was rejected. Update your business info and resubmit.')
        }
      } catch {
        /* polling is best-effort */
      }
    }
    tick()
    const id = setInterval(tick, 15000)
    return () => {
      active = false
      clearInterval(id)
    }
  }, [step, practiceId, onComplete])

  async function doSearch() {
    setError('')
    setSearching(true)
    try {
      setNumbers(await searchNumbers(practiceId, areaCode))
    } catch (e) {
      setError(e.message || 'Search failed')
    } finally {
      setSearching(false)
    }
  }

  async function confirmPurchase() {
    setBusy(true)
    setError('')
    try {
      await purchaseNumber(practiceId, selected.phone_number)
      setStep(3)
    } catch (e) {
      setError(e.message || 'Purchase failed')
    } finally {
      setBusy(false)
    }
  }

  async function submitA2P() {
    setBusy(true)
    setError('')
    try {
      await registerA2P(practiceId, biz)
      setStep(4)
    } catch (e) {
      setError(e.message || 'Registration failed')
    } finally {
      setBusy(false)
    }
  }

  const stepLabels = ['Search', 'Confirm', 'Business info', 'Pending', 'Active']
  const panel = (
    <>
      <div className={`flex items-center justify-between ${embedded ? '' : 'border-b border-surface-700 px-5 py-3.5'}`}>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Phone className="h-4 w-4 text-primary-400" /> Set up texting{practiceName ? ` — ${practiceName}` : ''}
        </h2>
        {onClose && (
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-surface-800 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <div className={embedded ? 'pt-4' : 'max-h-[78vh] overflow-y-auto p-6'}>
        <div className="mb-5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          {stepLabels.map((s, i) => (
            <span key={s} className={`flex items-center gap-1.5 ${step === i + 1 ? 'text-primary-300' : ''}`}>
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                  step > i + 1
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : step === i + 1
                      ? 'bg-primary/20 text-primary-300'
                      : 'bg-surface-800 text-slate-500'
                }`}
              >
                {step > i + 1 ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              {s}
              {i < stepLabels.length - 1 && <span className="text-slate-700">›</span>}
            </span>
          ))}
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {step === 1 && (
          <div>
            <h3 className="text-base font-semibold text-white">Search for a local number</h3>
            <p className="mt-1 text-sm text-slate-400">Pick a US area code near your practice. SMS-capable numbers only.</p>
            <div className="mt-4 flex gap-2">
              <input
                className="input"
                value={areaCode}
                onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, '').slice(0, 3))}
                placeholder="Area code (e.g. 509)"
                maxLength={3}
              />
              <button type="button" onClick={doSearch} disabled={searching || areaCode.length < 3} className="btn-primary shrink-0">
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Search
              </button>
            </div>
            {numbers.length > 0 && (
              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {numbers.map((n) => (
                  <button
                    key={n.phone_number}
                    type="button"
                    onClick={() => {
                      setSelected(n)
                      setStep(2)
                    }}
                    className="flex items-center justify-between rounded-lg border border-surface-700 bg-surface-800/50 px-4 py-3 text-left transition hover:border-primary/40"
                  >
                    <span>
                      <span className="block text-sm font-semibold text-slate-100">{n.friendly_name || n.phone_number}</span>
                      <span className="block text-xs text-slate-500">
                        {[n.locality, n.region].filter(Boolean).join(', ') || 'US local'}
                      </span>
                    </span>
                    <ArrowRight className="h-4 w-4 text-slate-500" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 2 && selected && (
          <div>
            <h3 className="text-base font-semibold text-white">Confirm your number</h3>
            <div className="mt-4 rounded-xl border border-surface-700 bg-surface-800/50 p-5 text-center">
              <p className="text-2xl font-bold text-white">{selected.friendly_name || selected.phone_number}</p>
              <p className="mt-1 text-sm text-slate-400">
                This number will send and receive SMS for {practiceName || 'your practice'}.
              </p>
              <p className="mt-2 text-xs text-amber-300/90">Outbound SMS stays paused until carrier registration (A2P) is approved.</p>
            </div>
            <div className="mt-6 flex items-center justify-between">
              <button type="button" onClick={() => setStep(1)} className="btn-ghost">
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
              <button type="button" onClick={confirmPurchase} disabled={busy} className="btn-primary">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Purchase and continue
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <h3 className="text-base font-semibold text-white">Business information (A2P 10DLC)</h3>
            <p className="mt-1 text-sm text-slate-400">US carriers require this to send business SMS. Pre-filled from your practice profile.</p>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label">Legal business name</label>
                <input className="input" value={biz.legal_name} onChange={(e) => setBiz({ ...biz, legal_name: e.target.value })} />
              </div>
              <div>
                <label className="label">EIN / Tax ID</label>
                <input className="input" value={biz.ein} onChange={(e) => setBiz({ ...biz, ein: e.target.value })} placeholder="12-3456789" />
              </div>
              <div>
                <label className="label">Business type</label>
                <select className="input" value={biz.business_type} onChange={(e) => setBiz({ ...biz, business_type: e.target.value })}>
                  <option>Sole Proprietor</option>
                  <option>LLC</option>
                  <option>Corporation</option>
                  <option>Non-profit</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="label">Website</label>
                <input className="input" value={biz.website} onChange={(e) => setBiz({ ...biz, website: e.target.value })} placeholder="https://" />
              </div>
              <div>
                <label className="label">Contact first name</label>
                <input className="input" value={biz.contact_first} onChange={(e) => setBiz({ ...biz, contact_first: e.target.value })} />
              </div>
              <div>
                <label className="label">Contact last name</label>
                <input className="input" value={biz.contact_last} onChange={(e) => setBiz({ ...biz, contact_last: e.target.value })} />
              </div>
              <div>
                <label className="label">Contact email</label>
                <input className="input" value={biz.contact_email} onChange={(e) => setBiz({ ...biz, contact_email: e.target.value })} />
              </div>
              <div>
                <label className="label">Contact phone</label>
                <input className="input" value={biz.contact_phone} onChange={(e) => setBiz({ ...biz, contact_phone: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="label">How patients opt in</label>
                <textarea
                  className="input min-h-[72px]"
                  rows={2}
                  value={biz.opt_in_description}
                  onChange={(e) => setBiz({ ...biz, opt_in_description: e.target.value })}
                />
              </div>
            </div>
            <div className="mt-6 flex items-center justify-between">
              <button type="button" onClick={() => setStep(2)} className="btn-ghost">
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
              <button type="button" onClick={submitA2P} disabled={busy || !biz.legal_name} className="btn-primary">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Submit registration
              </button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary-300">
              <Clock className="h-7 w-7" />
            </div>
            <h3 className="mt-4 text-lg font-bold text-white">Registration submitted</h3>
            <p className="mt-2 text-sm text-slate-400">
              Your number is active for inbound texts. Outbound sequences unlock when carriers approve your brand and campaign (typically 1–7 business days).
            </p>
            <div className="mx-auto mt-5 max-w-sm space-y-2 text-left text-sm">
              <div className="flex items-center justify-between rounded-lg border border-surface-700 bg-surface-800/50 px-4 py-2.5">
                <span className="text-slate-300">Brand registration</span>
                <span className="text-amber-300">Pending</span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-surface-700 bg-surface-800/50 px-4 py-2.5">
                <span className="text-slate-300">Campaign registration</span>
                <span className="text-amber-300">Pending</span>
              </div>
            </div>
            <button type="button" onClick={onClose} className="btn-secondary mt-6">
              Close — we will email you when approved
            </button>
          </div>
        )}

        {step === 5 && (
          <div className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <h3 className="mt-4 text-lg font-bold text-white">SMS is active</h3>
            <p className="mt-1 text-sm text-slate-400">{practiceName || 'Your practice'} can send and receive patient texts through CaseLift.</p>
            <button
              type="button"
              onClick={() => {
                onComplete?.()
                onClose?.()
              }}
              className="btn-primary mt-6"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </>
  )

  if (embedded) return <div className="rounded-xl border border-surface-700 bg-surface-900/50 p-5">{panel}</div>

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl border border-surface-700 bg-surface-900 shadow-2xl">
        {panel}
      </div>
    </div>
  )
}
