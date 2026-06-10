import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { DollarSign, CheckCircle2, AlertCircle, Clock, ExternalLink, RotateCcw, Ban, CalendarPlus, Loader2, Eye, Building2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAdmin } from '../../context/AdminContext'
import { useAdminBilling, queryKeys } from '../../lib/queries'
import { agencyStatusMeta } from '../../lib/admin'
import { timeAgo } from '../../lib/consults'
import { statusMeta as subStatusMeta, cancelSubscription, helcimRefund } from '../../lib/billing'
import { StatCard, Table, Badge, Avatar, money, stop } from '../../components/admin/ui'

const HELCIM_DASHBOARD = 'https://myhelcim.com/dashboard'

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
  const navigate = useNavigate()
  const { data: ctx, impersonateAgency } = useAdmin()
  const agencies = ctx?.agencies || []
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

  // Refund the practice's last recorded Helcim transaction (super-admin only;
  // enforced server-side in the helcim-checkout function).
  async function refundLast(r) {
    if (!r.helcim_transaction_id) { note(`No Helcim transaction on file for ${r.name}.`); return }
    const amount = Number(r.plan_amount) || 997
    if (!confirm(`Refund ${money(amount)} to ${r.name} (transaction ${r.helcim_transaction_id})?`)) return
    setBusyId(r.id)
    try {
      const res = await helcimRefund({ transactionId: r.helcim_transaction_id, amount })
      if (res?.error) throw new Error(res.error)
      note(`Refund issued to ${r.name}.`)
      await reload()
    } catch (e) {
      note(e?.message || 'Refund failed.')
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
      <div className="leading-tight">
        <span className="font-medium text-slate-100">{r.name}</span>
        {r.helcim_customer_code && <div className="text-[11px] text-slate-500">{r.helcim_customer_code}</div>}
      </div>,
      contactName(r) || <span className="text-slate-500">—</span>,
      r.email ? <span className="text-slate-300">{r.email}</span> : <span className="text-slate-500">—</span>,
      r.pms_type || <span className="text-slate-500">—</span>,
      <span className={`font-semibold ${planAmountClass(amount)}`}>{money(amount)}</span>,
      <Badge className={meta.classes}>{meta.label}</Badge>,
      r.created_at ? new Date(r.created_at).toLocaleDateString() : '-',
      <div className="flex flex-wrap items-center gap-1.5" onClick={stop}>
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />}
        <button onClick={() => refundLast(r)} disabled={busy || !r.helcim_transaction_id} title="Refund last Helcim charge" className="rounded-md border border-surface-700 bg-surface-800 px-2 py-1 text-xs text-amber-300 transition hover:bg-surface-700 disabled:opacity-40">
          <RotateCcw className="mr-1 inline h-3.5 w-3.5" />Refund
        </button>
        <button onClick={() => cancelSub(r)} disabled={busy} className="rounded-md border border-surface-700 bg-surface-800 px-2 py-1 text-xs text-rose-300 transition hover:bg-surface-700">
          <Ban className="mr-1 inline h-3.5 w-3.5" />Cancel
        </button>
        <button onClick={() => extendTrial(r, 7)} disabled={busy} className="rounded-md border border-surface-700 bg-surface-800 px-2 py-1 text-xs text-slate-300 transition hover:bg-surface-700" title="Extend trial 7 days">
          <CalendarPlus className="mr-1 inline h-3.5 w-3.5" />+7
        </button>
        <button onClick={() => extendTrial(r, 14)} disabled={busy} className="rounded-md border border-surface-700 bg-surface-800 px-2 py-1 text-xs text-slate-300 transition hover:bg-surface-700" title="Extend trial 14 days">+14</button>
        <a
          href={HELCIM_DASHBOARD}
          target="_blank" rel="noopener noreferrer"
          className={`rounded-md border border-surface-700 bg-surface-800 px-2 py-1 text-xs transition hover:bg-surface-700 ${r.helcim_customer_code ? 'text-slate-300' : 'text-slate-600'}`}
          title="View in Helcim"
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

      {/* Reseller performance (from the old Overview tab) */}
      <section className="space-y-3 pt-2">
        <h2 className="text-sm font-semibold text-white">Reseller performance</h2>
        <Table
          head={['Reseller', 'Owner', 'Practices', 'Commission / mo', 'Status', 'Joined', 'Last activity', '']}
          rows={agencies.map((a) => [
            <div className="flex items-center gap-2.5">
              <Avatar name={a.name} color={a.white_label?.primary_color} />
              <span className="font-medium text-slate-100">{a.name}</span>
            </div>,
            a.owner_email || '-',
            a.practiceCount,
            money(a.commissionOwed),
            <Badge className={agencyStatusMeta(a.status).classes}>{agencyStatusMeta(a.status).label}</Badge>,
            new Date(a.created_at).toLocaleDateString(),
            a.last_activity ? timeAgo(a.last_activity) : '-',
            <div className="flex items-center gap-1.5" onClick={stop}>
              <button onClick={() => navigate(`/admin/agencies/${a.id}`)} className="rounded-md border border-surface-700 bg-surface-800 px-2 py-1 text-xs text-slate-300 transition hover:bg-surface-700" title="View">
                <Eye className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => impersonateAgency(a)} className="rounded-md border border-surface-700 bg-surface-800 px-2 py-1 text-xs text-primary-300 transition hover:bg-surface-700">
                Impersonate
              </button>
            </div>,
          ])}
          empty="No resellers yet."
          icon={Building2}
          onRowClick={(i) => navigate(`/admin/agencies/${agencies[i].id}`)}
        />
      </section>
    </div>
  )
}
