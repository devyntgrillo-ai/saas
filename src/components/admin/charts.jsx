import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts'

const AXIS = { stroke: '#475569', fontSize: 12 }
const GRID = 'var(--border)'
const tooltipStyle = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)', color: 'var(--text-primary)',
  borderRadius: 8,
  fontSize: 12,
  color: '#e2e8f0',
}
const money = (v) => `$${Number(v).toLocaleString()}`

function ChartEmpty({ title, subtitle, message = 'No historical data yet.' }) {
  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      {subtitle ? <p className="mb-3 text-xs text-slate-500">{subtitle}</p> : null}
      <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed border-surface-700 bg-surface-900/40 px-4 text-center text-sm text-slate-500">
        {message}
      </div>
    </div>
  )
}

// MRR growth: actual line for past months + a dashed projected continuation.
export function MRRGrowthChart({ data }) {
  if (!data?.length) {
    return (
      <ChartEmpty
        title="MRR growth"
        subtitle="Last 6 months + projection"
        message="MRR history is not tracked yet. Totals above reflect current subscriptions."
      />
    )
  }
  // Append a projected next 2 months (~12% MoM growth) as a dashed line.
  const last = data[data.length - 1]?.total || 0
  const projected = [
    { month: '+1mo', projected: Math.round(last * 1.12) },
    { month: '+2mo', projected: Math.round(last * 1.25) },
  ]
  const merged = [
    ...data.map((d) => ({ month: d.month, actual: d.total })),
    { month: last ? data[data.length - 1].month : '', actual: last, projected: last },
    ...projected,
  ]
  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold text-white">MRR growth</h3>
      <p className="mb-3 text-xs text-slate-500">Last 6 months + projection</p>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={merged} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: GRID }} {...AXIS} />
          <YAxis tickFormatter={money} tickLine={false} axisLine={false} {...AXIS} width={60} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => money(v)} />
          <Line type="monotone" dataKey="actual" stroke="#0EA5E9" strokeWidth={2.5} dot={{ r: 3 }} name="Actual" />
          <Line type="monotone" dataKey="projected" stroke="#94A3B8" strokeWidth={2} strokeDasharray="5 4" dot={false} name="Projected" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// New signups (green) vs churn (red) per month.
export function SignupsChurnChart({ data }) {
  const empty = !data?.length || data.every((d) => !d.signups && !d.churn)
  if (empty) {
    return (
      <ChartEmpty
        title="Signups vs churn"
        subtitle="Last 6 months"
        message="No signups or churn recorded in the last six months."
      />
    )
  }
  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold text-white">Signups vs churn</h3>
      <p className="mb-3 text-xs text-slate-500">Last 6 months</p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: GRID }} {...AXIS} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} {...AXIS} width={28} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="signups" fill="#10b981" radius={[3, 3, 0, 0]} name="Signups" />
          <Bar dataKey="churn" fill="#f43f5e" radius={[3, 3, 0, 0]} name="Churn" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// Stacked MRR: agency revenue vs direct revenue, with milestone reference lines.
export function StackedMRRChart({ data, milestones = [] }) {
  if (!data?.length) {
    return (
      <ChartEmpty
        title="MRR by source"
        subtitle="Last 12 months · reseller vs direct"
        message="Historical MRR breakdown is not available yet. Current MRR totals are shown above."
      />
    )
  }
  const max = Math.max(...data.map((d) => d.total), 0)
  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold text-white">MRR by source</h3>
      <p className="mb-3 text-xs text-slate-500">Last 12 months · reseller vs direct</p>
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={data} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
          <defs>
            <linearGradient id="gAgency" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#0EA5E9" stopOpacity={0.6} />
              <stop offset="95%" stopColor="#0EA5E9" stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="gDirect" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.6} />
              <stop offset="95%" stopColor="#22d3ee" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: GRID }} {...AXIS} />
          <YAxis tickFormatter={money} tickLine={false} axisLine={false} {...AXIS} width={60} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => money(v)} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {milestones
            .filter((m) => m.value <= max * 1.1)
            .map((m) => (
              <ReferenceLine
                key={m.value}
                y={m.value}
                stroke="#475569"
                strokeDasharray="4 4"
                label={{ value: m.label, fill: '#64748b', fontSize: 11, position: 'right' }}
              />
            ))}
          <Area type="monotone" dataKey="agency" stackId="1" stroke="#0EA5E9" fill="url(#gAgency)" name="Reseller" />
          <Area type="monotone" dataKey="direct" stackId="1" stroke="#22d3ee" fill="url(#gDirect)" name="Direct" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
