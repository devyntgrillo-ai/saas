import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Mic, Calendar, Search, CheckCircle2, Clock, Check, Circle, Loader2,
  Plug, ArrowRight,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useRecorder } from '../context/RecorderContext'
import { useConsultsDay, useUnlinkedConsults, useProcessingConsults, useRecentConsults, useConsultsRealtime } from '../lib/queries'
import { supabase } from '../lib/supabase'

const todayStr = () => new Date().toLocaleDateString('en-CA')

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

  const { data: dayData, isLoading: loading } = useConsultsDay(practiceId, date)
  const { data: unlinked = [] } = useUnlinkedConsults(practiceId)

  const appts = useMemo(() => dayData?.appts ?? [], [dayData])
  const allNote = dayData?.allNote ?? false

  // Consults still being transcribed/analyzed — shown as processing cards at the
  // top. Realtime (with a poll fallback) flips them to normal once 'analyzed'.
  const { data: processing = [] } = useProcessingConsults(practiceId)
  // Recently-completed consults (analysis done / errored) — shown as "complete"
  // cards so a freshly-recorded consult stays put instead of vanishing once it
  // leaves the processing state. Excludes any already shown as a scheduled row.
  const { data: recentDone = [] } = useRecentConsults(practiceId)
  useConsultsRealtime(practiceId)
  const processingIds = useMemo(() => new Set(processing.map((c) => c.id)), [processing])

  // Consult ids already represented as an appointment row in the current day's
  // view — those stay as rows (richer: time/type); everything else gets a card.
  const apptConsultIds = useMemo(
    () => new Set(appts.filter((a) => a.consult_id).map((a) => a.consult_id)),
    [appts]
  )
  const doneCards = useMemo(
    () => recentDone.filter((c) => !apptConsultIds.has(c.id) && !processingIds.has(c.id)),
    [recentDone, apptConsultIds, processingIds]
  )
  const doneCardIds = useMemo(() => new Set(doneCards.map((c) => c.id)), [doneCards])

  // Processing/Ready badges: appointments don't carry the consult's transcription
  // status, so fetch it for the recorded ones and refresh every 15s so a
  // "Processing" badge flips to "Ready" on its own.
  const recordedIds = useMemo(() => appts.filter((a) => a.consult_id).map((a) => a.consult_id), [appts])
  const recordedKey = recordedIds.join(',')
  const [consultStatus, setConsultStatus] = useState({})
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!recordedIds.length) { setConsultStatus({}); return }
    let active = true
    const load = () =>
      supabase.from('consults').select('id, status').in('id', recordedIds).then(({ data }) => {
        if (!active) return
        const m = {}
        ;(data || []).forEach((c) => { m[c.id] = c.status })
        setConsultStatus(m)
      })
    load()
    const t = setInterval(load, 15000)
    return () => { active = false; clearInterval(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordedKey])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return appts.filter((a) => {
      // Processing consults render as their own cards up top — don't duplicate.
      if (a.consult_id && processingIds.has(a.consult_id)) return false
      if (statusFilter !== 'all' && statusOf(a) !== statusFilter) return false
      if (q && !fullName(a).toLowerCase().includes(q)) return false
      return true
    })
  }, [appts, statusFilter, search, processingIds])

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

      {/* Processing + just-completed consults — pinned to the top so a recording
          stays visible from "analyzing" through "complete" without vanishing. */}
      {(processing.length > 0 || doneCards.length > 0) && (
        <section className="space-y-2">
          <style>{PROCESSING_CARD_CSS}</style>
          {processing.map((c) => (
            <ProcessingCard key={c.id} c={c} onOpen={() => navigate(`/consults/${c.id}/processing`)} />
          ))}
          {doneCards.map((c) => (
            <CompleteCard key={c.id} c={c} onOpen={() => navigate(`/consults/${c.id}`)} />
          ))}
        </section>
      )}

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
        <RecordedTable rows={rows} navigate={navigate} openRecorder={openRecorder} consultStatus={consultStatus} caughtUp />
      ) : (
        <RecordedTable rows={rows} navigate={navigate} openRecorder={openRecorder} consultStatus={consultStatus} />
      )}

      {unlinked.filter((c) => !doneCardIds.has(c.id) && !processingIds.has(c.id)).length > 0 && (
        <section className="space-y-1.5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Unlinked recordings</h2>
          <div className="divide-y divide-surface-700/60 rounded-lg border border-dashed border-surface-700 bg-surface-800/30">
            {unlinked.filter((c) => !doneCardIds.has(c.id) && !processingIds.has(c.id)).map((c) => (
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

// ── Processing consult card (transcribing/analyzing) ───────────────────────
const PROC_BADGES = ['🧠 Analyzing...', '📝 Transcribing...', '🔍 Detecting objections...', '⚡ Building sequence...']
const PROCESSING_CARD_CSS = `
.pc-leftbar { background: linear-gradient(180deg,#38bdf8,#0EA5E9,#38bdf8); background-size:100% 200%; animation: pcBar 2s ease-in-out infinite; }
@keyframes pcBar { 0%,100% { opacity:.5; background-position:0 0 } 50% { opacity:1; background-position:0 100% } }
.pc-badge { animation: pcFade .4s ease-out; }
@keyframes pcFade { from { opacity:0; transform: translateY(-2px) } to { opacity:1; transform:none } }
.pc-shimmer { background: linear-gradient(90deg, rgba(14,165,233,.12) 0%, rgba(56,189,248,.6) 50%, rgba(14,165,233,.12) 100%); background-size:200% 100%; animation: pcShimmer 1.5s linear infinite; }
@keyframes pcShimmer { from { background-position:200% 0 } to { background-position:-200% 0 } }
@media (prefers-reduced-motion: reduce) { .pc-leftbar,.pc-shimmer,.pc-badge { animation: none !important } }
`

function ProcessingCard({ c, onOpen }) {
  const [bi, setBi] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setBi((i) => (i + 1) % PROC_BADGES.length), 2500)
    return () => clearInterval(t)
  }, [])
  const name = c.patient_name || [c.patient_first, c.patient_last].filter(Boolean).join(' ') || 'New patient'
  return (
    <button
      onClick={onOpen}
      className="relative block w-full overflow-hidden rounded-lg border border-primary/30 bg-surface-800/60 px-4 py-3 text-left transition hover:bg-surface-800"
    >
      <span className="pc-leftbar absolute inset-y-0 left-0 w-[3px]" />
      <div className="flex items-start justify-between gap-3 pl-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-100">{name}</p>
          <p className="mt-0.5 text-xs text-slate-400">Consultation recorded — analysis in progress</p>
        </div>
        <span key={bi} className="pc-badge shrink-0 rounded-full border border-amber-400/30 bg-amber-400/15 px-2.5 py-1 text-[11px] font-medium text-amber-300">
          {PROC_BADGES[bi]}
        </span>
      </div>
      <span className="pc-shimmer mt-3 block h-[3px] w-full rounded-full" />
    </button>
  )
}

// A consult whose analysis just finished — keeps it visible (and clickable into
// the detail page) instead of disappearing the moment it leaves "processing".
function CompleteCard({ c, onOpen }) {
  const name = c.patient_name || [c.patient_first, c.patient_last].filter(Boolean).join(' ') || 'New patient'
  const failed = c.status === 'transcription_error'
  return (
    <button
      onClick={onOpen}
      className={`relative block w-full overflow-hidden rounded-lg border px-4 py-3 text-left transition ${
        failed
          ? 'border-rose-500/30 bg-rose-500/[0.06] hover:bg-rose-500/[0.10]'
          : 'border-emerald-500/30 bg-emerald-500/[0.06] hover:bg-emerald-500/[0.10]'
      }`}
    >
      <span className={`absolute inset-y-0 left-0 w-[3px] ${failed ? 'bg-rose-400' : 'bg-emerald-400'}`} />
      <div className="flex items-center justify-between gap-3 pl-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-100">{name}</p>
          <p className="mt-0.5 text-xs text-slate-400">
            {failed ? 'Transcription failed — tap to review' : 'Analysis complete — sequence ready to review'}
          </p>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
            failed
              ? 'border-rose-400/30 bg-rose-400/15 text-rose-300'
              : 'border-emerald-400/30 bg-emerald-400/15 text-emerald-300'
          }`}
        >
          {failed ? '⚠️ Error' : <><CheckCircle2 className="h-3 w-3" /> Complete</>}
        </span>
      </div>
    </button>
  )
}

function RecordedTable({ rows, navigate, openRecorder, caughtUp, consultStatus = {} }) {
  return (
    <div className="card overflow-hidden">
      {caughtUp && (
        <div className="flex items-center gap-2 border-b border-surface-700 bg-emerald-500/[0.06] px-4 py-2 text-xs font-medium text-emerald-300">
          <CheckCircle2 className="h-4 w-4" /> All caught up - every consult on this day has been recorded.
        </div>
      )}

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
          // For recorded rows, refine the badge by the consult's transcription
          // status: Processing (amber spinner) → Ready (green). Falls back to the
          // generic config until the status loads / for non-recorded rows.
          const cStatus = recorded ? consultStatus[a.consult_id] : undefined
          let bLabel = cfg.label, bText = cfg.text, bDot = cfg.dot, BIcon = cfg.Icon, bSpin = false, bFill = recorded
          if (recorded && cStatus !== undefined) {
            if (cStatus === 'analyzing' || cStatus === 'transcribed') {
              bLabel = 'Processing'; bText = 'text-amber-300'; bDot = 'text-amber-400'; BIcon = Loader2; bSpin = true; bFill = false
            } else if (cStatus === 'transcription_error') {
              bLabel = 'Needs attention'; bText = 'text-rose-300'; bDot = 'text-rose-400'; BIcon = Circle; bFill = false
            } else {
              bLabel = 'Ready'; bText = 'text-emerald-300'; bDot = 'text-emerald-400'; BIcon = Check; bFill = true
            }
          }
          const goDetail = () => navigate(`/consults/${a.consult_id}`)
          const onRow = recorded ? goDetail : () => openRecorder(a)
          return (
            <div
              key={a.id}
              onClick={onRow}
              className={`flex min-h-[60px] cursor-pointer items-center gap-3 px-4 transition ${ROW_TINT[s]}`}
            >
              <span className="hidden w-[70px] shrink-0 text-sm tabular-nums text-slate-400 sm:block">{fmtTime(a.appointment_time)}</span>

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
                <span className={`mt-1.5 inline-flex items-center gap-1 text-xs font-medium sm:hidden ${bText}`}>
                  <BIcon className={`h-3 w-3 ${bDot} ${bSpin ? 'animate-spin' : ''} ${bFill ? 'fill-current' : ''}`} />
                  {bLabel}
                </span>
              </div>

              <span className={`hidden w-[140px] shrink-0 items-center gap-1.5 text-sm font-medium sm:flex ${bText}`}>
                <BIcon className={`h-3.5 w-3.5 ${bDot} ${bSpin ? 'animate-spin' : ''} ${bFill ? 'fill-current' : ''}`} />
                {bLabel}
              </span>

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
