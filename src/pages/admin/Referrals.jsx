import { useMemo, useState } from 'react'
import { Users, DollarSign, Clock, CheckCircle2, Download, Check, Loader2 } from 'lucide-react'
import { useAdminReferrals, useMarkReferralPayoutPaid, isMutating } from '../../lib/queries'
import { StatCard, Table, Badge, money, stop } from '../../components/admin/ui'

const PAYOUT_STATUS = {
  pending: { label: 'Pending', classes: 'bg-amber-500/15 text-amber-300' },
  paid: { label: 'Paid', classes: 'bg-emerald-500/15 text-emerald-300' },
  cancelled: { label: 'Cancelled', classes: 'bg-slate-500/15 text-slate-400' },
}

const FILTERS = [
  { key: 'pending', label: 'Pending' },
  { key: 'paid', label: 'Paid' },
  { key: 'all', label: 'All' },
]

function csvCell(v) {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export default function AdminReferrals() {
  const { data, isLoading: loading } = useAdminReferrals()
  const markPaidMutation = useMarkReferralPayoutPaid()
  const relationships = data?.relationships ?? []
  const payouts = data?.payouts ?? []
  const [filter, setFilter] = useState('pending')

  // First of the current month, for the "pending this month" stat.
  const monthKey = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  }, [])

  const summary = useMemo(() => {
    const activeRelationships = relationships.filter((r) => r.earning).length
    const pendingThisMonth = payouts
      .filter((p) => p.status === 'pending' && String(p.month).slice(0, 10) === monthKey)
      .reduce((s, p) => s + (Number(p.amount) || 0), 0)
    const pendingTotal = payouts
      .filter((p) => p.status === 'pending')
      .reduce((s, p) => s + (Number(p.amount) || 0), 0)
    const paidTotal = payouts
      .filter((p) => p.status === 'paid')
      .reduce((s, p) => s + (Number(p.amount) || 0), 0)
    return { activeRelationships, pendingThisMonth, pendingTotal, paidTotal }
  }, [relationships, payouts, monthKey])

  function markPaid(id) {
    markPaidMutation.mutate({ payoutId: id })
  }

  function exportCsv() {
    const header = [
      'Referring practice',
      'Referred practice',
      'Month',
      'Status',
      'Amount',
      'Paid at',
      'Created at',
    ]
    const lines = [header.join(',')]
    for (const p of payouts) {
      lines.push(
        [
          csvCell(p.referring_practice_name),
          csvCell(p.referred_practice_name),
          csvCell(String(p.month).slice(0, 10)),
          csvCell(p.status),
          csvCell(Number(p.amount) || 0),
          csvCell(p.paid_at ? new Date(p.paid_at).toISOString() : ''),
          csvCell(p.created_at ? new Date(p.created_at).toISOString() : ''),
        ].join(','),
      )
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `referral-payouts-${monthKey}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const visible = useMemo(
    () => (filter === 'all' ? payouts : payouts.filter((p) => p.status === filter)),
    [payouts, filter],
  )

  const head = ['Referring practice', 'Referred practice', 'Month', 'Status', 'Amount', 'Action']
  const rows = visible.map((p) => {
    const meta = PAYOUT_STATUS[p.status] || PAYOUT_STATUS.pending
    const busy = isMutating(markPaidMutation, (v) => v.payoutId === p.id)
    return [
      <span className="font-medium text-slate-100">{p.referring_practice_name}</span>,
      p.referred_practice_name,
      String(p.month).slice(0, 10),
      <Badge className={meta.classes}>{meta.label}</Badge>,
      money(p.amount),
      <div onClick={stop}>
        {p.status === 'pending' ? (
          <button
            onClick={() => markPaid(p.id)}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md border border-surface-700 bg-surface-800 px-2.5 py-1 text-xs font-medium text-emerald-300 transition hover:bg-surface-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Mark as paid
          </button>
        ) : p.status === 'paid' ? (
          <span className="text-xs text-slate-500">
            {p.paid_at ? new Date(p.paid_at).toLocaleDateString() : 'Paid'}
          </span>
        ) : (
          <span className="text-xs text-slate-600">, </span>
        )}
      </div>,
    ]
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Referrals</h1>
          <p className="text-sm text-slate-500">
            {relationships.length} referral {relationships.length === 1 ? 'relationship' : 'relationships'} ·
            practice-to-practice payouts
          </p>
        </div>
        <button onClick={exportCsv} disabled={!payouts.length} className="btn-ghost">
          <Download className="h-4 w-4" /> Export CSV
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Active relationships" value={summary.activeRelationships} icon={Users} />
        <StatCard
          label="Pending this month"
          value={money(summary.pendingThisMonth)}
          icon={Clock}
          accent={summary.pendingThisMonth ? 'text-amber-300' : 'text-white'}
        />
        <StatCard label="Pending (all)" value={money(summary.pendingTotal)} icon={DollarSign} />
        <StatCard
          label="Total paid"
          value={money(summary.paidTotal)}
          icon={CheckCircle2}
          accent="text-emerald-300"
        />
      </div>

      <div className="flex gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={[
              'rounded-lg px-3 py-1.5 text-sm font-medium transition',
              filter === f.key
                ? 'bg-primary/10 text-primary-300'
                : 'text-slate-400 hover:bg-surface-800 hover:text-slate-200',
            ].join(' ')}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
        </div>
      ) : (
        <Table
          head={head}
          rows={rows}
          empty={
            filter === 'pending'
              ? 'No pending payouts. They are generated on the 1st of each month.'
              : 'No referral payouts yet.'
          }
          icon={DollarSign}
        />
      )}
    </div>
  )
}
