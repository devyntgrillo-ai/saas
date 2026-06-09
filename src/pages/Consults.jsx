import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Mic, Calendar, Search, CheckCircle2, Clock, Check, Circle, Loader2,
  Plug, ArrowRight, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { usePermissions } from '../lib/permissions'
import { displayPatientName } from '../lib/phi'
import { useRecorder } from '../context/RecorderContext'
import { useConsultsDay, useNextConsults, useProcessingConsults, useRecentConsults, useConsultArchive, ARCHIVE_PAGE_SIZE, useConsultsRealtime } from '../lib/queries'
import { statusMeta } from '../lib/consults'
import { useRecentRecordings } from '../lib/recentRecordings'
import { supabase } from '../lib/supabase'
import { formatAppointmentType } from '../lib/pms'

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
  const canPHI = usePermissions().canViewPHI
  const { openRecorder } = useRecorder()
  const navigate = useNavigate()
  const connected = Boolean(practice?.sikka_connected || practice?.pms_connected)

  const [view, setView] = useState('schedule') // 'schedule' (today) | 'recordings' (archive)
  const [date] = useState(todayStr()) // Schedule is always today-focused.
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')

  const { data: dayData, isLoading: loading } = useConsultsDay(practiceId, date)
  // Next 5 upcoming consults (tomorrow onward, any date) — always shown so there's
  // a forward view and the Schedule is never an empty page.
  const { data: nextConsults = [] } = useNextConsults(practiceId, 5)

  const appts = useMemo(() => dayData?.appts ?? [], [dayData])
  const allNote = dayData?.allNote ?? false

  // Start of "today" (local). Completed walk-in recordings only stay on the
  // Schedule while they belong to today; older ones live in the Recordings tab.
  const todayStartMs = useMemo(() => new Date(`${date}T00:00:00`).getTime(), [date])

  const { data: processing = [] } = useProcessingConsults(practiceId)
  // Recently-completed consults (analysis done / errored).
  const { data: recentDone = [] } = useRecentConsults(practiceId)
  useConsultsRealtime(practiceId)
  // Just-recorded consults (client-side) so the "analyzing" card shows instantly.
  const recentRecordings = useRecentRecordings(practiceId)

  // Consult ids tied to a today appointment — those render as rows in the
  // schedule table (Record → Processing → green Ready), never as cards.
  const apptConsultIds = useMemo(
    () => new Set(appts.filter((a) => a.consult_id).map((a) => a.consult_id)),
    [appts]
  )

  // Walk-in (no appointment) consults: analyzing → animated card, done → green
  // complete card. Appointment-linked ones are excluded — they live in the table.
  const procCards = useMemo(() => {
    const map = new Map()
    processing.forEach((c) => map.set(c.id, c))
    recentRecordings.forEach((r) => {
      if (!map.has(r.id)) map.set(r.id, { id: r.id, patient_name: r.name || undefined, status: 'analyzing' })
    })
    return [...map.values()].filter((c) => !apptConsultIds.has(c.id))
  }, [processing, recentRecordings, apptConsultIds])
  const procCardIds = useMemo(() => new Set(procCards.map((c) => c.id)), [procCards])

  // Today's completed walk-ins only — older completed consults live in Recordings.
  const doneCards = useMemo(
    () =>
      recentDone.filter(
        (c) =>
          !apptConsultIds.has(c.id) &&
          !procCardIds.has(c.id) &&
          new Date(c.created_at).getTime() >= todayStartMs
      ),
    [recentDone, apptConsultIds, procCardIds, todayStartMs]
  )

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
      if (statusFilter !== 'all' && statusOf(a) !== statusFilter) return false
      // Name search is gated to PHI roles — a viewer must not be able to probe
      // for a patient by typing their name.
      if (q && canPHI && !fullName(a).toLowerCase().includes(q)) return false
      return true
    })
  }, [appts, statusFilter, search, canPHI])

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
            {view === 'schedule' && counts.missed > 0 && (
              <span className="rounded-full bg-rose-500/15 px-2.5 py-0.5 text-xs font-semibold text-rose-300">
                {counts.missed} missed
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {view === 'schedule'
              ? `${niceDate} · ${counts.all} consult${counts.all === 1 ? '' : 's'} · ${counts.recorded} recorded · ${counts.needs} to record`
              : 'Every recorded consult — search and open any past recording.'}
          </p>
        </div>
      </div>

      {/* Schedule (today's appointments) vs Recordings (full searchable archive). */}
      <div className="flex gap-6 border-b border-surface-700">
        {[
          { key: 'schedule', label: 'Schedule' },
          { key: 'recordings', label: 'Recordings' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setView(t.key)}
            className={`-mb-px border-b-2 px-1 pb-2 text-sm font-medium transition ${
              view === t.key ? 'border-primary text-white' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {view === 'recordings' ? (
        <ConsultArchive practiceId={practiceId} navigate={navigate} />
      ) : (
      <>
      {/* ── Today ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-200">Today · {niceDate}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1">
            {STATUS_FILTERS.map((f) => (
              <button key={f.key} onClick={() => setStatusFilter(f.key)}
                className={`rounded-lg px-2.5 py-1 text-sm font-medium transition ${statusFilter === f.key ? 'bg-primary/10 text-primary-300' : 'text-slate-400 hover:text-slate-200'}`}>
                {f.label} <span className="text-xs text-slate-500">({f.n})</span>
              </button>
            ))}
          </div>
          <div className="relative min-w-[160px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search patient..." className="input h-9 py-1 pl-9 text-sm" />
          </div>
        </div>
      </div>

      {allNote && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Showing all appointments - no consult-type appointments found today.
        </p>
      )}

      {/* In-progress + just-completed walk-in recordings for today. Appointment
          recordings transition inline in the table below instead. */}
      {(procCards.length > 0 || doneCards.length > 0) && (
        <section className="space-y-2">
          <style>{PROCESSING_CARD_CSS}</style>
          {procCards.map((c) => (
            <ProcessingCard key={c.id} c={c} onOpen={() => navigate(`/consults/${c.id}/processing`)} />
          ))}
          {doneCards.map((c) => (
            <CompleteCard key={c.id} c={c} onOpen={() => navigate(`/consults/${c.id}`)} />
          ))}
        </section>
      )}

      {!connected ? (
        (procCards.length > 0 || doneCards.length > 0) ? null : (
          <EmptyCard icon={Plug} title="Connect your PMS to see your daily schedule here"
            sub="No PMS? You can still hit record for any walk-in consult."
            action={<Link to="/settings/pms" className="btn-primary mt-4">Connect your PMS</Link>} />
        )
      ) : loading ? (
        <div className="card flex justify-center py-16"><Clock className="h-6 w-6 animate-pulse text-slate-500" /></div>
      ) : appts.length === 0 ? (
        nextConsults.length > 0 ? (
          <p className="rounded-lg border border-surface-700 bg-surface-800/30 px-4 py-3 text-sm text-slate-400">
            No consults scheduled for today. Your next consults are below.
          </p>
        ) : (
          <EmptyCard icon={Calendar} title="No upcoming consults scheduled" sub="Hit record for a walk-in, or add appointments in your PMS." />
        )
      ) : rows.length === 0 ? (
        <EmptyCard icon={Calendar} title="No appointments match your filters" />
      ) : counts.recorded === counts.all ? (
        <RecordedTable rows={rows} navigate={navigate} openRecorder={openRecorder} consultStatus={consultStatus} practice={practice} caughtUp />
      ) : (
        <RecordedTable rows={rows} navigate={navigate} openRecorder={openRecorder} consultStatus={consultStatus} practice={practice} />
      )}

      {/* ── Next 5 upcoming consults ─ always shown so there's a forward view of
          what's coming, with date + time columns sorted earliest to latest. ── */}
      {nextConsults.length > 0 && (
        <NextConsults rows={nextConsults} navigate={navigate} openRecorder={openRecorder} practice={practice} />
      )}
      </>
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
  const canPHI = usePermissions().canViewPHI
  const [bi, setBi] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setBi((i) => (i + 1) % PROC_BADGES.length), 2500)
    return () => clearInterval(t)
  }, [])
  const name = displayPatientName(c, canPHI, 'New patient')
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
  const canPHI = usePermissions().canViewPHI
  const name = displayPatientName(c, canPHI, 'New patient')
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

// The persistent, searchable, paginated archive of every recorded consult.
function ConsultArchive({ practiceId, navigate }) {
  const canPHI = usePermissions().canViewPHI
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(0)

  // Debounce the search box (300ms) and reset to the first page on a new query.
  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search.trim()); setPage(0) }, 300)
    return () => clearTimeout(t)
  }, [search])

  const { data, isLoading, isFetching } = useConsultArchive(practiceId, debounced, page)
  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / ARCHIVE_PAGE_SIZE))
  const first = total === 0 ? 0 : page * ARCHIVE_PAGE_SIZE + 1
  const last = Math.min(total, (page + 1) * ARCHIVE_PAGE_SIZE)

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search past consults by patient name..."
          className="input pl-9"
        />
      </div>

      {isLoading ? (
        <div className="card flex justify-center py-16"><Clock className="h-6 w-6 animate-pulse text-slate-500" /></div>
      ) : rows.length === 0 ? (
        <EmptyCard
          icon={Mic}
          title={debounced ? 'No recordings match your search' : 'No recorded consults yet'}
          sub={debounced ? 'Try a different name.' : 'Recorded consults will appear here once analysis completes.'}
        />
      ) : (
        <>
          <div className="card divide-y divide-surface-700/60 overflow-hidden p-0">
            {rows.map((c) => {
              const meta = statusMeta(c.status)
              const name = displayPatientName(c, canPHI, 'Unknown patient')
              const d = c.recording_date || c.created_at
              return (
                <button
                  key={c.id}
                  onClick={() => navigate(`/consults/${c.id}`)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface-800"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-100">{name}</p>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      {c.treatment_type || 'Consult'}{d ? ` · ${new Date(d).toLocaleDateString()}` : ''}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${meta.classes}`}>{meta.label}</span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-slate-500" />
                </button>
              )
            })}
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Showing {first}–{last} of {total}{isFetching ? ' · updating…' : ''}</span>
            <div className="flex items-center gap-2">
              <button
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="inline-flex items-center gap-0.5 rounded-lg px-2 py-1 font-medium text-slate-300 transition hover:bg-surface-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" /> Prev
              </button>
              <span className="tabular-nums">Page {page + 1} of {pageCount}</span>
              <button
                disabled={page + 1 >= pageCount}
                onClick={() => setPage((p) => p + 1)}
                className="inline-flex items-center gap-0.5 rounded-lg px-2 py-1 font-medium text-slate-300 transition hover:bg-surface-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function RecordedTable({ rows, navigate, openRecorder, practice, caughtUp, consultStatus = {} }) {
  const canPHI = usePermissions().canViewPHI
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
          // While the consult is still transcribing/analyzing, open the progress
          // screen (it polls and redirects to the detail page once it's Ready).
          const isProcessing = recorded && (cStatus === 'analyzing' || cStatus === 'transcribed')
          const targetPath = isProcessing ? `/consults/${a.consult_id}/processing` : `/consults/${a.consult_id}`
          const goDetail = () => navigate(targetPath)
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
                    to={targetPath}
                    onClick={(e) => e.stopPropagation()}
                    className="block truncate text-sm font-medium text-slate-100 underline-offset-2 hover:text-white hover:underline"
                  >
                    {displayPatientName(a, canPHI)}
                  </Link>
                ) : (
                  <p className="truncate text-sm font-medium text-slate-100">{displayPatientName(a, canPHI)}</p>
                )}
                <p className="truncate text-xs text-slate-500">
                  {formatAppointmentType(a, practice)}{a.provider ? ` · ${a.provider}` : ''}
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

// Date label for the "Next consults" table (e.g. "Mon, Jun 9").
function fmtDate(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// The next few upcoming consults regardless of day, with Date + Time columns,
// earliest first. Used so the Schedule tab is never an empty page.
function NextConsults({ rows, navigate, openRecorder, practice }) {
  const canPHI = usePermissions().canViewPHI
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-slate-200">Next {rows.length} consult{rows.length === 1 ? '' : 's'}</h2>
      <div className="card overflow-hidden p-0">
        <div className="hidden items-center gap-3 border-b border-surface-700 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:flex">
          <span className="w-[120px] shrink-0">Date</span>
          <span className="w-[72px] shrink-0">Time</span>
          <span className="flex-1">Patient</span>
          <span className="w-[88px] shrink-0" />
        </div>
        <div className="divide-y divide-surface-700/60">
          {rows.map((a) => {
            const recorded = Boolean(a.consult_id)
            return (
              <div key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-[120px] shrink-0 text-sm font-medium text-slate-200">{fmtDate(a.appointment_time)}</span>
                <span className="w-[72px] shrink-0 text-sm tabular-nums text-slate-400">{fmtTime(a.appointment_time)}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-100">{displayPatientName(a, canPHI)}</p>
                  <p className="truncate text-xs text-slate-500">
                    {formatAppointmentType(a, practice)}{a.provider ? ` · ${a.provider}` : ''}
                  </p>
                </div>
                {recorded ? (
                  <button onClick={() => navigate(`/consults/${a.consult_id}`)} className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1.5 text-sm font-medium text-green-700 transition hover:bg-green-200">
                    <Check className="h-4 w-4" /> View
                  </button>
                ) : (
                  <button onClick={() => openRecorder(a)} className="inline-flex items-center gap-1.5 rounded-lg border border-surface-600 px-3 py-1.5 text-sm font-medium text-slate-200 transition hover:bg-surface-800">
                    <Mic className="h-3.5 w-3.5" /> Record
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
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
