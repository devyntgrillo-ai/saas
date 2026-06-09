import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, ArrowRight, Mic, CheckCircle2 } from 'lucide-react'
import { useTodaysAppointments } from '../lib/queries'
import { usePermissions } from '../lib/permissions'
import { displayPatientName } from '../lib/phi'
import { treatmentLabel, normalizeTreatment } from '../lib/treatments'

// Resolve a friendly treatment label for an appointment row, falling back to a
// generic "Consult" when the treatment type can't be confidently determined.
function apptTreatmentLabel(a) {
  const tt = a.treatment_type || normalizeTreatment(a.appointment_type)
  return tt ? treatmentLabel(tt) : 'Consult'
}

function fmtTime(ts) {
  if (!ts) return '-'
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

// Compact snapshot of today's consult appointments and whether each has
// been recorded yet. Fuller controls live on the Schedule / Consults views.
export default function TodaysAppointmentsSnapshot({ practiceId }) {
  const { data: rows = [], isLoading: loading } = useTodaysAppointments(practiceId)
  const canPHI = usePermissions().canViewPHI
  const appts = useMemo(() => rows.filter((a) => a.is_implant_consult), [rows])

  return (
    <div className="card">
      <div className="flex items-center justify-between border-b border-surface-700 px-5 py-4">
        <h2 className="flex items-center gap-2 font-semibold text-white">
          <CalendarDays className="h-4 w-4 text-primary-400" /> Today's consults
        </h2>
        <Link to="/consults" className="inline-flex items-center gap-1 text-sm font-medium text-primary-400 hover:text-primary-300">
          View all <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      {loading ? (
        <div className="px-5 py-10 text-center text-sm text-slate-500">Loading…</div>
      ) : appts.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-slate-500">No consults scheduled today.</div>
      ) : (
        <ul className="divide-y divide-white/[0.07]">
          {appts.map((a) => {
            const recorded = Boolean(a.consult_id)
            return (
              <li key={a.id} className="flex items-center gap-3 px-5 py-3.5">
                <div className="w-14 shrink-0 text-xs text-slate-400">{fmtTime(a.appointment_time)}</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-200">
                    {displayPatientName(a, canPHI, 'Patient')}
                  </p>
                  <p className="truncate text-xs text-slate-500">{apptTreatmentLabel(a)}{a.provider ? ` · ${a.provider}` : ''}</p>
                </div>
                {recorded ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Recorded
                  </span>
                ) : (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300">
                    <Mic className="h-3.5 w-3.5" /> Not recorded
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
