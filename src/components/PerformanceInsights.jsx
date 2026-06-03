import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, LineChart, Line, CartesianGrid,
} from 'recharts'
import { Sparkles, Network, GraduationCap } from 'lucide-react'
import { supabase } from '../lib/supabase'

const OBJ_COLORS = { price: '#f59e0b', fear: '#ef4444', spouse: '#a855f7', timing: '#3b82f6', other: '#94a3b8' }
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
function parseDate(d) {
  if (!d) return null
  const [y, m, day] = String(d).split('-').map(Number)
  return y ? new Date(y, m - 1, day) : new Date(d)
}
const WON = ['active', 'closed_won', 'recovered']

function Panel({ title, children }) {
  return (
    <div className="card p-5">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </div>
  )
}

export default function PerformanceInsights({ consults = [], messages = [], comparison, practiceId }) {
  const [tip, setTip] = useState(null)

  useEffect(() => {
    if (!practiceId) return
    let on = true
    supabase.from('ai_learning_events')
      .select('title, description, created_at')
      .eq('practice_id', practiceId)
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }) => { if (on) setTip(data?.[0] || null) })
    return () => { on = false }
  }, [practiceId])

  // Recording trend - consults recorded per week, last 4 weeks.
  const recordingTrend = useMemo(() => {
    const weeks = []
    const now = new Date(); now.setHours(0, 0, 0, 0)
    const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7))
    for (let i = 3; i >= 0; i--) {
      const start = new Date(monday); start.setDate(monday.getDate() - i * 7)
      const end = new Date(start); end.setDate(start.getDate() + 7)
      const n = consults.filter((c) => { const d = parseDate(c.recording_date); return d && d >= start && d < end }).length
      weeks.push({ label: i === 0 ? 'This wk' : `${i}w ago`, count: n })
    }
    return weeks
  }, [consults])

  // Best message - reply rate per sequence position.
  const bestMessage = useMemo(() => {
    const byConsult = new Map()
    for (const m of messages) {
      if (!byConsult.has(m.consult_id)) byConsult.set(m.consult_id, [])
      byConsult.get(m.consult_id).push(m)
    }
    const pos = {}
    for (const arr of byConsult.values()) {
      const sorted = [...arr].sort((a, b) => new Date(a.scheduled_for || a.created_at) - new Date(b.scheduled_for || b.created_at))
      sorted.forEach((m, i) => {
        if (i > 5) return
        if (!pos[i]) pos[i] = { sent: 0, replied: 0 }
        pos[i].sent += 1
        if (m.status === 'replied') pos[i].replied += 1
      })
    }
    return Array.from({ length: 6 }, (_, i) => ({
      label: `${i + 1}`,
      rate: pos[i]?.sent ? Math.round((pos[i].replied / pos[i].sent) * 100) : 0,
    }))
  }, [messages])

  // Objection breakdown - this month.
  const objection = useMemo(() => {
    const thisKey = monthKey(new Date())
    const tally = {}
    consults.forEach((c) => {
      const d = parseDate(c.recording_date)
      if (!d || monthKey(d) !== thisKey) return
      const k = c.objection_type || 'other'
      tally[k] = (tally[k] || 0) + 1
    })
    return Object.entries(tally).map(([name, value]) => ({ name, value, color: OBJ_COLORS[name] || OBJ_COLORS.other }))
  }, [consults])

  // Close rate trend - last 3 months (won / total).
  const closeTrend = useMemo(() => {
    const out = []
    const now = new Date()
    for (let i = 2; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = monthKey(d)
      const rows = consults.filter((c) => { const cd = parseDate(c.recording_date); return cd && monthKey(cd) === key })
      const won = rows.filter((c) => WON.includes(c.status)).length
      out.push({ label: d.toLocaleDateString(undefined, { month: 'short' }), rate: rows.length ? Math.round((won / rows.length) * 100) : 0 })
    }
    return out
  }, [consults])

  const youClose = Math.round((comparison?.practice?.closeRate || 0) * 100)
  const netClose = Math.round((comparison?.network?.closeRate || 28) * 100)
  const axis = { fontSize: 11, fill: 'var(--text-muted)' }

  return (
    <div className="space-y-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
        <Sparkles className="h-4 w-4 text-primary-400" /> Performance Insights
      </h2>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Recording rate trend">
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={recordingTrend}>
              <XAxis dataKey="label" tick={axis} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: 'rgba(148,163,184,0.1)' }} contentStyle={{ fontSize: 12, borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
              <Bar dataKey="count" fill="#0EA5E9" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Best performing message (reply %)">
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={bestMessage}>
              <XAxis dataKey="label" tick={axis} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: 'rgba(148,163,184,0.1)' }} contentStyle={{ fontSize: 12, borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} formatter={(v) => [`${v}%`, 'Reply rate']} />
              <Bar dataKey="rate" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Objection breakdown (this month)">
          {objection.length ? (
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={objection} dataKey="value" nameKey="name" innerRadius={42} outerRadius={64} paddingAngle={2}>
                  {objection.map((o) => <Cell key={o.name} fill={o.color} />)}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <p className="py-12 text-center text-sm text-slate-500">No consults this month yet.</p>}
          <div className="mt-2 flex flex-wrap justify-center gap-3">
            {objection.map((o) => (
              <span key={o.name} className="flex items-center gap-1.5 text-xs capitalize text-slate-400">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: o.color }} /> {o.name} ({o.value})
              </span>
            ))}
          </div>
        </Panel>

        <Panel title="Close rate trend (3 months)">
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={closeTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={axis} axisLine={false} tickLine={false} />
              <YAxis tick={axis} axisLine={false} tickLine={false} width={28} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} formatter={(v) => [`${v}%`, 'Close rate']} />
              <Line type="monotone" dataKey="rate" stroke="#0EA5E9" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      {/* Network comparison row */}
      <div className="card flex flex-wrap items-center gap-x-2 gap-y-1 p-4 text-sm">
        <Network className="h-4 w-4 text-primary-400" />
        <span className="text-slate-300">Your close rate <span className="font-bold text-white">{youClose}%</span></span>
        <span className="text-slate-600">·</span>
        <span className="text-slate-400">Network avg {netClose}%</span>
        <span className="text-slate-600">·</span>
        <span className={`font-semibold ${youClose >= netClose ? 'text-emerald-400' : 'text-amber-400'}`}>
          {youClose >= netClose ? "You're above average" : 'Room to grow'}
        </span>
      </div>

      {/* AI coaching tip */}
      {tip && (
        <div className="card flex items-start gap-3 border-l-2 border-l-primary p-4">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary-400" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">{tip.title || 'Coaching tip'}</p>
            {tip.description && <p className="mt-1 text-sm leading-relaxed text-slate-400">{tip.description}</p>}
            <Link to="/training" className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary-300 hover:underline">
              <GraduationCap className="h-3.5 w-3.5" /> Related training →
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
