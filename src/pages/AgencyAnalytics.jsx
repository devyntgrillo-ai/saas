import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import {
  DollarSign,
  PhoneCall,
  Target,
  Trophy,
  AlertTriangle,
  Building2,
  ChevronRight,
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
import { supabase } from '../lib/supabase'
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

export default function AgencyAnalytics() {
  const { agency, isAgencyUser, agencyLoading } = useAuth()
  const [practices, setPractices] = useState([])
  const [consults, setConsults] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (!agency?.id) return
    setLoading(true)
    setError(null)
    try {
      const { data: ps, error: pe } = await supabase
        .from('practices')
        .select('id, name')
        .eq('agency_id', agency.id)
      if (pe) throw pe
      const ids = (ps || []).map((p) => p.id)
      setPractices(ps || [])
      if (ids.length === 0) {
        setConsults([])
        setLoading(false)
        return
      }
      const { data: cs, error: ce } = await supabase
        .from('consults')
        .select('id, practice_id, recording_date, status, case_value')
        .in('practice_id', ids)
      if (ce) throw ce
      setConsults(cs || [])
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [agency?.id])

  // Load analytics on mount / agency change.
  useEffect(() => {
    load() // eslint-disable-line react-hooks/set-state-in-effect
  }, [load])

  const data = useMemo(() => {
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

  if (!agencyLoading && !isAgencyUser) return <Navigate to="/" replace />

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
          <h1 className="text-2xl font-bold tracking-tight text-white">{agency?.name || 'Reseller'} Analytics</h1>
          <p className="text-sm text-slate-400">Performance across all client practices.</p>
        </div>
      </div>


      {loading ? (
        <>
          <SkeletonStatGrid count={4} />
          <Skeleton className="h-72" />
        </>
      ) : error ? (
        <ErrorState message={friendlyError(error)} onRetry={load} />
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Recovered this month" value={formatMoney(data.totalRecoveredMonth)} icon={DollarSign} accent="green" />
            <StatCard label="Total consults" value={data.totalConsults} icon={PhoneCall} accent="primary" />
            <StatCard label="Avg close rate" value={`${data.avgCloseRate}%`} icon={Target} accent="violet" />
            <StatCard label="Top practice" value={data.top?.name || '-'} icon={Trophy} accent="amber" />
          </div>

          {/* Revenue recovered trend */}
          <div className="card p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <DollarSign className="h-4 w-4 text-emerald-400" /> Revenue recovered (all locations)
            </h2>
            <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.trend} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
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

          {/* Needs attention */}
          <div>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-300">
              <AlertTriangle className="h-4 w-4 text-amber-400" /> Practices that need attention
            </h2>
            {data.needsAttention.length === 0 ? (
              <div className="card px-5 py-8 text-center text-sm text-slate-500">
                All practices are active. Nothing needs attention right now.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {data.needsAttention.map((p) => (
                  <div key={p.id} className="card border-amber-500/20 p-4">
                    <div className="flex items-center justify-between">
                      <p className="truncate font-semibold text-slate-100">{p.name}</p>
                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-600" />
                    </div>
                    <ul className="mt-2 space-y-1">
                      {p.reasons.map((r) => (
                        <li key={r} className="flex items-center gap-1.5 text-xs text-amber-300">
                          <AlertTriangle className="h-3 w-3" /> {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
