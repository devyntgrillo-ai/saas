import { useEffect, useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, Cell, XAxis, Tooltip } from 'recharts'
import { fetchRecordingRate } from '../lib/pms'

const tooltipStyle = {
  contentStyle: { background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '0.5rem', fontSize: '0.75rem', color: 'var(--text-primary)' },
  labelStyle: { color: 'var(--text-secondary)' },
}

// Performance tiers drive the ring color, status pill, and bar fills. Solid
// palette values so they read well in both light and dark mode.
function perfOf(pct, empty) {
  if (empty) return { label: 'No consults yet', pill: 'bg-gray-100 text-gray-700', ring: 'text-slate-500' }
  if (pct >= 80) return { label: 'On track', pill: 'bg-emerald-100 text-emerald-700', ring: 'text-emerald-500' }
  if (pct >= 50) return { label: 'Room to improve', pill: 'bg-amber-100 text-amber-700', ring: 'text-amber-500' }
  return { label: 'Needs attention', pill: 'bg-rose-100 text-rose-700', ring: 'text-rose-500' }
}
function barFill(d) {
  if (!d.total) return 'rgba(148,163,184,0.25)'
  if (d.rate >= 80) return '#10b981'
  if (d.rate >= 50) return '#f59e0b'
  return '#f43f5e'
}

// Circular progress ring with the percentage centered. The arc uses
// `stroke="currentColor"` so a Tailwind text-color class themes it.
function Ring({ pct, colorClass, empty }) {
  const r = 34
  const c = 2 * Math.PI * r
  const offset = c - (c * (empty ? 0 : pct)) / 100
  return (
    <div className="relative h-[88px] w-[88px] shrink-0">
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" strokeWidth="8" stroke="currentColor" className="text-surface-700" />
        {!empty && (
          <circle
            cx="40" cy="40" r={r} fill="none" strokeWidth="8" strokeLinecap="round"
            stroke="currentColor" className={colorClass}
            strokeDasharray={c} strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.6s ease' }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xl font-semibold tabular-nums text-slate-100">{empty ? '-' : `${pct}%`}</span>
      </div>
    </div>
  )
}

// Recording rate metric + 4-week trend. Shown on the Dashboard.
export default function RecordingRateCard({ practiceId, compact = false }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!practiceId) return
    let active = true
    fetchRecordingRate(practiceId, 4)
      .then((d) => active && setData(d))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [practiceId])

  if (loading) return <div className="card h-44 animate-pulse bg-surface-800" />
  if (!data) return null

  const { current, trend } = data
  const empty = !current.total
  const pct = empty ? 0 : current.rate
  const perf = perfOf(pct, empty)

  const footnote = empty
    ? 'No consults scheduled this week yet.'
    : pct >= 100
      ? 'Every consult captured - nice work.'
      : 'Missing recordings = missed recovery opportunities.'

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-slate-300">Recording Rate</h2>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${perf.pill}`}>{perf.label}</span>
      </div>

      {/* Hero: ring + fraction */}
      <div className="mt-4 flex items-center gap-5">
        <Ring pct={pct} colorClass={perf.ring} empty={empty} />
        <div className="min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-semibold tabular-nums text-slate-100">{current.recorded}</span>
            <span className="text-lg font-medium tabular-nums text-slate-500">/ {current.total}</span>
          </div>
          <p className="mt-1 text-sm text-slate-400">CaseLift recorded {current.recorded} of {current.total} consults this week</p>
          <p className="mt-2 text-xs text-slate-500">{footnote}</p>
        </div>
      </div>

      {!compact && trend.length > 0 && (
        <div className="mt-5 border-t border-surface-700 pt-4">
          <p className="mb-1.5 text-[13px] text-slate-500">Last 4 weeks</p>
          <div className="h-24">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  {...tooltipStyle}
                  formatter={(v, _n, p) => [`${v}% (${p.payload.recorded}/${p.payload.total})`, 'Recorded']}
                  cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                />
                <Bar dataKey="rate" radius={[3, 3, 0, 0]}>
                  {trend.map((d, i) => (
                    <Cell key={i} fill={barFill(d)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
