import { useMemo } from 'react'
import { DollarSign, Building2, Stethoscope, TrendingUp, Calendar } from 'lucide-react'
import { useAdmin } from '../../context/AdminContext'
import { computeOverview, estimateCosts, mrrSeries12, MRR_MILESTONES, PRICING, reasonLabel } from '../../lib/admin'
import { StackedMRRChart } from '../../components/admin/charts'
import { StatCard, Table, Badge, money } from '../../components/admin/ui'
import { useAdminAttribution } from '../../lib/queries'

export default function Revenue() {
  const { data } = useAdmin()
  const o = computeOverview(data)
  const costs = estimateCosts(data)
  const series = useMemo(() => mrrSeries12(data.mrrHistory), [data.mrrHistory])

  // CaseLift attribution per practice (production we can defensibly claim).
  const { data: attribution = {} } = useAdminAttribution()

  const attributionRows = useMemo(() => {
    const nameFor = (pid) => data.practices.find((p) => String(p.id) === String(pid))?.name || 'Unknown practice'
    return Object.entries(attribution)
      .map(([pid, a]) => ({ pid, name: nameFor(pid), ...a }))
      .filter((r) => r.closedCount > 0)
      .sort((a, b) => b.total - a.total)
  }, [attribution, data.practices])

  const attrTotals = useMemo(() => {
    const closed = attributionRows.reduce((s, r) => s + r.closedCount, 0)
    const touched = attributionRows.reduce((s, r) => s + r.touchedCount, 0)
    const attributed = attributionRows.reduce((s, r) => s + r.total, 0)
    return { closed, touched, attributed, rate: closed ? Math.round((touched / closed) * 100) : 0 }
  }, [attributionRows])

  // MoM growth from the last two points of the 12-month series.
  const last = series[series.length - 1]?.total || 0
  const prev = series[series.length - 2]?.total || 0
  const mom = prev ? Math.round(((last - prev) / prev) * 100) : 0

  const directPractices = data.practices.filter((p) => !p.agency_id && p.subscription_status === 'active')
  const profit = o.totalMrr - costs.total
  const margin = o.totalMrr ? Math.round((profit / o.totalMrr) * 100) : 0

  // Churn analytics.
  const cancels = data.cancellations
  const monthAgo = Date.now() - 30 * 86400000
  const churnThisMonth = cancels.filter((c) => new Date(c.date).getTime() >= monthAgo).length
  const activeCount = o.activePractices || 1
  const churnRate = Math.round((churnThisMonth / (activeCount + churnThisMonth)) * 100)
  const tenures = cancels.map((c) => c.tenure_days).filter(Boolean)
  const avgTenure = tenures.length ? Math.round(tenures.reduce((s, t) => s + t, 0) / tenures.length) : null
  const reasonCounts = {}
  cancels.forEach((c) => { reasonCounts[c.reason] = (reasonCounts[c.reason] || 0) + 1 })
  const topReason = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])[0]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold text-white">Revenue</h1>
        <p className="text-sm text-slate-500">CaseLift business financials</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Total MRR" value={money(o.totalMrr)} icon={DollarSign} accent="text-emerald-300" />
        <StatCard label="Reseller revenue" value={money(o.agencyFees)} icon={Building2} />
        <StatCard label="Direct revenue" value={money(o.directRevenue)} icon={Stethoscope} />
        <StatCard label="MoM growth" value={`${mom >= 0 ? '+' : ''}${mom}%`} icon={TrendingUp} accent={mom >= 0 ? 'text-emerald-300' : 'text-rose-300'} />
        <StatCard label="Annual run rate" value={money(o.annualRunRate)} icon={Calendar} />
      </div>

      <StackedMRRChart data={series} milestones={MRR_MILESTONES} />

      {/* Agency revenue breakdown */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-white">Revenue by reseller</h2>
        <Table
          head={['Reseller', 'Locations', 'Fee / location', 'Monthly total', 'Since', 'Est. total paid']}
          rows={[
            ...data.agencies.map((a) => {
              const monthsActive = Math.max(1, Math.round((Date.now() - new Date(a.created_at).getTime()) / (30 * 86400000)))
              return [
                <span className="font-medium text-slate-100">{a.name}</span>,
                a.practiceCount,
                money(a.perLocationFee),
                money(a.mrrToCaseLift),
                new Date(a.created_at).toLocaleDateString(),
                money(a.mrrToCaseLift * monthsActive),
              ]
            }),
            [
              <span className="font-semibold text-white">Total</span>,
              data.agencies.reduce((s, a) => s + a.practiceCount, 0),
              '-',
              <span className="font-semibold text-emerald-300">{money(o.agencyFees)}</span>,
              '',
              '',
            ],
          ]}
        />
      </section>

      {/* Direct practices */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-white">Direct practices</h2>
        <Table
          head={['Practice', 'Location', 'Monthly', 'Status']}
          rows={directPractices.map((p) => [
            <span className="font-medium text-slate-100">{p.name}</span>,
            p.location || '-',
            money(PRICING.directPractice),
            <Badge className="bg-emerald-500/15 text-emerald-300">Active</Badge>,
          ])}
          empty="No direct practices - all revenue is via resellers."
        />
      </section>

      {/* CaseLift attribution by practice */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">CaseLift attribution by practice</h2>
          <span className="text-xs text-slate-500">
            {attrTotals.rate}% of closed cases had CaseLift touchpoints
          </span>
        </div>
        <Table
          head={['Practice', 'Closed cases', 'Attribution rate', 'Assisted', 'Recovered', 'Attributed production']}
          rows={[
            ...attributionRows.map((r) => [
              <span className="font-medium text-slate-100">{r.name}</span>,
              r.closedCount,
              <span className={r.attributionRate >= 50 ? 'text-emerald-300' : 'text-slate-300'}>{r.attributionRate}%</span>,
              money(r.assisted),
              money(r.recovered),
              <span className="font-semibold text-emerald-300">{money(r.total)}</span>,
            ]),
            ...(attributionRows.length
              ? [[
                  <span className="font-semibold text-white">Total</span>,
                  attrTotals.closed,
                  <span className="font-semibold text-white">{attrTotals.rate}%</span>,
                  '',
                  '',
                  <span className="font-semibold text-emerald-300">{money(attrTotals.attributed)}</span>,
                ]]
              : []),
          ]}
          empty="No attributed production yet - closed cases with CaseLift touchpoints will appear here."
        />
      </section>

      {/* Churn + costs */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Churn analysis</h2>
            <span className="text-xs text-slate-500">{churnRate}% this month · avg tenure {avgTenure ? `${avgTenure}d` : '-'}</span>
          </div>
          <Table
            head={['Practice', 'Reason', 'MRR lost', 'Date']}
            rows={cancels.map((c) => [
              <span className="text-slate-100">{c.practice}</span>,
              c.reason_label || reasonLabel(c.reason),
              <span className="text-rose-300">{money(c.mrr_lost)}</span>,
              new Date(c.date).toLocaleDateString(),
            ])}
            empty="No cancellations. 🎉"
          />
          {topReason && (
            <p className="text-xs text-slate-500">Most common reason: <span className="text-slate-300">{reasonLabel(topReason[0])}</span></p>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-white">Estimated costs & margin</h2>
          <div className="card divide-y divide-surface-700">
            <CostRow label="Supabase" value={costs.supabase} />
            <CostRow label="Anthropic API (consult volume)" value={costs.anthropic} />
            <CostRow label="Twilio (messaging)" value={costs.twilio} />
            <CostRow label="Mailgun" value={costs.mailgun} />
            <CostRow label="Total costs" value={costs.total} bold />
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm font-semibold text-white">Est. profit ({margin}% margin)</span>
              <span className="text-sm font-bold text-emerald-300">{money(profit)}/mo</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

function CostRow({ label, value, bold }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className={`text-sm ${bold ? 'font-semibold text-white' : 'text-slate-300'}`}>{label}</span>
      <span className={`text-sm ${bold ? 'font-semibold text-white' : 'text-slate-400'}`}>{money(value)}/mo</span>
    </div>
  )
}
