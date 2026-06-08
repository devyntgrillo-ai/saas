import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { DollarSign, Stethoscope, Building2, TrendingDown, TrendingUp, Calendar } from 'lucide-react'
import { useAdmin } from '../../context/AdminContext'
import { computeOverview, computeMonthlySignupsChurn, agencyStatusMeta, mrrSeries12, MRR_MILESTONES } from '../../lib/admin'
import { timeAgo } from '../../lib/consults'
import { StackedMRRChart, SignupsChurnChart } from '../../components/admin/charts'
import { StatCard, Table, Badge, Avatar, money, stop } from '../../components/admin/ui'
import { useAdminAttribution } from '../../lib/queries'

const TONE_DOT = { good: 'bg-emerald-400', bad: 'bg-rose-400', neutral: 'bg-sky-400' }

// Merged Overview + Revenue: the at-a-glance health + financials dashboard.
export default function Dashboard() {
  const { data, impersonateAgency } = useAdmin()
  const navigate = useNavigate()
  const o = computeOverview(data)
  const series = useMemo(() => mrrSeries12(data.mrrHistory), [data.mrrHistory])

  // MoM growth from the last two points of the 12-month series.
  const last = series[series.length - 1]?.total || 0
  const prev = series[series.length - 2]?.total || 0
  const mom = prev ? Math.round(((last - prev) / prev) * 100) : 0

  const signupsChurn = useMemo(
    () => computeMonthlySignupsChurn(data.practices, data.cancellations),
    [data.practices, data.cancellations],
  )

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

  // Revenue by reseller (locations / fee / monthly / since / est. total paid) +
  // status + impersonate.
  const revenueByReseller = data.agencies.map((a) => {
    const monthsActive = Math.max(1, Math.round((Date.now() - new Date(a.created_at).getTime()) / (30 * 86400000)))
    const locations = a.activePracticeCount ?? a.practiceCount
    return [
      <span className="font-medium text-slate-100">{a.name}</span>,
      locations,
      money(a.perLocationFee),
      money(a.mrrToCaseLift),
      new Date(a.created_at).toLocaleDateString(),
      money(a.mrrToCaseLift * monthsActive),
      <Badge className={agencyStatusMeta(a.status).classes}>{agencyStatusMeta(a.status).label}</Badge>,
      <div className="flex items-center gap-1.5" onClick={stop}>
        <button onClick={() => impersonateAgency(a)} className="rounded-md border border-surface-700 bg-surface-800 px-2 py-1 text-xs text-primary-300 transition hover:bg-surface-700">
          Impersonate
        </button>
      </div>,
    ]
  })
  revenueByReseller.push([
    <span className="font-semibold text-white">Total</span>,
    data.agencies.reduce((s, a) => s + (a.activePracticeCount ?? a.practiceCount), 0),
    '-',
    <span className="font-semibold text-emerald-300">{money(o.agencyFees)}</span>,
    '', '', '', '',
  ])

  return (
    <div className="space-y-8">
      {/* Top stats - 6 cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Total MRR" value={money(o.totalMrr)} icon={DollarSign} accent="text-emerald-300" sub={`${money(o.annualRunRate)} ARR`} />
        <StatCard label="Active practices" value={o.activePractices} icon={Stethoscope} />
        <StatCard label="Active resellers" value={o.activeAgencies} icon={Building2} />
        <StatCard label="Churn this month" value={o.churnThisMonth} icon={TrendingDown} accent={o.churnThisMonth ? 'text-rose-300' : 'text-white'} />
        <StatCard label="MoM growth" value={`${mom >= 0 ? '+' : ''}${mom}%`} icon={TrendingUp} accent={mom >= 0 ? 'text-emerald-300' : 'text-rose-300'} />
        <StatCard label="Annual run rate" value={money(o.annualRunRate)} icon={Calendar} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <StackedMRRChart data={series} milestones={MRR_MILESTONES} />
        <SignupsChurnChart data={signupsChurn} />
      </div>

      {/* Revenue by reseller - full width */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-white">Revenue by reseller</h2>
        <Table
          head={['Reseller', 'Active locations', 'Fee / location', 'Monthly total', 'Since', 'Est. total paid', 'Status', '']}
          rows={revenueByReseller}
          empty="No resellers yet."
          icon={Building2}
        />
      </section>

      {/* Attribution + activity */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">CaseLift attribution by practice</h2>
            <span className="text-xs text-slate-500">{attrTotals.rate}% of closed cases had CaseLift touchpoints</span>
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
                    '', '',
                    <span className="font-semibold text-emerald-300">{money(attrTotals.attributed)}</span>,
                  ]]
                : []),
            ]}
            empty="No attributed production yet - closed cases with CaseLift touchpoints will appear here."
          />
        </section>
        <ActivityFeed events={data.activity} />
      </div>
    </div>
  )
}

function ActivityFeed({ events }) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-white">Recent activity</h2>
      <div className="card divide-y divide-surface-700">
        {(events || []).map((e) => (
          <div key={e.id} className="flex items-start gap-3 px-4 py-3">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE_DOT[e.tone] || 'bg-slate-500'}`} />
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-snug text-slate-200">{e.text}</p>
              <p className="mt-0.5 text-xs text-slate-500">{timeAgo(e.ts)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
