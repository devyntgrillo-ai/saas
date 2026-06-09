import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, Plug } from 'lucide-react'
import { fetchTodaysAppointments, formatAppointmentType, setImplantConsult } from '../lib/pms'
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

// Best-effort: fire a browser push reminder 2 minutes before the appointment
// (while the tab is open). Real server push lands once Sikka + web-push are wired.
function scheduleReminder(appt) {
  if (typeof Notification === 'undefined') return
  const fireAt = new Date(appt.appointment_time).getTime() - 2 * 60 * 1000
  const delay = fireAt - Date.now()
  if (delay <= 0 || delay > 12 * 60 * 60 * 1000) return
  const name = [appt.patient_first, appt.patient_last].filter(Boolean).join(' ') || 'your patient'
  const notify = () =>
    new Notification('CaseLift', {
      body: `Consult with ${name} starts in 2 minutes - open CaseLift and hit record`,
    })
  const arm = () => setTimeout(notify, delay)
  if (Notification.permission === 'granted') arm()
  else if (Notification.permission !== 'denied') Notification.requestPermission().then((p) => p === 'granted' && arm())
}

export default function TodaysSchedule({ practice, practiceId }) {
  const connected = Boolean(practice?.pms_connected)
  const [appts, setAppts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!practiceId || !connected) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false)
      return
    }
    let active = true
    fetchTodaysAppointments(practiceId)
      .then((rows) => active && setAppts(rows))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [practiceId, connected])

  async function toggle(appt) {
    const next = !appt.is_implant_consult
    setAppts((prev) => prev.map((a) => (a.id === appt.id ? { ...a, is_implant_consult: next } : a)))
    try {
      await setImplantConsult(appt.id, next)
      if (next) scheduleReminder(appt)
    } catch {
      setAppts((prev) => prev.map((a) => (a.id === appt.id ? { ...a, is_implant_consult: !next } : a)))
    }
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between border-b border-surface-700 px-5 py-4">
        <h2 className="flex items-center gap-2 font-semibold text-white">
          <CalendarDays className="h-4 w-4 text-primary-400" /> Today's Schedule
        </h2>
        {connected && <span className="text-xs text-slate-500">{appts.length} appointments</span>}
      </div>

      {!connected ? (
        <div className="px-5 py-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-800 text-slate-500">
            <Plug className="h-6 w-6" />
          </div>
          <p className="mt-4 text-sm font-semibold text-slate-200">No appointments synced yet</p>
          <p className="mt-1 text-xs text-slate-500">Connect your PMS to see today's schedule and get recording reminders.</p>
          <Link to="/settings/pms" className="btn-primary mt-5">
            <Plug className="h-4 w-4" /> Connect PMS
          </Link>
        </div>
      ) : loading ? (
        <div className="px-5 py-10 text-center text-sm text-slate-500">Loading schedule…</div>
      ) : appts.length === 0 ? (
        <div className="px-5 py-12 text-center text-sm text-slate-500">No appointments scheduled today.</div>
      ) : (
        <ul className="divide-y divide-white/[0.07]">
          {appts.map((a) => (
            <li key={a.id} className="group flex items-center gap-3 px-5 py-3.5">
              {/* Filled dot = consult, hollow = other */}
              <span
                title={a.is_implant_consult ? apptTreatmentLabel(a) : 'Other appointment'}
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${a.is_implant_consult ? 'bg-primary' : 'border border-slate-600'}`}
              />
              <div className="w-14 shrink-0 text-xs text-slate-400">{fmtTime(a.appointment_time)}</div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-200">
                  {[a.patient_first, a.patient_last].filter(Boolean).join(' ') || 'Patient'}
                </p>
                <p className="truncate text-xs text-slate-500">{formatAppointmentType(a, practice) || '-'}{a.provider ? ` · ${a.provider}` : ''}</p>
              </div>
              <button
                onClick={() => toggle(a)}
                title="Toggle consult"
                className={`shrink-0 text-xs font-medium transition ${
                  a.is_implant_consult
                    ? 'text-slate-500 opacity-0 group-hover:opacity-100'
                    : 'text-slate-500 opacity-0 hover:text-slate-300 group-hover:opacity-100'
                }`}
              >
                {a.is_implant_consult ? 'Unmark' : 'Mark as consult'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
