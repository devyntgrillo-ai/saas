import { useNavigate } from 'react-router-dom'
import { DollarSign, Stethoscope, Building2, TrendingDown, Eye } from 'lucide-react'
import { useAdmin } from '../../context/AdminContext'
import { computeOverview, agencyStatusMeta } from '../../lib/admin'
import { timeAgo } from '../../lib/consults'
import { MRRGrowthChart, SignupsChurnChart } from '../../components/admin/charts'
import { StatCard, Table, Badge, Avatar, money, stop } from '../../components/admin/ui'

const TONE_DOT = { good: 'bg-emerald-400', bad: 'bg-rose-400', neutral: 'bg-sky-400' }

export default function Overview() {
  const { data, impersonateAgency } = useAdmin()
  const navigate = useNavigate()
  const o = computeOverview(data)

  // Signups vs churn - synthesized monthly series consistent with demo history.
  const signupsChurn = [
    { month: 'Dec', signups: 1, churn: 0 },
    { month: 'Jan', signups: 1, churn: 0 },
    { month: 'Feb', signups: 1, churn: 1 },
    { month: 'Mar', signups: 2, churn: 0 },
    { month: 'Apr', signups: 1, churn: 0 },
    { month: 'May', signups: 2, churn: o.churnThisMonth },
  ]

  const agencyRows = data.agencies.map((a) => [
    <div className="flex items-center gap-2.5">
      <Avatar name={a.name} color={a.white_label?.primary_color} />
      <span className="font-medium text-slate-100">{a.name}</span>
    </div>,
    a.owner_email || '-',
    a.practiceCount,
    money(a.mrrToCaseLift),
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
  ])

  return (
    <div className="space-y-8">
      {/* Top stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total MRR" value={money(o.totalMrr)} icon={DollarSign} accent="text-emerald-300" sub={`${money(o.annualRunRate)} annual run rate`} />
        <StatCard label="Active practices" value={o.activePractices} icon={Stethoscope} />
        <StatCard label="Active resellers" value={o.activeAgencies} icon={Building2} />
        <StatCard label="Churn this month" value={o.churnThisMonth} icon={TrendingDown} accent={o.churnThisMonth ? 'text-rose-300' : 'text-white'} />
      </div>

      {/* Health charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <MRRGrowthChart data={data.mrrHistory} />
        <SignupsChurnChart data={signupsChurn} />
      </div>

      {/* Agency table + activity feed */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-white">Reseller performance</h2>
          <Table
            head={['Reseller', 'Owner', 'Practices', 'MRR', 'Status', 'Joined', 'Last activity', '']}
            rows={agencyRows}
            empty="No resellers yet."
            icon={Building2}
            onRowClick={(i) => navigate(`/admin/agencies/${data.agencies[i].id}`)}
          />
        </div>
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
        {events.map((e) => (
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
