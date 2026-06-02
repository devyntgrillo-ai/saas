import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import {
  Rocket,
  Building2,
  Loader2,
  Check,
  Copy,
  ExternalLink,
  Link2,
  Users,
  DollarSign,
  TrendingUp,
  AlertCircle,
} from 'lucide-react'
import AgencyTabs from '../components/AgencyTabs'
import StatCard from '../components/StatCard'
import { Skeleton } from '../components/Skeleton'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import {
  WHOLESALE_PRICE,
  MIN_CLIENT_PRICE,
  MAX_TRIAL_DAYS,
  economics,
  annualPrice,
  slugify,
  isValidSlug,
  isActiveSubaccount,
  money,
} from '../lib/resellerSaas'
import { trialDaysRemaining } from '../lib/billing'

const STATUS_BADGE = {
  trial: 'bg-sky-500/15 text-sky-300',
  active: 'bg-emerald-500/15 text-emerald-300',
  trialing: 'bg-sky-500/15 text-sky-300',
  past_due: 'bg-amber-500/15 text-amber-300',
  paused: 'bg-indigo-500/15 text-indigo-300',
  cancelled: 'bg-rose-500/15 text-rose-300',
  canceled: 'bg-rose-500/15 text-rose-300',
}
const statusLabel = (s) => (s === 'trialing' ? 'Trial' : (s || 'active').replace(/_/g, ' '))

export default function AgencySaaSMode() {
  const { agency, isAgencyUser, agencyLoading, refreshAgency } = useAuth()

  // --- Plan form, seeded from the reseller record ------------------------------
  const [price, setPrice] = useState('')
  const [annual, setAnnual] = useState(false)
  const [trialEnabled, setTrialEnabled] = useState(false)
  const [trialDays, setTrialDays] = useState(14)
  const [slug, setSlug] = useState('')
  const [seeded, setSeeded] = useState(false)

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!agency || seeded) return
    // Seed the editable form once from the loaded reseller record.
    /* eslint-disable react-hooks/set-state-in-effect */
    setPrice(agency.reseller_client_price != null ? String(agency.reseller_client_price) : '')
    setAnnual(Boolean(agency.reseller_annual_enabled))
    setTrialEnabled(Boolean(agency.reseller_trial_enabled))
    setTrialDays(Number(agency.reseller_trial_days) > 0 ? Number(agency.reseller_trial_days) : 14)
    setSlug(agency.reseller_slug || slugify(agency.company_name || agency.brand_name || agency.name || ''))
    setSeeded(true)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [agency, seeded])

  // --- Client subaccounts ------------------------------------------------------
  const [clients, setClients] = useState([])
  const [clientsLoading, setClientsLoading] = useState(true)

  useEffect(() => {
    if (!agency?.id) return
    let active = true
    ;(async () => {
      const { data } = await supabase
        .from('practices')
        .select('id, name, created_at, subscription_status, trial_ends_at')
        .eq('agency_id', agency.id)
        .order('created_at', { ascending: false })
      if (!active) return
      setClients(data || [])
      setClientsLoading(false)
    })()
    return () => {
      active = false
    }
  }, [agency?.id])

  // --- Derived -----------------------------------------------------------------
  const priceNum = Number(price) || 0
  const priceError = price !== '' && priceNum < MIN_CLIENT_PRICE
  const slugError = slug !== '' && !isValidSlug(slug)
  const econ = economics({ clientPrice: priceNum, activeCount: clients.filter((c) => isActiveSubaccount(c.subscription_status)).length })
  const activeCount = clients.filter((c) => isActiveSubaccount(c.subscription_status)).length

  const canSave = priceNum >= MIN_CLIENT_PRICE && isValidSlug(slug) && !saving

  const signupHost = typeof window !== 'undefined' ? window.location.host : 'hopeai.com'
  const signupPath = `/signup/${slug}`

  async function save() {
    if (!canSave || !agency?.id) return
    setSaving(true)
    setSaved(false)
    setError('')
    const payload = {
      reseller_client_price: priceNum,
      reseller_annual_enabled: annual,
      reseller_trial_enabled: trialEnabled,
      reseller_trial_days: trialEnabled ? Math.min(MAX_TRIAL_DAYS, Math.max(0, Number(trialDays) || 0)) : 0,
      reseller_slug: slug,
    }
    const { error: err } = await supabase.from('agency_accounts').update(payload).eq('id', agency.id)
    if (err) {
      const dup = err.code === '23505' || /duplicate|unique/i.test(err.message || '')
      setError(dup ? 'That signup URL is already taken — try another slug.' : err.message || 'Could not save your plan.')
      setSaving(false)
      return
    }
    await refreshAgency()
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  function copyUrl() {
    try {
      navigator.clipboard.writeText(`${window.location.origin}${signupPath}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard unavailable */
    }
  }

  if (!agencyLoading && !isAgencyUser) return <Navigate to="/" replace />

  const companyName = agency?.company_name || agency?.brand_name || agency?.name || 'your company'

  return (
    <div className="space-y-6">
      {/* Header + tabs */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary-400">
          <Rocket className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">SaaS Mode</h1>
          <p className="text-sm text-slate-400">Configure your plan, set your pricing, and start onboarding clients.</p>
        </div>
      </div>

      <AgencyTabs />

      {agencyLoading || !seeded ? (
        <div className="space-y-4">
          <Skeleton className="h-64" />
          <Skeleton className="h-40" />
        </div>
      ) : (
        <>
          {/* ── SECTION 1 — Your Plan Setup ─────────────────────────────── */}
          <section className="card p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-white">Your Reseller Plan</h2>
                <p className="mt-0.5 text-sm text-slate-400">Set what you charge clients. Hope AI bills you {money(WHOLESALE_PRICE)}/mo per active client.</p>
              </div>
            </div>

            <div className="mt-6 grid gap-6 md:grid-cols-2">
              {/* Price */}
              <div>
                <label className="label" htmlFor="price">Your price to clients</label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                  <input
                    id="price"
                    type="number"
                    min={MIN_CLIENT_PRICE}
                    className="input pl-7 pr-16"
                    placeholder="497"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">/month</span>
                </div>
                {priceError ? (
                  <p className="mt-1.5 flex items-center gap-1.5 text-sm text-rose-300">
                    <AlertCircle className="h-3.5 w-3.5" /> Minimum price is {money(MIN_CLIENT_PRICE)}/month — our wholesale cost is {money(WHOLESALE_PRICE)}/month.
                  </p>
                ) : (
                  <p className="mt-1.5 text-xs text-slate-500">Minimum {money(MIN_CLIENT_PRICE)}/month.</p>
                )}
              </div>

              {/* Trial */}
              <div>
                <label className="label">Free trial</label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={trialEnabled}
                    onClick={() => setTrialEnabled((v) => !v)}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition ${trialEnabled ? 'bg-primary' : 'bg-surface-600'}`}
                  >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${trialEnabled ? 'left-[22px]' : 'left-0.5'}`} />
                  </button>
                  <input
                    type="number"
                    min={0}
                    max={MAX_TRIAL_DAYS}
                    disabled={!trialEnabled}
                    className="input w-24 disabled:opacity-40"
                    value={trialDays}
                    onChange={(e) => setTrialDays(e.target.value)}
                  />
                  <span className="text-sm text-slate-400">days {trialEnabled ? '(no card required)' : 'trial off'}</span>
                </div>
                <p className="mt-1.5 text-xs text-slate-500">Up to {MAX_TRIAL_DAYS} days. Clients get full access during the trial.</p>
              </div>

              {/* Annual */}
              <div>
                <label className="label">Annual pricing</label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={annual}
                    onClick={() => setAnnual((v) => !v)}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition ${annual ? 'bg-primary' : 'bg-surface-600'}`}
                  >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${annual ? 'left-[22px]' : 'left-0.5'}`} />
                  </button>
                  <span className="text-sm text-slate-400">
                    {annual && priceNum
                      ? <>Offer annual at <span className="font-semibold text-slate-200">{money(annualPrice(priceNum))}/yr</span> (10% off)</>
                      : 'Auto-calculate a 10% annual discount'}
                  </span>
                </div>
              </div>

              {/* Slug */}
              <div>
                <label className="label" htmlFor="slug">Your signup URL slug</label>
                <div className="flex items-center gap-2">
                  <input
                    id="slug"
                    className="input"
                    placeholder="northwest-implant"
                    value={slug}
                    onChange={(e) => setSlug(slugify(e.target.value))}
                  />
                  <button
                    type="button"
                    onClick={() => setSlug(slugify(companyName))}
                    className="btn-ghost shrink-0 whitespace-nowrap text-xs"
                  >
                    Generate
                  </button>
                </div>
                {slugError && <p className="mt-1.5 text-sm text-rose-300">Use 3–40 lowercase letters, numbers, and hyphens.</p>}
              </div>
            </div>

            {/* Live margin */}
            <div className="mt-6 rounded-xl border border-primary/20 bg-primary/[0.06] p-4">
              <p className="text-sm text-slate-300">
                You collect <span className="font-semibold text-white">{money(priceNum)}/month</span>
                {' · '}Hope AI charges you <span className="font-semibold text-white">{money(WHOLESALE_PRICE)}/month</span>
                {' · '}Your margin:{' '}
                <span className={`font-semibold ${econ.perClientMargin >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {money(econ.perClientMargin)}/month per client
                </span>
              </p>
            </div>

            {error && (
              <p className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>
            )}

            <div className="mt-5 flex items-center gap-3">
              <button onClick={save} disabled={!canSave} className="btn-primary">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Save Plan
              </button>
              {saved && <span className="flex items-center gap-1.5 text-sm text-emerald-300"><Check className="h-4 w-4" /> Saved</span>}
            </div>
          </section>

          {/* ── SECTION 2 — Your Signup Page ────────────────────────────── */}
          <section className="card p-6">
            <h2 className="text-base font-semibold text-white">Your Signup Page</h2>
            <p className="mt-0.5 text-sm text-slate-400">Share this white-labeled link. Clients sign up and their account is created instantly.</p>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <div className="flex flex-1 items-center gap-2 rounded-lg border border-surface-700 bg-surface-900 px-3 py-2.5 text-sm">
                <Link2 className="h-4 w-4 shrink-0 text-slate-500" />
                <span className="truncate text-slate-200">{signupHost}{signupPath}</span>
              </div>
              <button onClick={copyUrl} disabled={!isValidSlug(slug)} className="btn-ghost disabled:opacity-40">
                {copied ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <a
                href={signupPath}
                target="_blank"
                rel="noreferrer"
                className={`btn-ghost ${!isValidSlug(slug) || agency?.reseller_slug !== slug ? 'pointer-events-none opacity-40' : ''}`}
                title={agency?.reseller_slug !== slug ? 'Save your plan first' : 'Preview signup page'}
              >
                <ExternalLink className="h-4 w-4" /> Preview
              </a>
            </div>

            <ul className="mt-4 space-y-1.5 text-sm text-slate-400">
              <li>• Shows your white-label brand (logo, color, company name)</li>
              <li>• Client enters name, email, practice name, phone</li>
              <li>• {trialEnabled ? `"Start your ${trialDays}-day free trial"` : `"Get started for ${money(priceNum)}/month"`}</li>
              <li>• Payment collected by <span className="text-slate-200">{companyName}</span></li>
              <li>• On submit, the practice subaccount is created and they can log in immediately</li>
            </ul>
            {agency?.reseller_slug !== slug && (
              <p className="mt-3 text-xs text-amber-300/80">Save your plan to activate this signup URL.</p>
            )}
          </section>

          {/* ── SECTION 3 — Active Clients Overview ─────────────────────── */}
          <section className="space-y-4">
            <h2 className="text-base font-semibold text-white">Active Clients</h2>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Active clients" value={activeCount} icon={Users} accent="primary" />
              <StatCard label="Your monthly revenue" value={money(econ.gross)} icon={DollarSign} accent="green" hint={`${activeCount} × ${money(priceNum)}`} />
              <StatCard label="Cost to Hope AI" value={money(econ.wholesale)} icon={Building2} accent="violet" hint={`${activeCount} × ${money(WHOLESALE_PRICE)}`} />
              <StatCard label="Your net margin" value={money(econ.margin)} icon={TrendingUp} accent="green" />
            </div>

            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-surface-700 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <th className="px-5 py-3">Client</th>
                      <th className="px-5 py-3">Joined</th>
                      <th className="px-5 py-3">Status</th>
                      <th className="px-5 py-3">Trial remaining</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-700">
                    {clientsLoading ? (
                      <tr><td colSpan={4} className="px-5 py-10 text-center text-slate-500"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
                    ) : clients.length === 0 ? (
                      <tr><td colSpan={4} className="px-5 py-12 text-center text-sm text-slate-400">No clients yet. Share your signup link to onboard your first practice.</td></tr>
                    ) : (
                      clients.map((c) => {
                        const days = c.subscription_status === 'trial' || c.subscription_status === 'trialing' ? trialDaysRemaining(c) : null
                        return (
                          <tr key={c.id} className="text-slate-300">
                            <td className="px-5 py-3.5 font-medium text-slate-100">{c.name}</td>
                            <td className="px-5 py-3.5">{c.created_at ? new Date(c.created_at).toLocaleDateString() : '—'}</td>
                            <td className="px-5 py-3.5">
                              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_BADGE[c.subscription_status] || 'bg-surface-700 text-slate-300'}`}>
                                {statusLabel(c.subscription_status)}
                              </span>
                            </td>
                            <td className="px-5 py-3.5">{days != null ? `${days} day${days === 1 ? '' : 's'}` : '—'}</td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
