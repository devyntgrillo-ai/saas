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
import { searchNumbers, pollA2PStatus } from '../lib/messaging'
import { usePurchasePhoneNumber, useRegisterA2P } from '../lib/queries'

const DEFAULT_SAMPLES = [
  'Hi [name], following up on your implant consult. Any questions about your treatment plan? Reply STOP to opt out.',
  'Hi [name], just checking in after your visit. Happy to help schedule your next step. Reply STOP to opt out.',
]

/**
 * Self-serve phone + A2P wizard (Settings or Agency).
 * onComplete: called when setup finishes or user closes after success.
 */
export default function PhoneSetupWizard({ practiceId, practiceName, onClose, onComplete, embedded = false }) {
  const [step, setStep] = useState(1)
  const [brandApproved, setBrandApproved] = useState(false)
  const [resubmitMode, setResubmitMode] = useState(false)
  const [failureReason, setFailureReason] = useState('')
  const [pollBrandStatus, setPollBrandStatus] = useState('pending')
  const [pollCampaignStatus, setPollCampaignStatus] = useState('unregistered')
  const [areaCode, setAreaCode] = useState('')
  const [numbers, setNumbers] = useState([])
  const [searched, setSearched] = useState(false)
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState(null)
  const purchaseMutation = usePurchasePhoneNumber()
  const registerA2PMutation = useRegisterA2P()
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
    address_street: '',
    address_city: '',
    address_region: '',
    address_postal: '',
    use_case: 'Post-consult dental implant treatment plan follow-up and scheduling reminders.',
    opt_in_description:
      'Patients provide their mobile number during the in-office consult and agree to receive follow-up texts about their treatment plan.',
    message_samples: DEFAULT_SAMPLES,
  })

  useEffect(() => {
    supabase
      .from('practices')
      .select(
        'name, address, doctor_first, doctor_last, email, phone, twilio_phone_number, a2p_brand_status, a2p_campaign_status, a2p_failure_reason, a2p_config',
      )
      .eq('id', practiceId)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return
        const cfg = data.a2p_config && typeof data.a2p_config === 'object' ? data.a2p_config : {}
        const addr = String(data.address || cfg.address_street || '')
        const zipMatch = addr.match(/\b(\d{5})(?:-\d{4})?\b/)
        if (zipMatch) setAreaCode(zipMatch[1].slice(0, 3))
        const brandOk = data.a2p_brand_status === 'approved'
        const campaignOk = data.a2p_campaign_status === 'approved'
        const failed = data.a2p_brand_status === 'failed' || data.a2p_campaign_status === 'failed'
        setBrandApproved(brandOk)
        setResubmitMode(failed)
        setFailureReason(data.a2p_failure_reason || '')
        if (data.twilio_phone_number && brandOk && campaignOk) {
          setStep(5)
        } else if (
          data.twilio_phone_number &&
          (data.a2p_brand_status === 'pending' ||
            data.a2p_campaign_status === 'pending' ||
            (data.a2p_brand_status === 'approved' && data.a2p_campaign_status !== 'approved'))
        ) {
          setStep(4)
        } else if (data.twilio_phone_number) {
          // number_only, campaign_needed, failed, or partial, business info + register/resubmit
          setStep(3)
        }
        const stateMatch = addr.match(/\b([A-Z]{2})\s+\d{5}\b/)
        const cityMatch = addr.match(/,\s*([^,]+),\s*[A-Z]{2}\s+\d{5}/)
        setBiz((b) => ({
          ...b,
          legal_name: cfg.legal_name || data.name || b.legal_name,
          business_type: cfg.business_type || b.business_type,
          ein: cfg.ein || b.ein,
          website: cfg.website || b.website,
          contact_first: cfg.contact_first || data.doctor_first || '',
          contact_last: cfg.contact_last || data.doctor_last || '',
          contact_email: cfg.contact_email || data.email || '',
          contact_phone: cfg.contact_phone || data.phone || '',
          address_street: cfg.address_street || addr.split(',')[0]?.trim() || b.address_street,
          address_city: cfg.address_city || cityMatch?.[1]?.trim() || b.address_city,
          address_postal: cfg.address_postal || zipMatch?.[1] || b.address_postal,
          address_region: cfg.address_region || stateMatch?.[1] || b.address_region,
          use_case: cfg.use_case || b.use_case,
          opt_in_description: cfg.opt_in_description || b.opt_in_description,
          message_samples: cfg.message_samples?.length ? cfg.message_samples : b.message_samples,
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
        setPollBrandStatus(res.brandStatus || 'pending')
        setPollCampaignStatus(res.campaignStatus || 'unregistered')
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
    setSearched(true)
    try {
      setNumbers(await searchNumbers(practiceId, areaCode))
    } catch (e) {
      setNumbers([])
      setError(e.message || 'Search failed')
    } finally {
      setSearching(false)
    }
  }

  async function confirmPurchase() {
    setError('')
    try {
      await purchaseMutation.mutateAsync({ practiceId, phoneNumber: selected.phone_number })
      setStep(3)
    } catch (e) {
      setError(e.message || 'Purchase failed')
    }
  }

  async function submitA2P() {
    setError('')
    try {
      await registerA2PMutation.mutateAsync({ practiceId, business: biz })
      setStep(4)
    } catch (e) {
      setError(e.message || 'Registration failed')
    }
  }

  const busy = purchaseMutation.isPending || registerA2PMutation.isPending

  const stepLabels = ['Search', 'Confirm', 'Business info', 'Pending', 'Active']
  const panel = (
    <>
      <div className={`flex items-center justify-between ${embedded ? '' : 'border-b border-surface-700 px-5 py-3.5'}`}>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Phone className="h-4 w-4 text-primary-400" /> Set up texting{practiceName ? `, ${practiceName}` : ''}
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
            {searched && !searching && numbers.length === 0 && (
              <p className="mt-4 rounded-lg border border-surface-700 bg-surface-800/50 px-4 py-3 text-sm text-slate-400">
                No SMS-capable numbers in area code {areaCode} right now. Try a nearby code (e.g. 737 for Austin, 210 for San Antonio) or search again in a few minutes.
              </p>
            )}
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
            <h3 className="text-base font-semibold text-white">
              {resubmitMode
                ? brandApproved
                  ? 'Correct campaign registration'
                  : 'Correct registration details'
                : brandApproved
                  ? 'Campaign registration (A2P 10DLC)'
                  : 'Business information (A2P 10DLC)'}
            </h3>
            <p className="mt-1 text-sm text-slate-400">
              {resubmitMode
                ? 'Review and update the details below to fix the rejection, then resubmit for carrier review.'
                : brandApproved
                  ? 'Your brand is already approved. Confirm business details and register the messaging campaign for your practice number.'
                  : 'US carriers require this to send business SMS. Pre-filled from your practice profile.'}
            </p>
            {resubmitMode && failureReason && (
              <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-200">
                <p className="font-medium text-rose-300">Rejection reason</p>
                <p className="mt-1 leading-relaxed">{failureReason}</p>
              </div>
            )}
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
                <input className="input" value={biz.website} onChange={(e) => setBiz({ ...biz, website: e.target.value })} placeholder="https://yourpractice.com" />
                <p className="mt-1 text-xs text-slate-500">
                  Must match your registered brand and appear in your campaign opt-in description. Use your practice&apos;s live business site.
                </p>
              </div>
              <div className="sm:col-span-2">
                <label className="label">Business street address</label>
                <input
                  className="input"
                  value={biz.address_street}
                  onChange={(e) => setBiz({ ...biz, address_street: e.target.value })}
                  placeholder="123 Main St"
                />
              </div>
              <div>
                <label className="label">City</label>
                <input
                  className="input"
                  value={biz.address_city}
                  onChange={(e) => setBiz({ ...biz, address_city: e.target.value })}
                />
              </div>
              <div>
                <label className="label">State</label>
                <input
                  className="input"
                  maxLength={2}
                  value={biz.address_region}
                  onChange={(e) => setBiz({ ...biz, address_region: e.target.value.toUpperCase() })}
                  placeholder="TX"
                />
              </div>
              <div>
                <label className="label">ZIP</label>
                <input
                  className="input"
                  value={biz.address_postal}
                  onChange={(e) => setBiz({ ...biz, address_postal: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                  placeholder="78701"
                />
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
                <label className="label">Campaign description</label>
                <textarea
                  className="input min-h-[72px]"
                  rows={2}
                  value={biz.use_case}
                  onChange={(e) => setBiz({ ...biz, use_case: e.target.value })}
                  placeholder="Post-consult dental implant treatment plan follow-up and scheduling reminders."
                />
                <p className="mt-1 text-xs text-slate-500">Describe who receives messages and why (min 40 characters).</p>
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
              <div className="sm:col-span-2">
                <label className="label">Sample message 1</label>
                <textarea
                  className="input min-h-[64px]"
                  rows={2}
                  value={biz.message_samples?.[0] || ''}
                  onChange={(e) => {
                    const samples = [...(biz.message_samples || DEFAULT_SAMPLES)]
                    samples[0] = e.target.value
                    setBiz({ ...biz, message_samples: samples })
                  }}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Sample message 2</label>
                <textarea
                  className="input min-h-[64px]"
                  rows={2}
                  value={biz.message_samples?.[1] || ''}
                  onChange={(e) => {
                    const samples = [...(biz.message_samples || DEFAULT_SAMPLES)]
                    samples[1] = e.target.value
                    setBiz({ ...biz, message_samples: samples })
                  }}
                />
                <p className="mt-1 text-xs text-slate-500">
                  Include your practice name and &quot;Reply STOP to opt out&quot; in each sample.
                </p>
              </div>
            </div>
            <div className="mt-6 flex items-center justify-between">
              {brandApproved ? (
                <span />
              ) : (
                <button type="button" onClick={() => setStep(2)} className="btn-ghost">
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>
              )}
              <button
                type="button"
                onClick={submitA2P}
                disabled={
                  busy ||
                  !biz.legal_name ||
                  !biz.ein ||
                  !biz.website ||
                  !biz.address_street ||
                  !biz.address_city ||
                  !biz.address_region ||
                  !biz.address_postal ||
                  !(biz.message_samples?.[0]?.trim() && biz.message_samples?.[1]?.trim())
                }
                className="btn-primary"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{' '}
                {resubmitMode
                  ? 'Resubmit registration'
                  : brandApproved
                    ? 'Register campaign'
                    : 'Submit registration'}
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
              Two-way texting isn&apos;t available yet. Outbound sequences and inbound patient replies unlock when carriers approve your brand and campaign (typically 1–7 business days).
            </p>
            <div className="mx-auto mt-5 max-w-sm space-y-2 text-left text-sm">
              <div className="flex items-center justify-between rounded-lg border border-surface-700 bg-surface-800/50 px-4 py-2.5">
                <span className="text-slate-300">Brand registration</span>
                <span className={pollBrandStatus === 'approved' ? 'text-emerald-300' : 'text-amber-300'}>
                  {pollBrandStatus === 'approved' ? 'Approved' : 'Pending'}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-surface-700 bg-surface-800/50 px-4 py-2.5">
                <span className="text-slate-300">Campaign registration</span>
                <span
                  className={
                    pollCampaignStatus === 'approved'
                      ? 'text-emerald-300'
                      : pollCampaignStatus === 'pending'
                        ? 'text-amber-300'
                        : 'text-slate-500'
                  }
                >
                  {pollCampaignStatus === 'approved'
                    ? 'Approved'
                    : pollCampaignStatus === 'pending'
                      ? 'Pending'
                      : pollBrandStatus === 'approved'
                        ? 'Submitting…'
                        : 'Waiting on brand'}
                </span>
              </div>
            </div>
            <button type="button" onClick={onClose} className="btn-secondary mt-6">
              Close, we will email you when approved
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
