import { useEffect, useMemo, useRef, useState } from 'react'
import { Megaphone, X, Check, Loader2, ChevronRight, ChevronLeft, Pause, Play, Search, Rocket, MessageSquare, Mail } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { treatmentLabel } from '../lib/treatments'
import { REACTIVATION_TOKENS, replaceTokens, formatTxDate } from '../lib/reactivationTokens'
import {
  useReactivationCampaigns,
  useReactivationAudience,
  useToggleReactivationCampaign,
  useLaunchReactivationCampaign,
  isMutating,
} from '../lib/queries'

// Treatment options for the Step 1 multi-select (spec list). No boxes checked =
// all treatment plans (no filter).
const REACTIVATION_TREATMENTS = [
  { value: 'full_arch', label: 'Full Arch / All-on-4' },
  { value: 'dental_implants', label: 'Dental Implants (single)' },
  { value: 'implant_bridge', label: 'Implant Bridge' },
  { value: 'invisalign', label: 'Invisalign / Clear Aligners' },
  { value: 'cosmetic_veneers', label: 'Cosmetic / Veneers' },
  { value: 'dentures', label: 'Dentures / Snap-in' },
  { value: 'other', label: 'Other' },
]

const SMS_MAX = 320

// Three pre-built sequence angles. Each is a starting point, every message is
// fully editable after the angle is chosen.
const ANGLES = [
  {
    key: 'gentle',
    name: 'The Gentle Check-In',
    desc: 'Low pressure, relationship-first. Best for patients who went cold without a clear reason.',
    badge: 'Recommended for most patients',
    msg1: "Hi {{first_name}}, it's [TC Name] from {{practice_name}}. I was reviewing some charts and thought of you, we talked about {{treatment_type}} back in {{tx_plan_date}}. Still something you're thinking about?",
    msg2: "{{first_name}}, just wanted to make sure my last text didn't get lost. No rush at all, just want to make sure you have everything you need if and when you're ready. Anything I can answer for you?",
    msg3Subject: 'Checking in, {{first_name}}',
    msg3Body: `Hi {{first_name}},

I wanted to reach out one more time about the {{treatment_type}} plan we put together for you. I know life gets busy and these decisions take time, completely understand.

I just want you to know that your file is still here, {{doctor_name}} remembers your case, and we're happy to pick up right where we left off whenever you're ready.

No pressure, but if you have any questions or just want to talk through your options, I'm easy to reach.

Would love to hear from you.

[TC Name]
{{practice_name}}, {{phone_number}}`,
  },
  {
    key: 'price_lock',
    name: 'The Price Lock',
    desc: 'Creates soft urgency around pricing or availability. Best for patients whose main objection was cost or timing.',
    badge: 'Best for cost objections',
    msg1: "Hi {{first_name}}, [TC Name] at {{practice_name}}. Quick heads up, we've had some patients ask about pricing recently and wanted to make sure you still had access to the same treatment plan we built for you in {{tx_plan_date}}. Worth a quick chat?",
    msg2: "{{first_name}}, just following up on my last message. The plan we discussed for {{treatment_type}} is still on file. Happy to walk through the financing options again if that would help, a lot of patients are surprised by how manageable the monthly payment is. Want me to send the breakdown?",
    msg3Subject: 'Your {{treatment_type}} plan, still on file, {{first_name}}',
    msg3Body: `Hi {{first_name}},

I wanted to reach out before too much more time passes. The {{treatment_type}} treatment plan {{doctor_name}} put together for you is still on file, and I want to make sure you have the full picture before making any decisions.

A lot of patients are surprised to learn that treatment like this can often be broken down into payments that are less than a car payment. We work with several financing partners and can usually find something that fits.

If cost was part of what gave you pause, I'd love to spend 10 minutes walking you through the options, no commitment, just information.

Would that be worth a quick call?

[TC Name]
{{practice_name}}, {{phone_number}}`,
  },
  {
    key: 'clinical',
    name: 'The Clinical Update',
    desc: "Positions the follow-up as new information or a changed situation. Best for patients who wanted to 'wait and see'.",
    badge: 'Best for hesitant patients',
    msg1: "Hi {{first_name}}, this is [TC Name] from {{practice_name}}. We chatted about {{treatment_type}} back in {{tx_plan_date}}, I wanted to reach out because we've had a few things change that might be relevant to your situation. Worth a quick conversation?",
    msg2: "{{first_name}}, following up from my last message. I know timing wasn't quite right before, just wanted to check in and see if anything has changed on your end. {{doctor_name}} would love to reconnect when the time is right.",
    msg3Subject: 'A few things worth knowing, {{first_name}}',
    msg3Body: `Hi {{first_name}},

When we last spoke about {{treatment_type}}, I know there were some things you wanted to think through. That's completely fair, and I respect that.

I wanted to share a couple of things that might be helpful as you consider your options:

The longer a tooth or bone issue goes unaddressed, the more complex the treatment can become, and in some cases, more costly. This isn't meant to create pressure, just something worth knowing as you weigh the timing.

{{doctor_name}} has helped a lot of patients in similar situations find a path that worked for their timeline and budget. If you're open to it, even a 15-minute phone call might help clarify things.

Is there a good time this week to connect?

[TC Name]
{{practice_name}}, {{phone_number}}`,
  },
]
const ANGLE_BY_KEY = Object.fromEntries(ANGLES.map((a) => [a.key, a]))

const STATUS_PILL = {
  draft: 'bg-slate-500/15 text-slate-400', scheduled: 'bg-sky-500/15 text-sky-300',
  active: 'bg-emerald-500/15 text-emerald-300', paused: 'bg-amber-500/15 text-amber-300', completed: 'bg-slate-500/15 text-slate-400',
}

const todayCA = () => new Date().toLocaleDateString('en-CA')
const daysAgoCA = (n) => new Date(Date.now() - n * 86400000).toLocaleDateString('en-CA')
const inDaysLabel = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const monthYearLabel = () => new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

export function ReactivationLaunchButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-primary/40 px-3.5 py-2 text-sm font-medium text-primary-400 transition hover:bg-primary/10"
    >
      <Rocket className="h-4 w-4" /> Reactivation Campaign
    </button>
  )
}

export default function ReactivationCampaigns({ building = false, onCloseBuilder, showList = true }) {
  const { practiceId } = useAuth()
  const { data: campaigns = [], refetch: refetchCampaigns } = useReactivationCampaigns(practiceId)
  const toggleMutation = useToggleReactivationCampaign()

  function toggle(c) {
    toggleMutation.mutate({ campaignId: c.id, practiceId, status: c.status })
  }

  return (
    <>
      {showList && campaigns.length > 0 && (
        <div className="card divide-y divide-surface-700 px-5">
          {campaigns.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-3 py-3">
              <Megaphone className="h-4 w-4 shrink-0 text-primary-400" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-100">{c.campaign_name || 'Reactivation campaign'}</p>
                <p className="text-xs text-slate-500">{c.total_recipients} patients · {c.messages_sent || 0} sent · {c.replies_count || 0} replies</p>
              </div>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_PILL[c.status] || STATUS_PILL.draft}`}>{c.status}</span>
              {['active', 'paused', 'scheduled'].includes(c.status) && (
                <button onClick={() => toggle(c)} disabled={isMutating(toggleMutation, (v) => v.campaignId === c.id)} className="rounded-md p-1.5 text-slate-400 transition hover:bg-surface-700 hover:text-slate-100 disabled:opacity-50">
                  {isMutating(toggleMutation, (v) => v.campaignId === c.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : c.status === 'paused' ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {building && <CampaignBuilder practiceId={practiceId} onClose={onCloseBuilder} onLaunched={() => { onCloseBuilder?.(); refetchCampaigns() }} />}
    </>
  )
}

// Insert a token at the textarea's cursor and update the controlled value.
function insertAtCursor(ref, value, setValue) {
  const el = ref.current
  if (!el) { setValue((v) => (v || '') + value); return }
  const start = el.selectionStart ?? el.value.length
  const end = el.selectionEnd ?? el.value.length
  setValue((v) => `${(v || '').slice(0, start)}${value}${(v || '').slice(end)}`)
  requestAnimationFrame(() => { el.focus(); const pos = start + value.length; el.setSelectionRange(pos, pos) })
}

function TokenBar({ targetRef, setValue }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {REACTIVATION_TOKENS.map((t) => (
        <button
          key={t.token}
          type="button"
          onClick={() => insertAtCursor(targetRef, t.token, setValue)}
          className="rounded-md border border-surface-600 bg-surface-800 px-2 py-1 text-[11px] font-medium text-slate-300 transition hover:border-primary/50 hover:text-primary-300"
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

function MessageEditor({ channel, day, subject, setSubject, body, setBody, onReset }) {
  const ref = useRef(null)
  const isSms = channel === 'sms'
  const count = isSms ? (body || '').length : (body || '').trim().split(/\s+/).filter(Boolean).length
  return (
    <div className="rounded-xl border border-surface-700 bg-surface-800/40 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ${isSms ? 'bg-sky-500/15 text-sky-300' : 'bg-violet-500/15 text-violet-300'}`}>
          {isSms ? <MessageSquare className="h-3 w-3" /> : <Mail className="h-3 w-3" />} {isSms ? 'SMS' : 'Email'}
        </span>
        <span className="rounded-md bg-surface-700 px-2 py-0.5 text-[11px] font-semibold text-slate-300">Day {day}</span>
        {onReset && (
          <button type="button" onClick={onReset} className="ml-auto text-[11px] font-medium text-slate-400 transition hover:text-primary-300">Reset to default</button>
        )}
      </div>
      {!isSms && (
        <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject line" className="input mb-2 text-sm" />
      )}
      <div className="mb-2"><TokenBar targetRef={ref} setValue={setBody} /></div>
      <textarea
        ref={ref}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={isSms ? 4 : 12}
        className="input text-sm leading-relaxed"
      />
      <p className={`mt-1 text-right text-[11px] ${isSms && count > SMS_MAX ? 'text-rose-400' : 'text-slate-500'}`}>
        {isSms ? `${count}/${SMS_MAX} characters` : `${count} words`}
      </p>
    </div>
  )
}

function CampaignBuilder({ practiceId, onClose, onLaunched }) {
  const { practice } = useAuth()
  const launchMutation = useLaunchReactivationCampaign()
  const [step, setStep] = useState(1)
  const [txStart, setTxStart] = useState(daysAgoCA(365))
  const [txEnd, setTxEnd] = useState(daysAgoCA(14))
  const [treatmentTypes, setTreatmentTypes] = useState(() => new Set())
  const [selected, setSelected] = useState(() => new Set())
  const [search, setSearch] = useState('')
  const [angleKey, setAngleKey] = useState('gentle')
  const [msg1, setMsg1] = useState(ANGLE_BY_KEY.gentle.msg1)
  const [msg2, setMsg2] = useState(ANGLE_BY_KEY.gentle.msg2)
  const [msg3Subject, setMsg3Subject] = useState(ANGLE_BY_KEY.gentle.msg3Subject)
  const [msg3Body, setMsg3Body] = useState(ANGLE_BY_KEY.gentle.msg3Body)
  const [pendingAngle, setPendingAngle] = useState(null)
  const [swapping, setSwapping] = useState(false)
  const filters = useMemo(
    () => ({ startDate: txStart, endDate: txEnd, treatmentTypes: [...treatmentTypes] }),
    [txStart, txEnd, treatmentTypes],
  )
  const { data: matches = [], isLoading: loading } = useReactivationAudience(practiceId, filters)
  const eligible = useMemo(() => matches.filter((m) => !m.inActive), [matches])

  // Default to all eligible (not already in a sequence) selected.
  useEffect(() => {
    if (loading) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(new Set(eligible.map((r) => r.id)))
  }, [eligible, loading])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return matches.filter((m) => !q || (m.patient_name || '').toLowerCase().includes(q))
  }, [matches, search])

  function toggleTreatment(v) {
    setTreatmentTypes((prev) => { const n = new Set(prev); n.has(v) ? n.delete(v) : n.add(v); return n })
  }
  function toggleSel(id) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  const allVisibleSelected = visible.length > 0 && visible.every((m) => m.inActive || selected.has(m.id))
  function toggleAll() {
    setSelected((prev) => {
      const n = new Set(prev)
      if (allVisibleSelected) visible.forEach((m) => n.delete(m.id))
      else visible.forEach((m) => { if (!m.inActive) n.add(m.id) })
      return n
    })
  }

  const completion = inDaysLabel(10)

  // ── Sequence angle: swap templates, with per-message + overall dirty tracking ──
  const angle = ANGLE_BY_KEY[angleKey]
  const m1Dirty = msg1 !== angle.msg1
  const m2Dirty = msg2 !== angle.msg2
  const m3Dirty = msg3Subject !== angle.msg3Subject || msg3Body !== angle.msg3Body
  const dirty = m1Dirty || m2Dirty || m3Dirty
  function applyAngle(key) {
    const a = ANGLE_BY_KEY[key]
    setSwapping(true)
    setAngleKey(key)
    setMsg1(a.msg1); setMsg2(a.msg2); setMsg3Subject(a.msg3Subject); setMsg3Body(a.msg3Body)
    requestAnimationFrame(() => requestAnimationFrame(() => setSwapping(false)))
  }
  function chooseAngle(key) {
    if (key === angleKey) return
    if (dirty) { setPendingAngle(key); return } // confirm before discarding edits
    applyAngle(key)
  }
  function resetMsg(which) {
    if (which === 1) setMsg1(angle.msg1)
    else if (which === 2) setMsg2(angle.msg2)
    else { setMsg3Subject(angle.msg3Subject); setMsg3Body(angle.msg3Body) }
  }

  // Auto campaign name from the dominant selected treatment.
  const autoName = useMemo(() => {
    const counts = {}
    matches.filter((m) => selected.has(m.id)).forEach((m) => { const t = m.treatment_type || 'other'; counts[t] = (counts[t] || 0) + 1 })
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
    const label = top ? treatmentLabel(top[0]) : 'Treatment Plan'
    return `${label} Reactivation, ${monthYearLabel()}`
  }, [matches, selected])

  // Live preview filled with the first selected patient (or a sample).
  const previewPatient = useMemo(() => matches.find((m) => selected.has(m.id)) || matches[0] || {}, [matches, selected])

  function launch(asDraft) {
    if (launchMutation.isPending) return
    const nowIso = new Date().toISOString()
    const enrollments = matches.filter((m) => selected.has(m.id)).map((m) => {
      const parts = (m.patient_name || '').trim().split(/\s+/)
      return {
        practice_id: practiceId,
        consult_id: m.id,
        patient_first: m.patient_first || parts[0] || 'Patient',
        patient_last: m.patient_last || parts.slice(1).join(' ') || '',
        patient_phone: m.patient_phone,
        patient_email: m.patient_email,
        treatment_type: m.treatment_type,
        tx_plan_date: (m.created_at || '').slice(0, 10) || null,
      }
    })
    launchMutation.mutate(
      {
        practiceId,
        campaign: {
          practice_id: practiceId,
          campaign_name: autoName,
          angle_type: angleKey,
          message_1_sms: msg1,
          message_2_sms: msg2,
          message_3_email_subject: msg3Subject,
          message_3_email_body: msg3Body,
          tx_date_start: txStart,
          tx_date_end: txEnd,
          treatment_types: [...treatmentTypes],
          total_recipients: selected.size,
          messages_per_day: 50,
          status: asDraft ? 'draft' : 'active',
          scheduled_start: nowIso,
          started_at: asDraft ? null : nowIso,
          launched_at: asDraft ? null : nowIso,
        },
        enrollments,
      },
      { onSuccess: () => onLaunched() },
    )
  }

  const busy = launchMutation.isPending

  const steps = ['Filter', 'Preview', 'Messages', 'Launch']

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-surface-700 bg-surface-900 shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-surface-700 px-5 py-3.5">
          <div className="flex items-center gap-2">
            {steps.map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${step === i + 1 ? 'bg-primary !text-white' : step > i + 1 ? 'bg-emerald-600 !text-white' : 'bg-surface-700 text-slate-400'}`}>
                  {step > i + 1 ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className={`hidden text-xs sm:block ${step === i + 1 ? 'text-slate-200' : 'text-slate-500'}`}>{s}</span>
                {i < steps.length - 1 && <span className="hidden h-px w-4 bg-surface-700 sm:block" />}
              </div>
            ))}
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-surface-800 hover:text-white"><X className="h-5 w-5" /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {/* STEP 1, FILTER */}
          {step === 1 && (
            <div className="space-y-5">
              <h3 className="text-base font-semibold text-white">Find unscheduled treatment plans</h3>
              <div>
                <p className="mb-1.5 text-sm font-medium text-slate-300">When was the TX plan presented?</p>
                <div className="flex flex-wrap items-center gap-2">
                  <input type="date" value={txStart} max={txEnd} onChange={(e) => setTxStart(e.target.value)} className="input w-auto" />
                  <span className="text-slate-500">→</span>
                  <input type="date" value={txEnd} min={txStart} max={todayCA()} onChange={(e) => setTxEnd(e.target.value)} className="input w-auto" />
                </div>
                <p className="mt-1.5 text-xs text-slate-500">This pulls unscheduled treatment plans from your PMS within this date range.</p>
              </div>
              <div>
                <p className="mb-1.5 text-sm font-medium text-slate-300">Treatment type</p>
                <div className="flex flex-wrap gap-2">
                  {REACTIVATION_TREATMENTS.map((t) => {
                    const on = treatmentTypes.has(t.value)
                    return (
                      <button key={t.value} type="button" onClick={() => toggleTreatment(t.value)}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${on ? 'border-primary bg-primary/10 text-primary-300' : 'border-surface-700 text-slate-300 hover:bg-surface-800'}`}>
                        <span className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${on ? 'border-primary bg-primary' : 'border-surface-500'}`}>{on && <Check className="h-2.5 w-2.5 text-white" />}</span>
                        {t.label}
                      </button>
                    )
                  })}
                </div>
                <p className="mt-1.5 text-xs text-slate-500">Leave all unchecked to include every treatment type.</p>
              </div>
              <div className="rounded-lg border border-surface-700 bg-surface-800/50 px-4 py-3">
                <p className="text-sm font-semibold text-slate-100">
                  {loading ? 'Counting…' : `${eligible.length} patient${eligible.length === 1 ? '' : 's'} match these filters`}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">Excludes anyone already in an active CaseLift sequence.</p>
              </div>
            </div>
          )}

          {/* STEP 2, PREVIEW */}
          {step === 2 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-base font-semibold text-white">Preview patients</h3>
                <span className="rounded-full bg-surface-800 px-2.5 py-0.5 text-xs font-medium text-slate-300">{selected.size} of {eligible.length} selected</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search patients…" className="input pl-9" />
                </div>
                <button onClick={toggleAll} className="btn-ghost shrink-0 text-sm">{allVisibleSelected ? 'Deselect all' : 'Select all'}</button>
              </div>
              <div className="max-h-[48vh] overflow-auto rounded-lg border border-surface-700">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface-800 text-left text-xs text-slate-400">
                    <tr>
                      <th className="w-8 px-3 py-2"></th>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Treatment</th>
                      <th className="px-3 py-2">TX Plan Date</th>
                      <th className="px-3 py-2">Phone</th>
                      <th className="px-3 py-2">Email</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-700">
                    {visible.map((m) => (
                      <tr key={m.id} className={m.inActive ? 'opacity-50' : 'hover:bg-surface-800/50'}>
                        <td className="px-3 py-2"><input type="checkbox" disabled={m.inActive} checked={selected.has(m.id)} onChange={() => toggleSel(m.id)} className="h-4 w-4 rounded border-surface-600" /></td>
                        <td className="px-3 py-2 font-medium text-slate-200">{m.patient_name || 'Unknown'}{m.inActive && <span className="ml-1.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">in sequence</span>}</td>
                        <td className="px-3 py-2 text-slate-400">{treatmentLabel(m.treatment_type)}</td>
                        <td className="px-3 py-2 text-slate-400">{formatTxDate(m.created_at)}</td>
                        <td className="px-3 py-2 text-slate-400">{m.patient_phone || ', '}</td>
                        <td className="px-3 py-2 text-slate-400">{m.patient_email || ', '}</td>
                      </tr>
                    ))}
                    {visible.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">No patients match.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* STEP 3, CHOOSE YOUR SEQUENCE ANGLE */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-semibold text-white">Choose your sequence angle</h3>
                <p className="mt-0.5 text-xs text-slate-500">Pick a starting point, then edit any message. Tokens auto-fill with each patient's real data when sent.</p>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {ANGLES.map((a) => {
                  const on = a.key === angleKey
                  return (
                    <button key={a.key} type="button" onClick={() => chooseAngle(a.key)}
                      className={`relative rounded-xl border p-3 text-left transition ${on ? 'border-primary bg-primary/10 ring-1 ring-primary/30' : 'border-surface-700 hover:bg-surface-800/60'}`}>
                      {on && <Check className="absolute right-2 top-2 h-4 w-4 text-primary-300" />}
                      <p className="pr-5 text-sm font-semibold text-white">{a.name}</p>
                      <p className="mt-1 text-xs text-slate-400">{a.desc}</p>
                      <span className="mt-2 inline-block rounded-full bg-surface-800 px-2 py-0.5 text-[10px] font-medium text-primary-300">{a.badge}</span>
                    </button>
                  )
                })}
              </div>
              <div key={angleKey} className={`space-y-4 transition-opacity duration-200 ${swapping ? 'opacity-0' : 'opacity-100'}`}>
                <MessageEditor channel="sms" day={1} body={msg1} setBody={setMsg1} onReset={m1Dirty ? () => resetMsg(1) : null} />
                <MessageEditor channel="sms" day={4} body={msg2} setBody={setMsg2} onReset={m2Dirty ? () => resetMsg(2) : null} />
                <MessageEditor channel="email" day={10} subject={msg3Subject} setSubject={setMsg3Subject} body={msg3Body} setBody={setMsg3Body} onReset={m3Dirty ? () => resetMsg(3) : null} />
              </div>
              <details className="rounded-lg border border-surface-700 bg-surface-800/40 p-3">
                <summary className="cursor-pointer text-xs font-medium text-slate-400">Preview with {previewPatient.patient_name || 'a sample patient'}</summary>
                <div className="mt-2 space-y-2 text-xs text-slate-300">
                  <p className="whitespace-pre-wrap rounded bg-surface-900 p-2">{replaceTokens(msg1, { patient: previewPatient, practice })}</p>
                  <p className="whitespace-pre-wrap rounded bg-surface-900 p-2">{replaceTokens(msg2, { patient: previewPatient, practice })}</p>
                  <p className="rounded bg-surface-900 p-2"><b>{replaceTokens(msg3Subject, { patient: previewPatient, practice })}</b>{'\n'}<span className="whitespace-pre-wrap">{replaceTokens(msg3Body, { patient: previewPatient, practice })}</span></p>
                </div>
              </details>
            </div>
          )}

          {/* STEP 4, CONFIRM & LAUNCH */}
          {step === 4 && (
            <div className="space-y-4">
              <h3 className="text-base font-semibold text-white">Confirm &amp; launch</h3>
              <dl className="space-y-2 rounded-lg border border-surface-700 p-4 text-sm">
                {[
                  ['Campaign', autoName],
                  ['Patients selected', String(selected.size)],
                  ['Messages per patient', '3 (SMS · SMS · Email)'],
                  ['Total messages to send', String(selected.size * 3)],
                  ['Send schedule', 'Day 1, Day 4, Day 10'],
                  ['Estimated completion', completion],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3"><dt className="text-slate-500">{k}</dt><dd className="text-right font-medium text-slate-200">{v}</dd></div>
                ))}
              </dl>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-surface-700 px-5 py-3.5">
          <button onClick={() => (step === 1 ? onClose() : setStep((s) => s - 1))} className="btn-ghost text-sm">
            {step === 1 ? 'Cancel' : <><ChevronLeft className="h-4 w-4" /> Back</>}
          </button>
          {step < 4 ? (
            <button onClick={() => setStep((s) => s + 1)} disabled={(step === 2 && selected.size === 0) || (step === 1 && loading)} className="btn-primary text-sm">Next <ChevronRight className="h-4 w-4" /></button>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => launch(true)} disabled={busy} className="btn-secondary text-sm">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save as Draft</button>
              <button onClick={() => launch(false)} disabled={busy || selected.size === 0} className="btn-primary text-sm">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />} Launch Reactivation Blast</button>
            </div>
          )}
        </div>
      </div>

      {/* Switching angles discards message edits, confirm first. */}
      {pendingAngle && (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setPendingAngle(null)} />
          <div className="relative z-10 w-full max-w-sm rounded-xl border border-surface-700 bg-surface-900 p-5 shadow-2xl">
            <p className="text-sm font-semibold text-white">Switch angle?</p>
            <p className="mt-1.5 text-sm text-slate-400">Switching to “{ANGLE_BY_KEY[pendingAngle]?.name}” will reset your message edits. Continue?</p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setPendingAngle(null)} className="btn-ghost text-sm">Keep my edits</button>
              <button onClick={() => { applyAngle(pendingAngle); setPendingAngle(null) }} className="btn-primary text-sm">Switch angle</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
