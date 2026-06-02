import { useEffect, useMemo, useState } from 'react'
import { Search, X, Calendar, AlertTriangle, User, Mic, Loader2, ArrowLeft } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { fetchTodaysAppointments } from '../lib/pms'
import { DEFAULT_TREATMENT, normalizeTreatment, treatmentLabel } from '../lib/treatments'

const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((e || '').trim())
const digits = (p) => (p || '').replace(/\D/g, '')
const isUSPhone = (p) => {
  const d = digits(p)
  return d.length === 10 || (d.length === 11 && d[0] === '1')
}
const fullName = (a) => [a?.patient_first, a?.patient_last].filter(Boolean).join(' ') || 'Unknown patient'
const fmtTime = (ts) =>
  ts ? new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) : ''

// Assign a recording to a patient BEFORE recording starts. Either link to a
// today's PMS appointment or enter a new (non-PMS) patient. On confirm, calls
// onConfirm(patient) where patient = { firstName, lastName, phone, email,
// appointmentId, pmsApptId }.
export default function AssignmentModal({ presetAppointment = null, onCancel, onConfirm }) {
  const { practiceId, practice, profile, user } = useAuth()
  const [mode, setMode] = useState(presetAppointment ? 'confirm' : 'choose')
  const [tab, setTab] = useState('appointment') // appointment | new
  const [appts, setAppts] = useState(null)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(presetAppointment || null)
  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '', email: '' })
  const [contact, setContact] = useState({
    phone: presetAppointment?.patient_phone || '',
    email: presetAppointment?.patient_email || '',
  })

  // Treatment type + Tx plan value are pulled straight from the PMS appointment
  // with NO pre-recording friction. The TC reviews/edits both on the consult
  // AFTER recording (see ConsultDetail). Recording stays one click.
  const apptTreatment = (a) =>
    normalizeTreatment(a?.treatment_type || a?.appointment_type) || DEFAULT_TREATMENT

  // A single practice doctor is used as the presenting-doctor fallback.
  const soloDoctor = useMemo(() => {
    if (Array.isArray(practice?.doctors) && practice.doctors.length === 1) return String(practice.doctors[0] || '').trim()
    return [practice?.doctor_first, practice?.doctor_last].filter(Boolean).join(' ').trim()
  }, [practice])

  useEffect(() => {
    if (presetAppointment || !practiceId) return
    let on = true
    fetchTodaysAppointments(practiceId).then((rows) => {
      if (on) setAppts((rows || []).filter((a) => !a.consult_id))
    })
    return () => { on = false }
  }, [practiceId, presetAppointment])

  const filteredAppts = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (appts || []).filter((a) => !q || fullName(a).toLowerCase().includes(q))
  }, [appts, search])

  const source = selected ? 'appointment' : 'new'

  // Resolve the patient object for the current selection. Treatment type + Tx
  // value come from the PMS appointment automatically (no inputs). When the PMS
  // has no plan value, leave it blank so the AI estimate / post-record TC edit
  // fills it - we never force a guess at record time.
  const pmsTx = Number(selected?.tx_plan_value)
  const hasPmsTx = Number.isFinite(pmsTx) && pmsTx > 0
  const treatmentType = selected ? apptTreatment(selected) : DEFAULT_TREATMENT
  const treatmentExtras = {
    treatmentType,
    txPlanValue: hasPmsTx ? pmsTx : '',
    txPlanValueSource: hasPmsTx ? 'pms' : 'estimate',
    presentingDoctor: (selected?.provider || soloDoctor || '').trim(),
    tcName: (profile?.full_name || profile?.name || user?.email || '').trim(),
  }

  const patient = selected
    ? {
        firstName: selected.patient_first || '',
        lastName: selected.patient_last || '',
        phone: contact.phone,
        email: contact.email,
        appointmentId: selected.id,
        pmsApptId: selected.pms_appointment_id,
        ...treatmentExtras,
      }
    : {
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone,
        email: form.email,
        appointmentId: null,
        pmsApptId: null,
        ...treatmentExtras,
      }

  const phoneOk = isUSPhone(patient.phone)
  const emailOk = isEmail(patient.email)
  const complete = phoneOk && emailOk
  const apptMissingContact = source === 'appointment' && (!selected.patient_phone || !selected.patient_email)

  function pick(a) {
    setSelected(a)
    setContact({ phone: a.patient_phone || '', email: a.patient_email || '' })
    setMode('confirm')
  }

  return (
    <div className="fixed inset-0 z-[72] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-surface-700 bg-surface-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-surface-700 px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            {mode === 'confirm' && !presetAppointment && (
              <button onClick={() => { setSelected(null); setMode('choose') }} className="rounded-md p-0.5 text-slate-400 hover:text-white">
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <Mic className="h-4 w-4 text-rose-400" /> Who are you recording?
          </h2>
          <button onClick={onCancel} className="rounded-md p-1.5 text-slate-400 hover:bg-surface-800 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-5">
          {mode === 'choose' && (
            <>
              {/* Tabs */}
              <div className="mb-4 inline-flex rounded-lg border border-surface-700 bg-surface-800 p-0.5">
                {[['appointment', "Today's appointment"], ['new', 'New patient']].map(([k, label]) => (
                  <button key={k} onClick={() => setTab(k)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${tab === k ? 'bg-primary/15 text-primary-300' : 'text-slate-400 hover:text-slate-200'}`}>
                    {label}
                  </button>
                ))}
              </div>

              {tab === 'appointment' ? (
                <div>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search today's patients..." className="input pl-9" />
                  </div>
                  <div className="mt-3 max-h-72 space-y-1 overflow-y-auto pr-1">
                    {appts === null ? (
                      <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-500" /></div>
                    ) : filteredAppts.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-surface-700 px-4 py-8 text-center">
                        <Calendar className="mx-auto h-7 w-7 text-slate-600" />
                        <p className="mt-2 text-sm text-slate-400">No appointments remaining today</p>
                        <p className="mt-1 text-xs text-slate-500">Use “New patient” to record without a PMS link.</p>
                      </div>
                    ) : filteredAppts.map((a) => (
                      <button key={a.id} onClick={() => pick(a)}
                        className="flex w-full items-center gap-3 rounded-lg border border-surface-700 bg-surface-800/50 px-3 py-2.5 text-left transition hover:border-surface-600">
                        <span className="w-16 shrink-0 text-xs text-slate-400">{fmtTime(a.appointment_time)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-100">{fullName(a)}</span>
                          <span className="block truncate text-xs text-slate-500">{a.appointment_type || '-'}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <NewPatientForm form={form} setForm={setForm} onContinue={() => setMode('confirm')} phoneOk={isUSPhone(form.phone)} emailOk={isEmail(form.email)} />
              )}
            </>
          )}

          {mode === 'confirm' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-surface-700 bg-surface-800/50 p-4">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Recording consult for</p>
                <p className="mt-0.5 flex items-center gap-2 text-base font-semibold text-white">
                  <User className="h-4 w-4 text-slate-400" />
                  {[patient.firstName, patient.lastName].filter(Boolean).join(' ') || 'New patient'}
                </p>
                {selected?.appointment_type && <p className="mt-0.5 text-xs text-slate-500">{selected.appointment_type} · {fmtTime(selected.appointment_time)}</p>}
                <p className="mt-2 text-xs text-slate-500">
                  Treatment: <span className="text-slate-300">{treatmentLabel(treatmentType)}</span>
                  {hasPmsTx && <span className="text-slate-400"> · ${pmsTx.toLocaleString()}</span>}
                  <span className="text-slate-600"> · editable after recording</span>
                </p>
              </div>

              {/* Contact: read-only confirmation when present; required inputs when missing. */}
              {source === 'appointment' && !apptMissingContact ? (
                <dl className="space-y-1.5 text-sm">
                  <Row label="Phone" value={patient.phone} />
                  <Row label="Email" value={patient.email} />
                </dl>
              ) : (
                <div className="space-y-2">
                  {apptMissingContact && (
                    <p className="flex items-center gap-1.5 text-xs text-amber-300">
                      <AlertTriangle className="h-3.5 w-3.5" /> Not in PMS - please enter
                    </p>
                  )}
                  <Field label="Phone" value={selected ? contact.phone : form.phone} ok={phoneOk}
                    onChange={(v) => selected ? setContact((c) => ({ ...c, phone: v })) : setForm((f) => ({ ...f, phone: v }))}
                    placeholder="(509) 555-0182" />
                  <Field label="Email" value={selected ? contact.email : form.email} ok={emailOk}
                    onChange={(v) => selected ? setContact((c) => ({ ...c, email: v })) : setForm((f) => ({ ...f, email: v }))}
                    placeholder="patient@email.com" />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Confirmation bar */}
        {mode === 'confirm' && (
          <div className="flex items-center justify-between gap-3 border-t border-surface-700 px-5 py-3.5">
            <button onClick={onCancel} className="text-sm font-medium text-slate-500 transition hover:text-slate-300">Cancel</button>
            <button
              onClick={() => onConfirm(patient)}
              disabled={!complete}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold !text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Mic className="h-4 w-4" /> Start Recording
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function NewPatientForm({ form, setForm, onContinue, phoneOk, emailOk }) {
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const canContinue = phoneOk && emailOk
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label">First name</label><input className="input" value={form.firstName} onChange={set('firstName')} /></div>
        <div><label className="label">Last name</label><input className="input" value={form.lastName} onChange={set('lastName')} /></div>
      </div>
      <div>
        <label className="label">Phone <span className="text-rose-400">*</span></label>
        <input className="input" value={form.phone} onChange={set('phone')} placeholder="(509) 555-0182" />
        {form.phone && !phoneOk && <p className="mt-1 text-xs text-rose-300">Enter a valid US phone number.</p>}
      </div>
      <div>
        <label className="label">Email <span className="text-rose-400">*</span></label>
        <input className="input" value={form.email} onChange={set('email')} placeholder="patient@email.com" />
        {form.email && !emailOk && <p className="mt-1 text-xs text-rose-300">Enter a valid email address.</p>}
      </div>
      <button onClick={onContinue} disabled={!canContinue} className="btn-primary w-full">Continue</button>
    </div>
  )
}

function Field({ label, value, onChange, ok, placeholder }) {
  return (
    <div>
      <label className="label">{label} <span className="text-rose-400">*</span></label>
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      {value && !ok && <p className="mt-1 text-xs text-rose-300">Invalid {label.toLowerCase()}.</p>}
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="truncate text-slate-200">{value || '-'}</dd>
    </div>
  )
}
