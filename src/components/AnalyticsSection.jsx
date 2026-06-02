import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  LineChart, Line,
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { DollarSign, TrendingUp, Target, Award } from 'lucide-react'
import StatCard from './StatCard'
import { supabase } from '../lib/supabase'
import { computeAnalytics, RANGES, OBJECTION_COLORS, formatMoney } from '../lib/analytics'

// Resolve the active (white-label) primary color into an rgb() string for charts.
function usePrimaryColor() {
  return useMemo(() => {
    if (typeof window === 'undefined') return 'rgb(37 99 235)'
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--primary-500').trim()
    return raw ? `rgb(${raw})` : 'rgb(59 130 246)'
  }, [])
}

const axis = { stroke: '#475569', fontSize: 11 }
const grid = '#1e2738'

function ChartCard({ title, subtitle, children, empty }) {
  return (
    <div className="card p-5">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      </div>
      {empty ? (
        <div className="flex h-56 items-center justify-center text-sm text-slate-600">No data in this range.</div>
      ) : (
        <div className="h-56">{children}</div>
      )}
    </div>
  )
}

const tooltipStyle = {
  contentStyle: { background: '#0f1521', border: '1px solid #1e2738', borderRadius: 10, fontSize: 12 },
  labelStyle: { color: '#cbd5e1' },
  itemStyle: { color: '#e2e8f0' },
}

export default function AnalyticsSection({ practiceId }) {
  const [range, setRange] = useState('6m')
  const [consults, setConsults] = useState([])
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const primary = usePrimaryColor()

  useEffect(() => {
    if (!practiceId) return
    let active = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    Promise.all([
      supabase.from('consults')
        .select('id, recording_date, status, objection_type, case_value')
        .eq('practice_id', practiceId),
      supabase.from('messages')
        .select('consult_id, channel, status, created_at, scheduled_for')
        .eq('practice_id', practiceId),
    ]).then(([c, m]) => {
      if (!active) return
      setConsults(c.data || [])
      setMessages(m.data || [])
      setLoading(false)
    })
    return () => { active = false }
  }, [practiceId])

  const a = useMemo(() => computeAnalytics(consults, messages, range), [consults, messages, range])

  const cards = [
    { label: 'Production recovered', value: formatMoney(a.stats.totalRecovered), icon: DollarSign, accent: 'green' },
    { label: 'Average case value', value: formatMoney(a.stats.avgCaseValue), icon: TrendingUp, accent: 'primary' },
    { label: 'Close rate this month', value: `${a.stats.closeRateThisMonth}%`, icon: Target, accent: 'violet' },
    { label: 'Best performing message', value: a.stats.bestMessage, icon: Award, accent: 'amber' },
  ]

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold tracking-tight text-white">Analytics</h2>
        <div className="flex gap-1 rounded-lg border border-surface-700 bg-surface-900 p-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={[
                'rounded-md px-3 py-1.5 text-xs font-medium transition',
                range === r.key ? 'bg-primary !text-white' : 'text-slate-400 hover:text-slate-200',
              ].join(' ')}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Top stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <StatCard key={c.label} label={c.label} value={loading ? '-' : c.value} icon={c.icon} accent={c.accent} />
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Production Recovered" subtitle="$ recovered per month" empty={!loading && a.production.length === 0}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={a.production} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid stroke={grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={{ stroke: grid }} />
              <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={formatMoney} width={48} />
              <Tooltip {...tooltipStyle} formatter={(v) => [formatMoney(v), 'Recovered']} />
              <Line type="monotone" dataKey="value" stroke="#34d399" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Consult Volume" subtitle="Consults per week" empty={!loading && a.volume.length === 0}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={a.volume} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid stroke={grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={{ stroke: grid }} interval="preserveStartEnd" />
              <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} width={28} />
              <Tooltip {...tooltipStyle} formatter={(v) => [v, 'Consults']} cursor={{ fill: 'rgba(148,163,184,0.08)' }} />
              <Bar dataKey="count" fill={primary} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Close Rate Trend" subtitle="% of consults closed-won per month" empty={!loading && a.closeRate.length === 0}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={a.closeRate} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid stroke={grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={{ stroke: grid }} />
              <YAxis tick={axis} tickLine={false} axisLine={false} width={36} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
              <Tooltip {...tooltipStyle} formatter={(v) => [`${v}%`, 'Close rate']} />
              <Line type="monotone" dataKey="rate" stroke="#a78bfa" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Objection Breakdown" subtitle="Why consults didn’t close" empty={!loading && a.objections.length === 0}>
          <div className="flex h-full items-center">
            <ResponsiveContainer width="60%" height="100%">
              <PieChart>
                <Pie data={a.objections} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2}>
                  {a.objections.map((o) => (
                    <Cell key={o.name} fill={OBJECTION_COLORS[o.name] || OBJECTION_COLORS.other} />
                  ))}
                </Pie>
                <Tooltip {...tooltipStyle} formatter={(v, n) => [v, n[0].toUpperCase() + n.slice(1)]} />
              </PieChart>
            </ResponsiveContainer>
            <ul className="flex-1 space-y-1.5 text-sm">
              {a.objections.map((o) => (
                <li key={o.name} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: OBJECTION_COLORS[o.name] || OBJECTION_COLORS.other }} />
                  <span className="capitalize text-slate-300">{o.name}</span>
                  <span className="ml-auto font-medium text-slate-400">{o.value}</span>
                </li>
              ))}
            </ul>
          </div>
        </ChartCard>

        <ChartCard title="Follow-up Performance" subtitle="Replies by message in the sequence" empty={!loading && a.followup.length === 0}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={a.followup} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid stroke={grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="position" tick={axis} tickLine={false} axisLine={{ stroke: grid }} />
              <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} width={28} />
              <Tooltip {...tooltipStyle}
                formatter={(v, n, p) => [`${v} replies (${p.payload.replyRate}% of ${p.payload.sent})`, p.payload.position]} />
              <Bar dataKey="replies" fill="#34d399" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </section>
  )
}
