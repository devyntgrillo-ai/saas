import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Building2,
  Plug,
  Bell,
  CreditCard,
  Check,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  ScrollText,
  ShieldCheck,
  Users,
  Trash2,
  Plus,
  Mail,
  Phone,
  Sun,
  Moon,
  BookOpen,
  Gift,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/consults'
import KnowledgeBase from './KnowledgeBase'
import AuditLog from './AuditLog'
import PMSIntegration from './PMSIntegration'
import PhoneMessaging from './PhoneMessaging'
import Integrations from './Integrations'
import NotificationSettings from './NotificationSettings'
import ReferralsPanel from './Referrals'
import CancellationFlow from '../components/CancellationFlow'
import InviteModal from '../components/InviteModal'
import { usePermissions, ACCESS_LABELS } from '../lib/permissions'
import { TREATMENT_TYPES } from '../lib/treatments'
import {
  PLAN_NAME,
  PLAN_PRICE,
  statusMeta as subStatusMeta,
  trialDaysRemaining,
  isTrialExpired,
  createCheckout,
  getBillingStatus,
  createPortalSession,
} from '../lib/billing'

const TABS = [
  { key: 'profile', label: 'Practice Profile', icon: Building2 },
  { key: 'integrations', label: 'Integrations', icon: Plug },
  { key: 'team', label: 'Team', icon: Users },
  { key: 'knowledge-base', label: 'Knowledge Base', icon: BookOpen },
  { key: 'notifications', label: 'Notifications', icon: Bell },
  // Only for direct (non-reseller) practices - filtered out below when agency_id is set.
  { key: 'referrals', label: 'Referrals', icon: Gift, directOnly: true },
  { key: 'billing', label: 'Billing', icon: CreditCard },
  { key: 'audit-log', label: 'Audit Log', icon: ScrollText, adminOnly: true },
  // Reachable via Integrations cards / deep links, hidden from the tab rail.
  { key: 'pms', label: 'PMS Integration', icon: Plug, hidden: true },
  { key: 'phone', label: 'Phone & Messaging', icon: Phone, hidden: true },
]

function StatusBadge({ connected }) {
  return connected ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
      <CheckCircle2 className="h-3.5 w-3.5" /> Connected
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-500/15 px-2.5 py-0.5 text-xs font-medium text-slate-300">
      <AlertCircle className="h-3.5 w-3.5" /> Not connected
    </span>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  )
}

const TAB_KEYS = TABS.map((t) => t.key)

export default function Settings() {
  const { practice, profile, profileLoading, refreshProfile } = useAuth()
  const perms = usePermissions()
  const isAdmin = ['owner', 'admin'].includes(profile?.role) || perms.isSuperAdmin
  const visibleTabs = TABS.filter((t) => {
    if (t.hidden) return false
    if (t.adminOnly && !isAdmin) return false
    if (t.key === 'billing' && !perms.canViewBilling) return false
    // Reseller-onboarded practices refer through their reseller, not directly.
    if (t.directOnly && practice?.agency_id) return false
    return true
  })
  const navigate = useNavigate()
  const { tab: tabParam } = useParams()
  const tab = TAB_KEYS.includes(tabParam) ? tabParam : 'profile'
  const setTab = (key) => navigate(key === 'profile' ? '/settings' : `/settings/${key}`)

  // The Recording tab was merged into Integrations - keep old links working.
  useEffect(() => {
    if (tabParam === 'recording') navigate('/settings/integrations', { replace: true })
  }, [tabParam, navigate])
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState('')
  const [showCancel, setShowCancel] = useState(false)

  // Billing
  const [searchParams, setSearchParams] = useSearchParams()
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [checkoutError, setCheckoutError] = useState('')
  const [showSuccess, setShowSuccess] = useState(false)

  // After returning from a Chargebee checkout, the webhook updates the
  // practice asynchronously - refresh the profile and surface a confirmation.
  useEffect(() => {
    if (searchParams.get('success') === 'true') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowSuccess(true)
      refreshProfile()
      const next = new URLSearchParams(searchParams)
      next.delete('success')
      setSearchParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function startCheckout() {
    if (!practice?.id) return
    setCheckoutError('')
    setCheckoutLoading(true)
    try {
      const { url } = await createCheckout({ practiceId: practice.id, email: practice.email })
      window.location.href = url
    } catch (e) {
      const msg = e?.message || ''
      setCheckoutError(
        /chargebee|not configured/i.test(msg)
          ? 'Online checkout isn’t available yet - billing isn’t fully configured. Please contact support@caselift.io.'
          : msg || 'Could not start checkout. Please try again.',
      )
      setCheckoutLoading(false)
    }
  }

  // Seed the local form once the practice loads.
  useEffect(() => {
    if (practice) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm({
        name: practice.name || '',
        doctor_first: practice.doctor_first || '',
        doctor_last: practice.doctor_last || '',
        phone: practice.phone || '',
        email: practice.email || '',
        address: practice.address || practice.location || '',
        ghl_subaccount_id: practice.ghl_subaccount_id || '',
        ghl_api_key: practice.ghl_api_key || '',
        notify_slack: practice.notify_slack ?? true,
        notify_email: practice.notify_email ?? true,
        notify_sms: practice.notify_sms ?? false,
        recording_method: practice.recording_method || 'browser',
        audio_quality: practice.audio_quality || 'standard',
        auto_analyze: practice.auto_analyze ?? true,
        auto_start_followup: practice.auto_start_followup ?? false,
        timezone: practice.timezone || 'America/Chicago',
      })
    }
  }, [practice])

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))

  async function save(patch, flash = 'Saved') {
    if (!practice?.id) return
    setSaving(true)
    const { error } = await supabase.from('practices').update(patch).eq('id', practice.id)
    setSaving(false)
    if (!error) {
      setSavedFlash(flash)
      setTimeout(() => setSavedFlash(''), 2500)
      await refreshProfile()
    }
    return error
  }

  if (profileLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-surface-700 border-t-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">CaseLift Settings</h1>
          <p className="mt-1 text-sm text-slate-400">
            Practice profile, integrations, notifications, and billing.
          </p>
        </div>
        {savedFlash && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-300">
            <Check className="h-3.5 w-3.5" /> {savedFlash}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Tab rail */}
        <nav className="-mx-1 flex shrink-0 gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:w-56 lg:flex-col lg:px-0 lg:pb-0">
          {visibleTabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={[
                'flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium transition',
                tab === key
                  ? 'bg-primary/10 text-primary-300'
                  : 'text-slate-400 hover:bg-surface-800 hover:text-slate-100',
              ].join(' ')}
            >
              <Icon className="h-[18px] w-[18px]" />
              {label}
            </button>
          ))}
          <HipaaBadge />
        </nav>

        {/* Panel */}
        <div className="min-w-0 flex-1">
          {/* Practice Profile */}
          {tab === 'profile' && (
            <div className="space-y-6">
            <div className="card p-6">
              <h2 className="text-base font-semibold text-white">Practice Profile</h2>
              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Field label="Practice name">
                    <input className="input" value={form.name || ''} onChange={(e) => set('name', e.target.value)} />
                  </Field>
                </div>
                <Field label="Doctor first name">
                  <input className="input" value={form.doctor_first || ''} onChange={(e) => set('doctor_first', e.target.value)} />
                </Field>
                <Field label="Doctor last name">
                  <input className="input" value={form.doctor_last || ''} onChange={(e) => set('doctor_last', e.target.value)} />
                </Field>
                <Field label="Phone">
                  <input className="input" value={form.phone || ''} onChange={(e) => set('phone', e.target.value)} placeholder="(512) 555-0142" />
                </Field>
                <Field label="Email">
                  <input className="input" type="email" value={form.email || ''} onChange={(e) => set('email', e.target.value)} placeholder="frontdesk@practice.com" />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Address">
                    <input className="input" value={form.address || ''} onChange={(e) => set('address', e.target.value)} placeholder="123 Main St, Austin, TX 78701" />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="Timezone (follow-up quiet hours)">
                    <select className="input" value={form.timezone || 'America/Chicago'} onChange={(e) => set('timezone', e.target.value)}>
                      <option value="America/New_York">Eastern</option>
                      <option value="America/Chicago">Central</option>
                      <option value="America/Denver">Mountain</option>
                      <option value="America/Los_Angeles">Pacific</option>
                      <option value="America/Phoenix">Arizona</option>
                      <option value="America/Anchorage">Alaska</option>
                      <option value="Pacific/Honolulu">Hawaii</option>
                    </select>
                  </Field>
                </div>
              </div>
              <div className="mt-6 flex justify-end">
                <button
                  onClick={() =>
                    save({
                      name: form.name,
                      doctor_first: form.doctor_first,
                      doctor_last: form.doctor_last,
                      phone: form.phone,
                      email: form.email,
                      address: form.address,
                      timezone: form.timezone,
                    })
                  }
                  disabled={saving}
                  className="btn-primary"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save changes
                </button>
              </div>
            </div>
            <TreatmentDefaultsCard practice={practice} onSave={save} saving={saving} />
            <AppearanceCard />
            </div>
          )}

          {/* Knowledge Base */}
          {tab === 'knowledge-base' && <KnowledgeBase />}

          {/* Integrations hub */}
          {tab === 'integrations' && <Integrations />}

          {/* PMS Integration (deep-linked from Integrations) */}
          {tab === 'pms' && <PMSIntegration />}

          {/* Phone & Messaging (deep-linked from Integrations) */}
          {tab === 'phone' && <PhoneMessaging />}

          {/* GHL Integration */}
          {tab === 'ghl' && (
            <div className="card p-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-white">GoHighLevel Integration</h2>
                <StatusBadge connected={Boolean(practice?.ghl_subaccount_id && practice?.ghl_api_key)} />
              </div>
              <p className="mt-2 text-sm text-slate-400">
                Connect your GoHighLevel sub-account so follow-up SMS and email send through your own
                numbers and domains.
              </p>

              <div className="mt-5 space-y-4">
                <Field label="GHL Sub-account ID">
                  <input
                    className="input"
                    value={form.ghl_subaccount_id || ''}
                    onChange={(e) => set('ghl_subaccount_id', e.target.value)}
                    placeholder="e.g. 7sNc8aBvK2..."
                  />
                </Field>
                <Field label="GHL API Key">
                  <input
                    className="input"
                    type="password"
                    value={form.ghl_api_key || ''}
                    onChange={(e) => set('ghl_api_key', e.target.value)}
                    placeholder="••••••••••••••••"
                  />
                </Field>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={() =>
                    save(
                      { ghl_subaccount_id: form.ghl_subaccount_id, ghl_api_key: form.ghl_api_key },
                      'GHL saved'
                    )
                  }
                  disabled={saving}
                  className="btn-primary"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save &amp; connect
                </button>
              </div>
            </div>
          )}

          {/* Notifications */}
          {tab === 'notifications' && <NotificationSettings />}

          {/* Referrals (direct practices only) */}
          {tab === 'referrals' &&
            (practice?.agency_id ? (
              <Navigate to="/settings" replace />
            ) : (
              <ReferralsPanel practice={practice} />
            ))}

          {/* Team */}
          {tab === 'team' && <PracticeTeamPanel practice={practice} />}

          {/* Billing */}
          {tab === 'billing' && (
            <BillingPanel
              practice={practice}
              showSuccess={showSuccess}
              checkoutLoading={checkoutLoading}
              checkoutError={checkoutError}
              onActivate={startCheckout}
              onCancel={() => setShowCancel(true)}
              onResume={() => save({ subscription_status: 'active', pause_ends_at: null }, 'Subscription resumed')}
            />
          )}

          {/* Audit Log (admin only) */}
          {tab === 'audit-log' && <AuditLog />}
        </div>
      </div>

      {showCancel && <CancellationFlow onClose={() => setShowCancel(false)} />}
    </div>
  )
}

// Static, non-interactive compliance label at the bottom of the settings nav.
// Not a nav item: no hover, no click, no expansion.
function HipaaBadge() {
  return (
    <div className="flex shrink-0 items-center gap-1.5 px-3 py-2 text-xs font-normal text-slate-500 lg:mt-2 lg:border-t lg:border-surface-700 lg:pt-3">
      <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
      CaseLift is HIPAA Compliant
    </div>
  )
}

// Appearance - light/dark theme toggle (mirrors the sidebar control).
function AppearanceCard() {
  const { isLight, toggleTheme } = useTheme()
  return (
    <div className="card p-6">
      <h2 className="text-base font-semibold text-white">Appearance</h2>
      <p className="mt-2 text-sm text-slate-400">Choose how CaseLift looks on this device.</p>
      <div className="mt-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-200">Theme</p>
          <p className="text-xs text-slate-500">{isLight ? 'Light mode' : 'Dark mode'}</p>
        </div>
        <button
          type="button"
          onClick={toggleTheme}
          title={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
          aria-label={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
          className="btn-ghost"
        >
          {isLight ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {isLight ? 'Light' : 'Dark'}
        </button>
      </div>
    </div>
  )
}

// Per-treatment fallback values used when the PMS doesn't supply an actual
// treatment-plan value. Persisted as a JSONB object on practices.treatment_defaults,
// keyed by treatment value (e.g. { dental_implants: 28000 }).
function TreatmentDefaultsCard({ practice, onSave, saving }) {
  const [values, setValues] = useState({})

  useEffect(() => {
    const defaults =
      practice?.treatment_defaults && typeof practice.treatment_defaults === 'object'
        ? practice.treatment_defaults
        : {}
    const next = {}
    for (const type of TREATMENT_TYPES) {
      const v = defaults[type.value]
      next[type.value] = v == null ? '' : String(v)
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValues(next)
  }, [practice])

  function handleSave() {
    const collected = {}
    for (const type of TREATMENT_TYPES) {
      const n = Number(values[type.value])
      if (Number.isFinite(n) && n > 0) collected[type.value] = n
    }
    onSave({ treatment_defaults: collected }, 'Treatment values saved')
  }

  return (
    <div className="card p-6">
      <h2 className="text-base font-semibold text-white">Default Treatment Values</h2>
      <p className="mt-2 text-sm text-slate-400">
        Used when actual PMS values aren&apos;t available. Set your practice&apos;s typical treatment
        plan values.
      </p>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {TREATMENT_TYPES.map((type) => (
          <Field key={type.value} label={type.label}>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-sm text-slate-500">
                $
              </span>
              <input
                className="input pl-7"
                type="number"
                min="0"
                inputMode="numeric"
                value={values[type.value] ?? ''}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [type.value]: e.target.value }))
                }
                placeholder={`e.g. ${type.avgValue}`}
              />
            </div>
          </Field>
        ))}
      </div>

      <div className="mt-6 flex justify-end">
        <button onClick={handleSave} disabled={saving} className="btn-primary">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Save
        </button>
      </div>

      <p className="mt-4 text-xs text-slate-500">
        These are fallbacks only. Connect your PMS for accurate real-time values.
      </p>
    </div>
  )
}

function ActivateButton({ label, loading, onClick }) {
  return (
    <button onClick={onClick} disabled={loading} className="btn-primary">
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
      {label}
    </button>
  )
}

function BillingPanel({ practice, showSuccess, checkoutLoading, checkoutError, onActivate, onCancel, onResume }) {
  // Authoritative status from the edge function; falls back to the practice
  // record so a fetch failure never blocks the page.
  const [live, setLive] = useState(null)
  useEffect(() => {
    if (!practice?.id) return
    let on = true
    getBillingStatus(practice.id)
      .then((d) => on && setLive(d))
      .catch(() => {}) // non-blocking: keep using the practice record
    return () => { on = false }
  }, [practice?.id])

  const eff = live
    ? { ...practice, subscription_status: live.status, trial_ends_at: live.trial_ends_at }
    : practice
  const status = eff?.subscription_status || 'trial'
  const meta = subStatusMeta(status)
  const isActive = status === 'active'
  const isTrial = status === 'trial'
  const isPaymentFailed = status === 'past_due' || status === 'unpaid'
  const isCancelledOrExpired = status === 'cancelled' || status === 'canceled' || status === 'expired'
  const trialExpired = isTrial && isTrialExpired(eff)
  const daysLeft = trialDaysRemaining(eff)

  // Chargebee customer-portal (update payment method / manage subscription).
  const [portalBusy, setPortalBusy] = useState(false)
  const [portalErr, setPortalErr] = useState('')
  async function openPortal() {
    if (!practice?.id) return
    setPortalBusy(true)
    setPortalErr('')
    try {
      window.location.href = await createPortalSession(practice.id)
    } catch (e) {
      setPortalErr(e?.message || 'Could not open the billing portal. Please try again.')
      setPortalBusy(false)
    }
  }
  const PortalButton = ({ label = 'Update Payment Method' }) => (
    <button onClick={openPortal} disabled={portalBusy} className="btn-primary">
      {portalBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
      {label}
    </button>
  )

  return (
    <div className="card p-6">
      <h2 className="text-base font-semibold text-white">Billing</h2>

      {isPaymentFailed && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            Payment failed - update your payment method to restore access.
          </span>
          <PortalButton />
        </div>
      )}
      {portalErr && (
        <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{portalErr}</p>
      )}

      {showSuccess && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Payment received - thank you! Your subscription is being activated. This can take a few
            moments to reflect here.
          </span>
        </div>
      )}

      {/* Current plan card */}
      <div className="mt-4 rounded-xl border border-surface-700 bg-surface-800/50 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Current plan
            </p>
            <p className="mt-1 text-xl font-bold text-white">{PLAN_NAME}</p>
            <p className="mt-0.5 text-sm text-slate-400">{PLAN_PRICE}</p>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${meta.classes}`}
          >
            {meta.label}
          </span>
        </div>

        {/* Status-specific detail line */}
        {isTrial && !trialExpired && (
          <p className="mt-4 text-sm text-slate-400">
            Free trial -{' '}
            <span className="font-medium text-slate-200">
              {daysLeft} {daysLeft === 1 ? 'day' : 'days'} remaining
            </span>
            . Activate your subscription to keep access after the trial ends.
          </p>
        )}
        {isTrial && trialExpired && (
          <p className="mt-4 text-sm text-amber-300">
            Your free trial has ended. Activate your subscription to restore full access.
          </p>
        )}
        {isActive && (
          <p className="mt-4 text-sm text-slate-400">
            Next billing date:{' '}
            <span className="text-slate-200">{formatDate(practice?.next_billing_date)}</span>
          </p>
        )}
        {status === 'past_due' && (
          <p className="mt-4 text-sm text-amber-300">
            Your last payment failed. Please update your payment method to avoid losing access.
          </p>
        )}
        {(status === 'cancelled' || status === 'canceled') && (
          <p className="mt-4 text-sm text-rose-300">
            Your subscription is cancelled
            {practice?.next_billing_date
              ? ` and access ends on ${formatDate(practice.next_billing_date)}.`
              : '.'}{' '}
            Reactivate any time to continue.
          </p>
        )}
        {status === 'paused' && (
          <p className="mt-4 text-sm text-primary-300">
            Your account is paused
            {practice?.pause_ends_at ? ` until ${formatDate(practice.pause_ends_at)}` : ''}. No charges during the
            pause - resume any time.
          </p>
        )}
      </div>

      {checkoutError && (
        <p className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
          {checkoutError}
        </p>
      )}

      {/* Actions */}
      <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
        {(isActive || isPaymentFailed) && (
          <button
            onClick={onCancel}
            className="mr-auto text-sm font-medium text-slate-500 transition hover:text-rose-300"
          >
            Cancel subscription
          </button>
        )}

        {status === 'paused' ? (
          <ActivateButton label="Resume subscription" loading={false} onClick={onResume} />
        ) : isActive ? (
          <PortalButton />
        ) : isTrial ? (
          <ActivateButton label="Activate subscription" loading={checkoutLoading} onClick={onActivate} />
        ) : isPaymentFailed ? (
          <PortalButton />
        ) : isCancelledOrExpired ? (
          <ActivateButton label="Reactivate subscription" loading={checkoutLoading} onClick={onActivate} />
        ) : (
          <ActivateButton label="Activate subscription" loading={checkoutLoading} onClick={onActivate} />
        )}
      </div>
    </div>
  )
}

function PracticeTeamPanel({ practice }) {
  const { user } = useAuth()
  const perms = usePermissions()
  const [members, setMembers] = useState([])
  const [pending, setPending] = useState([])
  const [loading, setLoading] = useState(true)
  const [invite, setInvite] = useState(false)

  async function load() {
    if (!practice?.id) return
    setLoading(true)
    const [m, p] = await Promise.all([
      supabase.from('users').select('id, email, role').eq('practice_id', practice.id),
      supabase.from('invitations').select('*').eq('practice_id', practice.id).is('accepted_at', null).order('created_at', { ascending: false }),
    ])
    setMembers(m.data || [])
    setPending(p.data || [])
    setLoading(false)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [practice?.id])

  async function removeMember(id) {
    setMembers((prev) => prev.filter((m) => m.id !== id))
    await supabase.from('users').update({ practice_id: null }).eq('id', id)
  }
  async function cancelInvite(id) {
    setPending((prev) => prev.filter((i) => i.id !== id))
    await supabase.from('invitations').delete().eq('id', id)
  }

  return (
    <div className="space-y-4">
      <div className="card p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">Team</h2>
            <p className="mt-1 text-sm text-slate-400">People with access to {practice?.name || 'this practice'}.</p>
          </div>
          {perms.canInvite && (
            <button onClick={() => setInvite(true)} className="btn-primary"><Plus className="h-4 w-4" /> Invite</button>
          )}
        </div>

        {loading ? (
          <p className="mt-5 text-sm text-slate-500">Loading…</p>
        ) : (
          <ul className="mt-4 divide-y divide-surface-700">
            {members.length === 0 && <li className="py-4 text-sm text-slate-500">No members yet.</li>}
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-700 text-xs font-semibold text-slate-200">
                  {(m.email || '?').slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-200">{m.email}</p>
                  <p className="text-xs capitalize text-slate-500">{ACCESS_LABELS[`practice_${m.role}`] || m.role}</p>
                </div>
                {perms.canInvite && m.id !== user?.id && (
                  <button onClick={() => removeMember(m.id)} className="rounded-md p-2 text-slate-500 transition hover:bg-surface-800 hover:text-rose-400" title="Remove">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {pending.length > 0 && (
        <div className="card overflow-hidden">
          <div className="border-b border-surface-700 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Pending invitations</div>
          <ul className="divide-y divide-surface-700">
            {pending.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-5 py-3.5">
                <Mail className="h-4 w-4 text-slate-500" />
                <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{i.email} · {ACCESS_LABELS[i.role] || i.role}</span>
                {perms.canInvite && (
                  <button onClick={() => cancelInvite(i.id)} className="text-xs font-medium text-slate-500 hover:text-rose-300">Cancel</button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {invite && practice && (
        <InviteModal scope="practice" practiceId={practice.id} onClose={() => setInvite(false)} onSent={load} />
      )}
    </div>
  )
}
