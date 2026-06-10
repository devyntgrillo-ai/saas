import { useMemo } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import {
  DollarSign,
  PhoneCall,
  Target,
  Trophy,
  AlertTriangle,
  Building2,
  ChevronRight,
  Wallet,
} from 'lucide-react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import { useAuth } from '../context/AuthContext'
import { useAgencyAnalytics, useAgencyOverview } from '../lib/queries'
import { commissionRate } from '../lib/resellerSaas'
import { formatMoney } from '../lib/analytics'
import { isWonStatus } from '../lib/consults'
import StatCard from '../components/StatCard'
import { SkeletonStatGrid, Skeleton } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import ErrorState, { friendlyError } from '../components/ErrorState'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const tooltipStyle = {
  contentStyle: { background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '0.5rem', fontSize: '0.8rem', color: 'var(--text-primary)' },
  labelStyle: { color: 'var(--text-secondary)' },
}
function parseDate(d) {
  if (!d) return null
  const [y, m, day] = String(d).split('-').map(Number)
  return y ? new Date(y, m - 1, day) : new Date(d)
}
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const isWon = (c) => isWonStatus(c.status)

const SUB_BADGE = {
  active: 'bg-emerald-500/15 text-emerald-300',
  trial: 'bg-amber-500/15 text-amber-300',
  trialing: 'bg-amber-500/15 text-amber-300',
  past_due: 'bg-rose-500/15 text-rose-300',
  cancelled: 'bg-slate-500/15 text-slate-400',
  canceled: 'bg-slate-500/15 text-slate-400',
}

export default function AgencyAnalytics() {
  const { effectiveAgency: agency, isAgencyView, contextLoading, viewPractice } = useAuth()
  const navigate = useNavigate()
  const { data: agencyData, isLoading: loading, error, refetch } = useAgencyAnalytics(agency?.id)
  const practices = agencyData?.practices ?? []
  const consults = agencyData?.consults ?? []

  // Reseller business KPIs (stacked MRR, active/total subaccounts, recovered
  // production) + clients to nudge. Sourced from the overview rollup so the
  // Dashboard surfaces the reseller-facing numbers; the Subaccounts tab is just
  // the searchable client list.
  const { data: overview } = useAgencyOverview(agency?.id)
  const rollup = overview?.rollup || { totalCount: 0, activeCount: 0, recovered: 0 }
  const rate = commissionRate(agency)
  const yourCommission = rollup.activeCount * rate
  // Clients to nudge: BAA unsigned, stale, or low recording rate. Memoized so the
  // current-time check stays out of the render path. Each row carries its reasons.
  const needsAttention = useMemo(() => {
    const now = new Date().getTime()
    const m = overview?.metrics || {}
    const reasonsFor = (p) => {
      const pm = m[p.id] || {}
      const r = []
      if (!p.baa_accepted_at) r.push('BAA pending')
      if (!pm.lastActivity || now - new Date(pm.lastActivity).getTime() > 14 * 86400000) r.push('No recent activity')
      if (pm.recordingRate && pm.recordingRate.total > 0 && pm.recordingRate.rate < 50) r.push(`Low recording (${pm.recordingRate.rate}%)`)
      return r
    }
    return (overview?.practices || [])
      .filter((p) => !p.archived_at)
      .map((p) => ({ ...p, reasons: reasonsFor(p) }))
      .filter((p) => p.reasons.length > 0)
  }, [overview])
  const impersonate = (p) => { viewPractice(p.id); navigate('/') }

  const metrics = useMemo(() => {
    const now = new Date()
    const thisKey = monthKey(now)
    const byPractice = new Map(practices.map((p) => [p.id, { ...p, consults: 0, won: 0, recoveredMonth: 0, lastDate: null }]))

    let totalRecoveredMonth = 0
    let totalConsults = consults.length

    const trendMap = new Map()
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      trendMap.set(monthKey(d), { label: MONTHS[d.getMonth()], value: 0 })
    }

    for (const c of consults) {
      const p = byPractice.get(c.practice_id)
      if (p) {
        p.consults += 1
        if (isWon(c)) p.won += 1
      }
      const d = parseDate(c.recording_date)
      if (!d) continue
      if (p && (!p.lastDate || d > p.lastDate)) p.lastDate = d
      const k = monthKey(d)
      if (isWon(c)) {
        const val = Number(c.case_value) || 0
        if (k === thisKey) {
          totalRecoveredMonth += val
          if (p) p.recoveredMonth += val
        }
        if (trendMap.has(k)) trendMap.get(k).value += val
      }
    }

    const practiceRows = [...byPractice.values()]
    const totalWon = practiceRows.reduce((s, p) => s + p.won, 0)
    const avgCloseRate = totalConsults ? Math.round((totalWon / totalConsults) * 100) : 0

    const top = [...practiceRows].sort((a, b) => b.recoveredMonth - a.recoveredMonth)[0] || null

    // Needs attention: no consults in 7 days OR high pending count.
    const weekAgo = new Date()
    weekAgo.setDate(weekAgo.getDate() - 7)
    const needsAttention = practiceRows
      .map((p) => {
        const stale = !p.lastDate || p.lastDate < weekAgo
        const reasons = []
        if (stale) reasons.push('No consults in 7+ days')
        return { ...p, stale, reasons }
      })
      .filter((p) => p.reasons.length > 0)

    return {
      totalRecoveredMonth,
      totalConsults,
      avgCloseRate,
      top,
      trend: [...trendMap.values()],
      needsAttention,
      practiceRows,
    }
  }, [consults, practices])

  if (!contextLoading && !isAgencyView) return <Navigate to="/" replace />

  return (
    <div className="space-y-6">
      {/* Header + tabs to mirror the Agency portal */}
      <div className="flex items-center gap-3">
        {agency?.logo_url ? (
          <img src={agency.logo_url} alt="" className="h-10 w-10 rounded-lg object-cover" />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary-400">
            <Building2 className="h-5 w-5" />
          </div>
        )}
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">{agency?.company_name || agency?.brand_name || agency?.name || 'Reseller'} Analytics</h1>
          <p className="text-sm text-slate-400">Performance across all client practices.</p>
        </div>
      </div>


      {loading ? (
        <>
          <SkeletonStatGrid count={4} />
          <Skeleton className="h-72" />
        </>
      ) : error ? (
        <ErrorState message={friendlyError(error)} onRetry={() => refetch()} />
      ) : practices.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No practices yet"
          description="Add your first client practice to start seeing reseller-wide analytics."
          to="/agency"
          actionLabel="Go to overview"
        />
      ) : (
        <>
          {/* Reseller business KPIs */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="card p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-slate-400">Your Commission</p>
                <Wallet className="h-4 w-4 text-slate-500" />
              </div>
              <p className="mt-1 text-2xl font-bold text-emerald-300">{formatMoney(yourCommission)}/mo</p>
              <p className="mt-0.5 text-xs text-slate-500">{rollup.activeCount} active × {formatMoney(rate)}/mo</p>
            </div>
            <div className="card p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-slate-400">Referred practices</p>
                <Building2 className="h-4 w-4 text-slate-500" />
              </div>
              <p className="mt-1 text-2xl font-bold text-white">{rollup.activeCount}</p>
              <p className="mt-0.5 text-xs text-slate-500">active of {rollup.totalCount} total</p>
            </div>
            <div className="card p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-slate-400">Recovered for clients</p>
                <DollarSign className="h-4 w-4 text-slate-500" />
              </div>
              <p className="mt-1 text-2xl font-bold text-white">{formatMoney(rollup.recovered)}</p>
              <p className="mt-0.5 text-xs text-slate-500">production your clients recovered</p>
            </div>
            <div className="card p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-slate-400">Need attention</p>
                <AlertTriangle className={`h-4 w-4 ${needsAttention.length ? 'text-amber-400' : 'text-slate-500'}`} />
              </div>
              <p className={`mt-1 text-2xl font-bold ${needsAttention.length ? 'text-amber-300' : 'text-white'}`}>{needsAttention.length}</p>
              <p className="mt-0.5 text-xs text-slate-500">clients to nudge</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Recovered this month" value={formatMoney(metrics.totalRecoveredMonth)} icon={DollarSign} accent="green" />
            <StatCard label="Total consults" value={metrics.totalConsults} icon={PhoneCall} accent="primary" />
            <StatCard label="Avg close rate" value={`${metrics.avgCloseRate}%`} icon={Target} accent="violet" />
            <StatCard label="Top practice" value={metrics.top?.name || '-'} icon={Trophy} accent="amber" />
          </div>

          {/* Revenue recovered trend */}
          <div className="card p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <DollarSign className="h-4 w-4 text-emerald-400" /> Revenue recovered (all locations)
            </h2>
            <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={metrics.trend} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="agRev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={formatMoney} />
                  <Tooltip {...tooltipStyle} formatter={(v) => [formatMoney(v), 'Recovered']} />
                  <Area type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2.5} fill="url(#agRev)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Practices that need attention */}
          <div>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-300">
              <AlertTriangle className="h-4 w-4 text-amber-400" /> Practices that need attention
            </h2>
            {needsAttention.length === 0 ? (
              <div className="card px-5 py-8 text-center text-sm text-slate-500">
                All practices are active. Nothing needs attention right now.
              </div>
            ) : (
              <div className="card overflow-hidden">
                <ul className="divide-y divide-surface-700">
                  {needsAttention.map((p) => (
                    <li key={p.id}>
                      <button
                        onClick={() => impersonate(p)}
                        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition hover:bg-surface-800/40"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-slate-200">{p.name}</span>
                          <span className="block truncate text-xs text-amber-300/90">{p.reasons.join(' · ')}</span>
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-slate-600" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Your referred practices, moved from the old SaaS Mode active-clients list */}
          <div>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-300">
              <Building2 className="h-4 w-4 text-slate-400" /> Your referred practices
            </h2>
            <div className="card overflow-hidden">
              <ul className="divide-y divide-surface-700">
                {practices.filter((p) => !p.archived_at).map((p) => {
                  const st = p.subscription_status || 'active'
                  return (
                    <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <span className="min-w-0 truncate text-sm font-medium text-slate-200">{p.name}</span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize ${SUB_BADGE[st] || 'bg-surface-700 text-slate-300'}`}>
                        {String(st).replace('_', ' ')}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
