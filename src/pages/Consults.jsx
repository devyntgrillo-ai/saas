import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Mic, Calendar, Search, CheckCircle2, Clock, Check, Circle,
  Plug, ArrowRight,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useRecorder } from '../context/RecorderContext'
import { supabase } from '../lib/supabase'

const TYPE_RE = /consult|implant/i
const todayStr = () => new Date().toLocaleDateString('en-CA') // YYYY-MM-DD, local

// Seed/PMS times are stored as wall-clock in UTC; render in UTC so 8:00 shows
// as 8:00 AM rather than being shifted by the viewer's timezone.
function fmtTime(ts) {
  if (!ts) return '-'
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).toLowerCase().replace(' ', '')
}
function fullName(a) {
  return [a.patient_first, a.patient_last].filter(Boolean).join(' ') || 'Unknown patient'
}
function statusOf(a) {
  if (a.consult_id) return 'recorded'
  const start = new Date(); start.setHours(0, 0, 0, 0)
  return new Date(a.appointment_time) < start ? 'missed' : 'needs'
}

// Day-sheet color coding: a faint full-row tint, green = recorded, red = not yet
// recorded (upcoming), gray = missed (past, never recorded).
const ROW_TINT = {
  recorded: 'bg-emerald-500/[0.06] hover:bg-emerald-500/[0.10]',
  needs:    'bg-rose-500/[0.07] hover:bg-rose-500/[0.12]',
  missed:   'bg-slate-500/[0.06] hover:bg-slate-500/[0.10]',
}
const STATUS = {
  recorded: { label: 'Recorded', dot: 'text-emerald-400', text: 'text-emerald-300', Icon: Check },
  needs:    { label: 'Not recorded', dot: 'text-rose-400', text: 'text-rose-300', Icon: Circle },
  missed:   { label: 'Missed', dot: 'text-slate-400', text: 'text-slate-400', Icon: Circle },
}

export default function Consults() {
  const { practice, practiceId } = useAuth()
  const { openRecorder } = useRecorder()
  const navigate = useNavigate()
  const connected = Boolean(practice?.sikka_connected || practice?.pms_connected)

  const [date, setDate] = useState(todayStr())
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [appts, setAppts] = useState([])
  const [allNote, setAllNote] = useState(false)
  const [unlinked, setUnlinked] = useState([])
  const [loading, setLoading] = useState(true)

  // A single day's schedule, PMS day-sheet style.
  const load = useCallback(async () => {
    if (!practiceId) return
    setLoading(true)
    const start = new Date(`${date}T00:00:00`)
    const end = new Date(start); end.setDate(end.getDate() + 1)
    const { data } = await supabase
      .from('pms_appointments')
      .select('*')
      .eq('practice_id', practiceId)
      .gte('appointment_time', start.toISOString())
      .lt('appointment_time', end.toISOString())
      .order('appointment_time', { ascending: true })
    const rows = data || []
    const consultRows = rows.filter((a) => TYPE_RE.test(a.appointment_type || ''))
    if (consultRows.length === 0 && rows.length > 0) { setAppts(rows); setAllNote(true) }
    else { setAppts(consultRows); setAllNote(false) }
    setLoading(false)
  }, [practiceId, date])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!practiceId) return
    let on = true
    supabase
      .from('consults')
      .select('id, patient_name, status, created_at')
      .eq('practice_id', practiceId)
      .is('appointment_id', null)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => { if (on) setUnlinked(data || []) })
    return () => { on = false }
  }, [practiceId])

  // Search + status filter applied to the day's rows.
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return appts.filter((a) => {
      if (statusFilter !== 'all' && statusOf(a) !== statusFilter) return false
      if (q && !fullName(a).toLowerCase().includes(q)) return false
      return true
    })
  }, [appts, statusFilter, search])

  const counts = useMemo(() => {
    const c = { all: appts.length, needs: 0, recorded: 0, missed: 0 }
    appts.forEach((a) => { c[statusOf(a)]++ })
    return c
  }, [appts])

  const STATUS_FILTERS = [
    { key: 'all', label: 'All', n: counts.all },
    { key: 'needs', label: 'Needs Recording', n: counts.needs },
    { key: 'recorded', label: 'Recorded', n: counts.recorded },
    { key: 'missed', label: 'Missed', n: counts.missed },
  ]

  const niceDate = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-white">Consults</h1>
            {counts.missed > 0 && (
              <span className="rounded-full bg-rose-500/15 px-2.5 py-0.5 text-xs font-semibold text-rose-300">
                {counts.missed} missed
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {niceDate} · {counts.all} consult{counts.all === 1 ? '' : 's'} · {counts.recorded} recorded · {counts.needs} to record
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input h-9 w-auto py-1 text-sm" />
        <div className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((f) => (
            <button key={f.key} onClick={() => setStatusFilter(f.key)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${statusFilter === f.key ? 'bg-primary/10 text-primary-300' : 'text-slate-400 hover:text-slate-200'}`}>
              {f.label} <span className="text-xs text-slate-500">({f.n})</span>
            </button>
          ))}
        </div>
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search patient name..." className="input pl-9" />
        </div>
      </div>

      {allNote && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Showing all appointments - no consult-type appointments found on this day.
        </p>
      )}

      {/* Body - classic PMS day-sheet table */}
      {!connected ? (
        <EmptyCard icon={Plug} title="Connect your PMS to see appointments here"
          action={<Link to="/settings/pms" className="btn-primary mt-4">Connect your PMS</Link>} />
      ) : loading ? (
        <div className="card flex justify-center py-16"><Clock className="h-6 w-6 animate-pulse text-slate-500" /></div>
      ) : appts.length === 0 ? (
        <EmptyCard icon={Calendar} title="CaseLift is ready to listen. Hit record to start your first consult." sub="Pick another date to view the schedule." />
      ) : rows.length === 0 ? (
        <EmptyCard icon={Calendar} title="No appointments match your filters" />
      ) : counts.recorded === counts.all ? (
        <RecordedTable rows={rows} navigate={navigate} openRecorder={openRecorder} caughtUp />
      ) : (
        <RecordedTable rows={rows} navigate={navigate} openRecorder={openRecorder} />
      )}

      {/* Unlinked recordings - recordings not tied to a scheduled appointment. */}
      {unlinked.length > 0 && (
        <section className="space-y-1.5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Unlinked recordings</h2>
          <div className="divide-y divide-surface-700/60 rounded-lg border border-dashed border-surface-700 bg-surface-800/30">
            {unlinked.map((c) => (
              <div key={c.id} className="flex items-center gap-3 px-4 py-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-slate-400">
                  {c.patient_name || `Consult · ${new Date(c.created_at).toLocaleDateString()}`}
                </span>
                <span className="shrink-0 rounded-full bg-surface-700 px-2 py-0.5 text-[11px] capitalize text-slate-400">{c.status || 'pending'}</span>
                <span className="shrink-0 text-slate-500">{new Date(c.created_at).toLocaleDateString()}</span>
                <Link to={`/consults/${c.id}`} className="inline-flex shrink-0 items-center gap-0.5 font-medium text-primary-300 transition hover:text-primary-200">
                  View <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// The day-sheet itself: one row per appointment, color-coded by status. The
// patient name links to the consult detail when recorded; otherwise the row
// click starts a recording for that appointment.
function RecordedTable({ rows, navigate, openRecorder, caughtUp }) {
  return (
    <div className="card overflow-hidden">
      {caughtUp && (
        <div className="flex items-center gap-2 border-b border-surface-700 bg-emerald-500/[0.06] px-4 py-2 text-xs font-medium text-emerald-300">
          <CheckCircle2 className="h-4 w-4" /> All caught up - every consult on this day has been recorded.
        </div>
      )}

      {/* Column header */}
      <div className="hidden items-center gap-3 border-b border-surface-700 bg-surface-800/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:flex">
        <span className="w-[70px] shrink-0">Time</span>
        <span className="flex-1">Patient</span>
        <span className="w-[140px] shrink-0">Status</span>
        <span className="w-[150px] shrink-0 text-right">Action</span>
      </div>

      <div className="divide-y divide-surface-700/70">
        {rows.map((a) => {
          const s = statusOf(a)
          const cfg = STATUS[s]
          const recorded = s === 'recorded'
          const goDetail = () => navigate(`/consults/${a.consult_id}`)
          const onRow = recorded ? goDetail : () => openRecorder(a)
          return (
            <div
              key={a.id}
              onClick={onRow}
              className={`flex min-h-[60px] cursor-pointer items-center gap-3 px-4 transition ${ROW_TINT[s]}`}
            >
              {/* Time - folded into the subtitle on mobile */}
              <span className="hidden w-[70px] shrink-0 text-sm tabular-nums text-slate-400 sm:block">{fmtTime(a.appointment_time)}</span>

              {/* Patient - name links to detail when recorded */}
              <div className="min-w-0 flex-1 py-3">
                {recorded ? (
                  <Link
                    to={`/consults/${a.consult_id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="block truncate text-sm font-medium text-slate-100 underline-offset-2 hover:text-white hover:underline"
                  >
                    {fullName(a)}
                  </Link>
                ) : (
                  <p className="truncate text-sm font-medium text-slate-100">{fullName(a)}</p>
                )}
                <p className="truncate text-xs text-slate-500">
                  {a.appointment_type || 'Consult'}{a.provider ? ` · ${a.provider}` : ''}
                  <span className="sm:hidden"> · {fmtTime(a.appointment_time)}</span>
                </p>
                {/* Mobile-only status chip (the dedicated Status column is sm+) */}
                <span className={`mt-1.5 inline-flex items-center gap-1 text-xs font-medium sm:hidden ${cfg.text}`}>
                  <cfg.Icon className={`h-3 w-3 ${cfg.dot} ${s === 'recorded' ? 'fill-current' : ''}`} />
                  {cfg.label}
                </span>
              </div>

              {/* Status (desktop column) */}
              <span className={`hidden w-[140px] shrink-0 items-center gap-1.5 text-sm font-medium sm:flex ${cfg.text}`}>
                <cfg.Icon className={`h-3.5 w-3.5 ${cfg.dot} ${s === 'recorded' ? 'fill-current' : ''}`} />
                {cfg.label}
              </span>

              {/* Action */}
              <div className="flex shrink-0 items-center justify-end sm:w-[150px]" onClick={(e) => e.stopPropagation()}>
                {recorded ? (
                  <button onClick={goDetail} className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3.5 py-1.5 text-sm font-medium text-green-700 transition hover:bg-green-200">
                    <Check className="h-4 w-4" /> View
                  </button>
                ) : (
                  <button onClick={() => openRecorder(a)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold !text-white shadow-sm transition hover:bg-primary-700">
                    <Mic className="h-4 w-4" /> Record
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function EmptyCard({ icon: Icon, title, sub, action, accent }) {
  return (
    <div className="card px-6 py-16 text-center">
      <Icon className={`mx-auto h-9 w-9 ${accent ? 'text-emerald-400' : 'text-slate-600'}`} />
      <p className="mt-3 text-sm font-medium text-slate-300">{title}</p>
      {sub && <p className="mt-1 text-sm text-slate-500">{sub}</p>}
      {action}
    </div>
  )
}
