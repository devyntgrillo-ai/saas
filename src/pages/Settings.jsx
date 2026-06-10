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
  Send,
  Phone,
  MessageSquare,
  BookOpen,
  Gift,
  UserRound,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { auditUserRoleChanged } from '../lib/audit'
import { formatDate } from '../lib/consults'
import KnowledgeBase from './KnowledgeBase'
import AuditLog from './AuditLog'
import PMSIntegration from './PMSIntegration'
import PhoneMessaging from './PhoneMessaging'
import Integrations from './Integrations'
import NotificationSettings from './NotificationSettings'
import ReferralsPanel from './Referrals'
import GetFreeMonth from '../components/GetFreeMonth'
import UserProfilePanel from '../components/UserProfilePanel'
import CancellationFlow from '../components/CancellationFlow'
import InviteModal from '../components/InviteModal'
import Modal from '../components/Modal'
import { usePermissions, ACCESS_LABELS } from '../lib/permissions'
import AccessRestricted from '../components/AccessRestricted'
import {
  usePracticeTeam,
  useRemoveTeamMember,
  useRevokeInvitation,
  useResendInvitation,
  useUpdatePractice,
} from '../lib/queries'
import {
  PLAN_NAME,
  PLAN_PRICE_NUMERIC,
  statusMeta as subStatusMeta,
  trialDaysRemaining,
  isTrialExpired,
  recordHelcimPayment,
  updateHelcimCard,
  resumeSubscription,
  annualAmountFor,
  upgradeToAnnual,
} from '../lib/billing'
import HelcimCardForm from '../components/HelcimCardForm'

const TABS = [
  { key: 'profile', label: 'Practice Profile', icon: Building2 },
  { key: 'account', label: 'Your Profile', icon: UserRound },
  { key: 'integrations', label: 'Integrations', icon: Plug },
  { key: 'messaging', label: 'Messaging', icon: MessageSquare },
  { key: 'team', label: 'Team', icon: Users },
  { key: 'knowledge-base', label: 'Knowledge Base', icon: BookOpen },
  { key: 'notifications', label: 'Notifications', icon: Bell },
  { key: 'free-month', label: 'Get a Free Month', icon: Sparkles },
  // Only for direct (non-reseller) practices - filtered out below when agency_id is set.
  { key: 'referrals', label: 'Referrals', icon: Gift, directOnly: true, hidden: true }, // hidden for now
  { key: 'billing', label: 'Billing', icon: CreditCard },
  { key: 'audit-log', label: 'Audit Log', icon: ScrollText, adminOnly: true },
  // Reachable via Integrations cards / deep links, hidden from the tab rail.
  { key: 'pms', label: 'PMS Integration', icon: Plug, hidden: true },
  // Legacy deep link, redirects to messaging.
  { key: 'phone', label: 'Messaging', icon: Phone, hidden: true },
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
    if (t.key === 'team' && !perms.canViewTeam) return false
    // Reseller-onboarded practices refer through their reseller, not directly.
    if (t.directOnly && practice?.agency_id) return false
    return true
  })
  const navigate = useNavigate()
  const { tab: tabParam } = useParams()
  const tab = TAB_KEYS.includes(tabParam) ? tabParam : 'profile'
  const setTab = (key) => navigate(key === 'profile' ? '/settings' : `/settings/${key}`)

  // Deep-linking to a restricted tab (billing/team/audit-log) is blocked even
  // though the chip is hidden, members/viewers get Access Restricted (logged).
  const tabBlocked =
    (tab === 'billing' && !perms.canViewBilling) ||
    (tab === 'team' && !perms.canViewTeam) ||
    (tab === 'audit-log' && !isAdmin)

  // Legacy tab URLs, keep old links working.
  useEffect(() => {
    if (tabParam === 'recording') navigate('/settings/integrations', { replace: true })
    if (tabParam === 'phone') navigate('/settings/messaging', { replace: true })
  }, [tabParam, navigate])
  const [form, setForm] = useState({})
  const updatePractice = useUpdatePractice()
  const [savedFlash, setSavedFlash] = useState('')
  const [saveError, setSaveError] = useState('')
  const [showCancel, setShowCancel] = useState(false)

  // Billing
  const [searchParams, setSearchParams] = useSearchParams()
  const [showSuccess, setShowSuccess] = useState(false)

  // After a successful in-app charge we set ?success=true; surface a confirmation.
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
        recording_method: practice.recording_method || 'browser',
        audio_quality: practice.audio_quality || 'standard',
        auto_start_followup: practice.auto_start_followup ?? false,
        timezone: practice.timezone || 'America/Chicago',
      })
    }
  }, [practice])

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))

  async function save(patch, flash = 'Saved') {
    if (!practice?.id) {
      setSaveError(
        'Your account is not linked to a practice yet. Wait a moment and try again, or sign out and complete signup.',
      )
      return
    }
    if (updatePractice.isPending) return
    setSaveError('')
    try {
      await updatePractice.mutateAsync({ practiceId: practice.id, patch })
    } catch (error) {
      setSaveError(error.message || 'Could not save changes.')
      return error
    }
    setSavedFlash(flash)
    setTimeout(() => setSavedFlash(''), 2500)
    await refreshProfile()
    return null
  }

  const saving = updatePractice.isPending

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
          {tabBlocked && (
            <AccessRestricted
              resource={`settings:${tab}`}
              reason="insufficient_role"
              message="Only practice admins can access this section."
              showHomeLink={false}
            />
          )}
          {/* Practice Profile */}
          {!tabBlocked && tab === 'profile' && (
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
              {saveError && tab === 'profile' && (
                <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  {saveError}
                </p>
              )}
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
                  disabled={saving || !practice?.id}
                  className="btn-primary"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save changes
                </button>
              </div>
            </div>
            </div>
          )}

          {/* Knowledge Base */}
          {tab === 'knowledge-base' && <KnowledgeBase />}

          {/* Integrations hub */}
          {tab === 'integrations' && <Integrations />}

          {/* PMS Integration (deep-linked from Integrations) */}
          {tab === 'pms' && <PMSIntegration />}

          {/* Messaging, Twilio SMS, Mailgun email, A2P, phone number */}
          {(tab === 'messaging' || tab === 'phone') && <PhoneMessaging />}

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

          {tab === 'free-month' && <GetFreeMonth practice={practice} />}

          {/* Referrals (direct practices only) */}
          {tab === 'referrals' &&
            (practice?.agency_id ? (
              <Navigate to="/settings" replace />
            ) : (
              <ReferralsPanel practice={practice} />
            ))}

          {/* Team */}
          {tab === 'account' && <UserProfilePanel />}

          {tab === 'team' && perms.canViewTeam && <PracticeTeamPanel practice={practice} />}

          {/* Billing */}
          {tab === 'billing' && perms.canViewBilling && (
            <BillingPanel
              practice={practice}
              showSuccess={showSuccess}
              onCancel={() => setShowCancel(true)}
              onResume={async () => {
                try {
                  await resumeSubscription(practice.id)
                  setSavedFlash('Subscription resumed'); setTimeout(() => setSavedFlash(''), 2500)
                  await refreshProfile()
                } catch (e) { setSaveError(e?.message || 'Could not resume your subscription.') }
              }}
              onRefresh={refreshProfile}
            />
          )}

          {/* Audit Log (admin only) */}
          {tab === 'audit-log' && isAdmin && <AuditLog />}
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

function ActivateButton({ label, loading, onClick }) {
  return (
    <button onClick={onClick} disabled={loading} className="btn-primary">
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
      {label}
    </button>
  )
}

function BillingPanel({ practice, showSuccess, onCancel, onResume, onRefresh }) {
  const status = practice?.subscription_status || 'trial'
  const meta = subStatusMeta(status)
  const isActive = status === 'active'
  const isTrial = status === 'trial'
  const isPaymentFailed = status === 'past_due' || status === 'unpaid'
  const trialExpired = isTrial && isTrialExpired(practice)
  const daysLeft = trialDaysRemaining(practice)
  const planAmount = Number(practice?.plan_amount) > 0 ? Number(practice.plan_amount) : PLAN_PRICE_NUMERIC
  const hasCard = Boolean(practice?.helcim_customer_code)
  const isAnnual = practice?.billing_interval === 'annual'
  const annualPrice = annualAmountFor(practice) // monthly × 10 (2 months free)
  const [annualOpen, setAnnualOpen] = useState(false)
  const [annualBusy, setAnnualBusy] = useState(false)
  const [annualErr, setAnnualErr] = useState('')

  async function confirmAnnual() {
    setAnnualBusy(true); setAnnualErr('')
    try {
      await upgradeToAnnual()
      setAnnualOpen(false)
      await onRefresh?.()
    } catch (e) {
      setAnnualErr(e?.message || 'Could not upgrade to annual billing.')
    }
    setAnnualBusy(false)
  }

  // Native card capture via Helcim.js (modal). 'activate' charges the plan;
  // 'update' captures a new card. (A verify-mode Helcim.js config can be wired
  // later so 'update' never charges; today it re-runs the plan charge.)
  const [payMode, setPayMode] = useState(null)
  const [err, setErr] = useState('')

  async function handleApproved(res) {
    setErr('')
    try {
      // Server-verified (helcim-checkout record_payment): confirms the charge with
      // Helcim, records it, enrolls recurring, and activates — never trusts the client.
      await recordHelcimPayment({
        cardToken: res.cardToken,
        amount: Number(res.amount) || planAmount,
        date: res.date,
        customerCode: res.customerCode,
        cardLast4: res.cardNumberMasked,
        cardType: res.cardType,
      })
      setPayMode(null)
      await onRefresh?.()
    } catch (e) {
      setErr(e?.message || 'Your card was processed but we could not update your account — please contact support.')
    }
  }

  // Update card on file (verify mode — no charge). The card was tokenized against
  // the practice's Helcim customer; the edge function sets it as the default.
  async function handleCardUpdated(res) {
    setErr('')
    try {
      await updateHelcimCard({ cardToken: res.cardToken, cardLast4: res.cardNumberMasked, cardType: res.cardType })
      setPayMode(null)
      await onRefresh?.()
    } catch (e) {
      setErr(e?.message || 'Could not update your card on file — please try again.')
    }
  }

  return (
    <div className="space-y-6">
    <div className="card p-6">
      <h2 className="text-base font-semibold text-white">Billing</h2>

      {isPaymentFailed && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            Payment failed - update your payment method to restore access.
          </span>
          <button onClick={() => setPayMode('update')} className="btn-primary"><CreditCard className="h-4 w-4" /> Update payment method</button>
        </div>
      )}
      {err && <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{err}</p>}

      {showSuccess && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Payment received - thank you! Your subscription is active.</span>
        </div>
      )}

      {/* Current plan card */}
      <div className="mt-4 rounded-xl border border-surface-700 bg-surface-800/50 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current plan</p>
            <p className="mt-1 text-xl font-bold text-white">{PLAN_NAME}</p>
            <p className="mt-0.5 text-sm text-slate-400">${planAmount.toLocaleString()}/month</p>
          </div>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${meta.classes}`}>
            {meta.label}
          </span>
        </div>

        {isTrial && !trialExpired && (
          <p className="mt-4 text-sm text-slate-400">
            Free trial - <span className="font-medium text-slate-200">{daysLeft} {daysLeft === 1 ? 'day' : 'days'} remaining</span>. Activate your subscription to keep access after the trial ends.
          </p>
        )}
        {isTrial && trialExpired && (
          <p className="mt-4 text-sm text-amber-300">Your free trial has ended. Activate your subscription to restore full access.</p>
        )}
        {isActive && (
          <div className="mt-4 space-y-1 text-sm text-slate-400">
            <p>{isAnnual ? 'Annual plan' : 'Monthly plan'} · {isAnnual ? 'renews' : 'next billing'}: <span className="text-slate-200">{formatDate(practice?.next_billing_date) || 'tracked manually'}</span></p>
            {hasCard && (
              <p>
                Card on file:{' '}
                <span className="text-slate-200">
                  {practice?.card_type ? `${practice.card_type} ` : ''}
                  {practice?.card_last4 ? `•••• ${practice.card_last4}` : 'saved'}
                </span>
                {/* TODO: card update flow — capture a new card without re-charging (verify-mode Helcim.js config). */}
              </p>
            )}
          </div>
        )}
        {(status === 'cancelled' || status === 'canceled') && (
          <p className="mt-4 text-sm text-rose-300">
            Your subscription is cancelled{practice?.next_billing_date ? ` and access ends on ${formatDate(practice.next_billing_date)}.` : '.'} Reactivate any time to continue.
          </p>
        )}
        {status === 'paused' && (
          <p className="mt-4 text-sm text-primary-300">
            Your account is paused{practice?.pause_ends_at ? ` until ${formatDate(practice.pause_ends_at)}` : ''}. No charges during the pause - resume any time.
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
        {(isActive || isPaymentFailed) && (
          <button onClick={onCancel} className="mr-auto text-sm font-medium text-slate-500 transition hover:text-rose-300">
            Cancel subscription
          </button>
        )}
        {status === 'paused' ? (
          <ActivateButton label="Resume subscription" loading={false} onClick={onResume} />
        ) : isActive ? (
          <button onClick={() => setPayMode('update')} className="btn-primary"><CreditCard className="h-4 w-4" /> Update payment method</button>
        ) : (
          <button onClick={() => setPayMode('activate')} className="btn-primary"><CreditCard className="h-4 w-4" /> {status === 'cancelled' || status === 'canceled' || status === 'expired' ? 'Reactivate subscription' : 'Activate subscription'}</button>
        )}
      </div>
    </div>

    {isActive && !isAnnual && hasCard && (
      <div className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-white">Switch to annual billing</h2>
              <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">2 months free</span>
            </div>
            <p className="mt-1.5 text-sm text-slate-400">
              Pay for 10 months up front and you&apos;re covered for a full year —{' '}
              <span className="font-medium text-slate-200">${annualPrice.toLocaleString()}</span> today instead of{' '}
              <span className="text-slate-400">${(planAmount * 12).toLocaleString()}</span>.
            </p>
          </div>
          <button onClick={() => { setAnnualErr(''); setAnnualOpen(true) }} className="btn-primary shrink-0">
            <Sparkles className="h-4 w-4" /> Upgrade to annual
          </button>
        </div>
      </div>
    )}

    {annualOpen && (
      <Modal title="Switch to annual billing" onClose={() => { if (!annualBusy) setAnnualOpen(false) }} maxWidth="max-w-md">
        <p className="text-sm text-slate-300">
          We&apos;ll charge <span className="font-semibold text-white">${annualPrice.toLocaleString()}</span> to your card on file
          {practice?.card_last4 ? ` (•••• ${practice.card_last4})` : ''} today — 10 months, with 2 months free. You&apos;re then
          covered for a full year and monthly billing stops.
        </p>
        {annualErr && <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{annualErr}</p>}
        <div className="mt-5 flex items-center justify-end gap-3">
          <button onClick={() => setAnnualOpen(false)} disabled={annualBusy} className="btn-ghost">Cancel</button>
          <button onClick={confirmAnnual} disabled={annualBusy} className="btn-primary">
            {annualBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Pay ${annualPrice.toLocaleString()} &amp; switch
          </button>
        </div>
      </Modal>
    )}

    <AddLocationCard practiceId={practice?.id} />

    {payMode && (
      <Modal title={payMode === 'activate' ? 'Activate subscription' : 'Update payment method'} onClose={() => setPayMode(null)} maxWidth="max-w-md">
        {payMode === 'activate'
          ? <p className="mb-3 text-sm text-slate-400">{PLAN_NAME} — ${planAmount.toLocaleString()}/month. Enter your card to activate.</p>
          : <p className="mb-3 text-sm text-slate-400">Enter a new card. It replaces the card on file for future billing. You won't be charged now.</p>}
        <HelcimCardForm
          verify={payMode === 'update'}
          customerCode={payMode === 'update' ? practice?.helcim_customer_code : undefined}
          amount={payMode === 'activate' ? planAmount : undefined}
          submitLabel={payMode === 'activate' ? 'Activate' : 'Save card'}
          onApproved={payMode === 'activate' ? handleApproved : handleCardUpdated}
          onDeclined={(r) => setErr(r?.message || 'Your card was declined. Please try another card.')}
          onError={(m) => setErr(m)}
        />
      </Modal>
    )}
    </div>
  )
}

// Volume pricing: more locations -> lower per-location monthly rate.
function perLocationRate(n) {
  if (n >= 10) return 497
  if (n >= 5) return 597
  if (n >= 2) return 697
  return 797
}

// Settings -> Billing -> "Add Another Location". Picks a count, shows live volume
// pricing, then hands off to the signup funnel pre-filled with the discounted
// plan + parent practice so the new location links to this owner's account.
function AddLocationCard({ practiceId }) {
  const [count, setCount] = useState(1)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const rate = perLocationRate(count)
  const total = rate * count

  function proceed() {
    const params = new URLSearchParams({ plan: String(rate), locations: String(count) })
    if (practiceId) params.set('parent_practice', practiceId)
    window.location.href = `/signup?${params.toString()}`
  }

  return (
    <div className="card p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-white">Add Another Location</h2>
        <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-300">
          Coming Soon
        </span>
      </div>

      {/* The self-serve add-a-location funnel is gated for now: show it blurred
          and non-interactive behind a "Coming Soon" overlay that points people to
          chat/email for a discounted manual setup. */}
      <div className="relative mt-4">
        <div aria-hidden="true" className="pointer-events-none select-none opacity-50 blur-[2px]">
          <p className="text-sm text-slate-400">
            Each additional location gets a discounted rate. Volume pricing applied automatically.
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">How many locations to add?</label>
              <select
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                tabIndex={-1}
                className="h-10 w-full rounded-lg border border-surface-700 bg-surface-800 px-3 text-sm text-white focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              >
                {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>{n} {n === 1 ? 'location' : 'locations'}</option>
                ))}
              </select>
            </div>

            <div className="rounded-xl border border-surface-700 bg-surface-800/50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Per location</p>
              <p className="mt-1 text-2xl font-bold text-white">
                ${rate}<span className="text-sm font-medium text-slate-400">/mo</span>
              </p>
              <p className="mt-1 text-sm text-slate-400">
                {count} {count === 1 ? 'location' : 'locations'} × ${rate}/mo ={' '}
                <span className="font-semibold text-emerald-300">${total.toLocaleString()}/mo</span> additional
              </p>
            </div>
          </div>

          <div className="mt-5 flex justify-end">
            <span className="btn-primary">
              <Plus className="h-4 w-4" /> Add {count === 1 ? 'Location' : 'Locations'}, ${total.toLocaleString()}/mo
            </span>
          </div>
        </div>

        {/* Coming Soon overlay */}
        <div className="absolute inset-0 flex items-center justify-center px-4">
          <div className="max-w-sm rounded-xl border border-surface-700 bg-surface-900/85 px-5 py-4 text-center shadow-lg backdrop-blur-sm">
            <p className="text-sm font-semibold text-white">Coming soon</p>
            <p className="mt-1 text-sm text-slate-400">
              Contact us via chat or email to add another location at a discount.
            </p>
          </div>
        </div>
      </div>

      {confirmOpen && (
        <Modal
          title="Add another location"
          onClose={() => setConfirmOpen(false)}
          footer={
            <>
              <button onClick={() => setConfirmOpen(false)} className="btn-ghost">Cancel</button>
              <button onClick={proceed} className="btn-primary">Continue, ${total.toLocaleString()}/mo</button>
            </>
          }
        >
          <p className="text-sm text-slate-300">
            Add <span className="font-semibold text-white">{count}</span>{' '}
            {count === 1 ? 'location' : 'locations'} at{' '}
            <span className="font-semibold text-white">${rate}/mo</span> each
            {' '}(<span className="text-emerald-300">${total.toLocaleString()}/mo</span> additional)?
            You'll set up each location's account on the next screen, linked to this account.
          </p>
        </Modal>
      )}
    </div>
  )
}

// Initials for the member avatar - first letters of the name when we have one,
// else the first two characters of the email.
function teamInitials(nameOrEmail) {
  const s = (nameOrEmail || '?').trim()
  const parts = s.split(/\s+/)
  if (parts.length >= 2 && /[a-zA-Z]/.test(parts[0])) return (parts[0][0] + parts[1][0]).toUpperCase()
  return s.slice(0, 2).toUpperCase()
}

function PracticeTeamPanel({ practice }) {
  const { user } = useAuth()
  const perms = usePermissions()
  const { data, isLoading: loading, refetch } = usePracticeTeam(practice?.id)
  const removeMemberMutation = useRemoveTeamMember()
  const revokeInviteMutation = useRevokeInvitation()
  const resendInviteMutation = useResendInvitation()
  const members = data?.members ?? []
  const pending = data?.pending ?? []
  const [invite, setInvite] = useState(false)
  const [busyRole, setBusyRole] = useState(null)
  const [flash, setFlash] = useState('')

  function note(msg) {
    setFlash(msg)
    setTimeout(() => setFlash(''), 6000)
  }

  // Owner/admin changes a teammate's role (incl. demoting to read-only viewer).
  // Goes through the SECURITY DEFINER RPC since RLS blocks updating others' rows.
  async function changeRole(m, role) {
    if (role === m.role) return
    setBusyRole(m.id)
    try {
      const { data, error } = await supabase.rpc('set_practice_member_role', { p_user_id: m.id, p_role: role })
      if (error || !data?.ok) throw new Error(data?.error || error?.message || 'Could not change role')
      auditUserRoleChanged(m.id, { from: m.role, to: role })
      note(`${m.display_name || m.email} is now ${ACCESS_LABELS[`practice_${role}`] || role}.`)
      refetch()
    } catch (e) {
      note(e?.message || 'Could not change role.')
    } finally {
      setBusyRole(null)
    }
  }

  function removeMember(id) {
    removeMemberMutation.mutate({ userId: id, practiceId: practice.id })
  }
  function cancelInvite(id) {
    revokeInviteMutation.mutate({ invitationId: id, practiceId: practice.id })
  }
  async function resendInvite(inv) {
    try {
      const res = await resendInviteMutation.mutateAsync({ token: inv.token, invitationId: inv.id })
      if (res?.email_sent) note(`Invite re-sent to ${inv.email}.`)
      else note(`Couldn't email ${inv.email}${res?.reason ? ` (${res.reason})` : ''} - share the invite link from the modal instead.`)
    } catch (e) {
      note(e?.message || 'Could not resend invite.')
    }
  }

  const removingId = removeMemberMutation.isPending ? removeMemberMutation.variables?.userId : null
  const revokingId = revokeInviteMutation.isPending ? revokeInviteMutation.variables?.invitationId : null
  const resendingId = resendInviteMutation.isPending ? resendInviteMutation.variables?.invitationId : null

  return (
    <div className="space-y-4">
      {flash && (
        <p className="rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-sm text-slate-300">{flash}</p>
      )}

      {/* Section 1 - Active Members */}
      <div className="card p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">Active Members</h2>
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
                <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-700 text-xs font-semibold text-slate-200">
                  {m.avatar_url ? <img src={m.avatar_url} alt="" className="h-full w-full object-cover" /> : teamInitials(m.display_name || m.email)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-200">
                    {m.display_name || m.email}
                    {m.id === user?.id && <span className="ml-1.5 text-xs font-normal text-slate-500">(you)</span>}
                  </p>
                  {m.job_title && <p className="truncate text-xs font-medium text-slate-400">{m.job_title}</p>}
                  {m.display_name && <p className="truncate text-xs text-slate-500">{m.email}</p>}
                  {perms.canInvite && m.id !== user?.id ? (
                    <select
                      value={m.role === 'admin' ? 'owner' : (['owner', 'member', 'viewer'].includes(m.role) ? m.role : 'member')}
                      onChange={(e) => changeRole(m, e.target.value)}
                      disabled={busyRole === m.id}
                      title="Change role"
                      className="mt-1 rounded-md border border-surface-700 bg-surface-900 px-1.5 py-1 text-xs text-slate-300 focus:border-primary focus:outline-none disabled:opacity-50"
                    >
                      <option value="owner">Practice Admin</option>
                      <option value="member">Practice Member</option>
                      <option value="viewer">Practice Viewer (read-only)</option>
                    </select>
                  ) : (
                    <p className="text-xs capitalize text-slate-500">{ACCESS_LABELS[`practice_${m.role}`] || m.role}</p>
                  )}
                </div>
                {perms.canInvite && m.id !== user?.id && (
                  <button onClick={() => removeMember(m.id)} disabled={removingId === m.id} className="rounded-md p-2 text-slate-500 transition hover:bg-surface-800 hover:text-rose-400 disabled:opacity-50" title="Remove">
                    {removingId === m.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Section 2 - Pending Invites */}
      <div className="card overflow-hidden">
        <div className="border-b border-surface-700 px-6 py-3.5">
          <h2 className="text-base font-semibold text-white">Pending Invites</h2>
        </div>
        {loading ? (
          <p className="px-6 py-5 text-sm text-slate-500">Loading…</p>
        ) : pending.length === 0 ? (
          <p className="px-6 py-5 text-sm text-slate-500">No pending invites.</p>
        ) : (
          <ul className="divide-y divide-surface-700">
            {pending.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-6 py-3.5">
                <Mail className="h-4 w-4 shrink-0 text-slate-500" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm text-slate-200">
                    <span className="truncate">{i.email}</span>
                    <span className="inline-flex shrink-0 items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-300 ring-1 ring-inset ring-amber-400/20">
                      Pending
                    </span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {ACCESS_LABELS[i.role] || i.role} · invited {formatDate(i.created_at)}
                  </p>
                </div>
                {perms.canInvite && (
                  <div className="flex shrink-0 items-center gap-3">
                    <button
                      onClick={() => resendInvite(i)}
                      disabled={resendingId === i.id || !i.token}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-300 transition hover:text-primary-200 disabled:opacity-50"
                    >
                      {resendingId === i.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      Resend
                    </button>
                    <button onClick={() => cancelInvite(i.id)} disabled={revokingId === i.id} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition hover:text-rose-300 disabled:opacity-50">
                      {revokingId === i.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      Cancel
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {invite && practice && (
        <InviteModal scope="practice" practiceId={practice.id} onClose={() => setInvite(false)} onSent={() => refetch()} />
      )}
    </div>
  )
}
