import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { DollarSign, CheckCircle2, AlertCircle, Clock, ExternalLink, Link2, Ban, CalendarPlus, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAdminBilling, queryKeys } from '../../lib/queries'
import { statusMeta as subStatusMeta, cancelSubscription, createPortalSession } from '../../lib/billing'
import { StatCard, Table, Badge, money, stop } from '../../components/admin/ui'

// Deep-link to a customer in the Chargebee dashboard. Needs the site name
// (VITE_CHARGEBEE_SITE); falls back to the Chargebee login if it isn't set.
const CHARGEBEE_SITE = import.meta.env.VITE_CHARGEBEE_SITE || ''
function chargebeeCustomerUrl(customerId) {
  if (!CHARGEBEE_SITE) return 'https://app.chargebee.com'
  const base = `https://${CHARGEBEE_SITE}.chargebee.com`
  return customerId ? `${base}/d/customers/${customerId}` : base
}

// Color-code the monthly plan amount: green for full price, amber for a
// discounted tier, gray for anything lower (or missing).
function planAmountClass(amount) {
  const a = Number(amount) || 0
  if (a >= 997) return 'text-emerald-300'
  if (a >= 797) return 'text-amber-300'
  return 'text-slate-400'
}

const contactName = (r) => [r.doctor_first, r.doctor_last].filter(Boolean).join(' ').trim()

export default function AdminBilling() {
  const queryClient = useQueryClient()
  const { data: rows = [], isLoading: loading, refetch } = useAdminBilling()
  const [busyId, setBusyId] = useState(null)
  const [flash, setFlash] = useState('')

  const reload = () => {
    refetch()
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.billing() })
  }

  const summary = useMemo(() => {
    let active = 0, pastDue = 0, trial = 0, mrr = 0
    for (const r of rows) {
      const s = r.subscription_status || 'trial'
      if (s === 'active') {
        active++
        mrr += Number(r.plan_amount) || 997
      } else if (s === 'past_due' || s === 'unpaid') pastDue++
      else if (s === 'trial') trial++
    }
    return { active, pastDue, trial, mrr }
  }, [rows])

  function note(msg) {
    setFlash(msg)
    setTimeout(() => setFlash(''), 4000)
  }

  async function sendPortalLink(r) {
    setBusyId(r.id)
    try {
      const url = await createPortalSession(r.id)
      try { await navigator.clipboard.writeText(url) } catch { /* clipboard unavailable */ }
      note(`Portal link generated for ${r.name} - copied to clipboard.`)
    } catch (e) {
      note(e?.message || 'Could not generate a portal link.')
    } finally {
      setBusyId(null)
    }
  }

  async function cancelSub(r) {
    if (!confirm(`Cancel the subscription for ${r.name}? They keep access until the end of the paid period.`)) return
    setBusyId(r.id)
    try {
      await cancelSubscription(r.id)
      note(`Subscription cancelled for ${r.name}.`)
      await reload()
    } catch (e) {
      note(e?.message || 'Cancel failed.')
    } finally {
      setBusyId(null)
    }
  }

  async function extendTrial(r, days) {
    setBusyId(r.id)
    const base = r.trial_ends_at && new Date(r.trial_ends_at) > new Date() ? new Date(r.trial_ends_at) : new Date()
    base.setDate(base.getDate() + days)
    const { error } = await supabase.from('practices').update({ trial_ends_at: base.toISOString() }).eq('id', r.id)
    if (error) note(error.message)
    else { note(`Extended ${r.name}'s trial by ${days} days.`); await reload() }
    setBusyId(null)
  }

  const head = ['Practice', 'Contact', 'Email', 'PMS', 'Plan', 'Status', 'Signup', 'Actions']
  const tableRows = rows.map((r) => {
    const status = r.subscription_status || 'trial'
    const meta = subStatusMeta(status)
    const busy = busyId === r.id
    const amount = Number(r.plan_amount) || 997
    return [
      <span className="font-medium text-slate-100">{r.name}</span>,
      contactName(r) || <span className="text-slate-500">—</span>,
      r.email ? <span className="text-slate-300">{r.email}</span> : <span className="text-slate-500">—</span>,
      r.pms_type || <span className="text-slate-500">—</span>,
      <span className={`font-semibold ${planAmountClass(amount)}`}>{money(amount)}</span>,
      <Badge className={meta.classes}>{meta.label}</Badge>,
      r.created_at ? new Date(r.created_at).toLocaleDateString() : '-',
      <div className="flex flex-wrap items-center gap-1.5" onClick={stop}>
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />}
        <button onClick={() => sendPortalLink(r)} disabled={busy} title="Generate + copy a customer portal link" className="rounded-md border border-surface-700 bg-surface-800 px-2 py-1 text-xs text-slate-300 transition hover:bg-surface-700">
          <Link2 className="mr-1 inline h-3.5 w-3.5" />Portal
        </button>
        <button onClick={() => cancelSub(r)} disabled={busy} className="rounded-md border border-surface-700 bg-surface-800 px-2 py-1 text-xs text-rose-300 transition hover:bg-surface-700">
          <Ban className="mr-1 inline h-3.5 w-3.5" />Cancel
        </button>
        <button onClick={() => extendTrial(r, 7)} disabled={busy} className="rounded-md border border-surface-700 bg-surface-800 px-2 py-1 text-xs text-slate-300 transition hover:bg-surface-700" title="Extend trial 7 days">
          <CalendarPlus className="mr-1 inline h-3.5 w-3.5" />+7
        </button>
        <button onClick={() => extendTrial(r, 14)} disabled={busy} className="rounded-md border border-surface-700 bg-surface-800 px-2 py-1 text-xs text-slate-300 transition hover:bg-surface-700" title="Extend trial 14 days">+14</button>
        <a
          href={chargebeeCustomerUrl(r.chargebee_customer_id)}
          target="_blank" rel="noopener noreferrer"
          className={`rounded-md border border-surface-700 bg-surface-800 px-2 py-1 text-xs transition hover:bg-surface-700 ${r.chargebee_customer_id ? 'text-slate-300' : 'text-slate-600'}`}
          title="View in Chargebee"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>,
    ]
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Subscriptions</h1>
          <p className="text-sm text-slate-500">{rows.length} practices · newest first</p>
        </div>
        {flash && (
          <span className="rounded-lg border border-surface-700 bg-surface-800 px-3 py-1.5 text-xs text-slate-300">{flash}</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total MRR" value={money(summary.mrr)} icon={DollarSign} accent="text-emerald-300" sub={`${money(summary.mrr * 12)} ARR`} />
        <StatCard label="Active subscriptions" value={summary.active} icon={CheckCircle2} />
        <StatCard label="Past due" value={summary.pastDue} icon={AlertCircle} accent={summary.pastDue ? 'text-rose-300' : 'text-white'} />
        <StatCard label="On trial" value={summary.trial} icon={Clock} />
      </div>

      {loading ? (
        <div className="card flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-500" /></div>
      ) : (
        <Table head={head} rows={tableRows} empty="No practices yet." icon={DollarSign} />
      )}
    </div>
  )
}
