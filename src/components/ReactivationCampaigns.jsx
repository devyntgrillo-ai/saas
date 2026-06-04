import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Megaphone, X, Check, Loader2, ChevronRight, ChevronLeft, Pause, Play, Search, Rocket } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { formatMoney } from '../lib/analytics'
import { TREATMENT_TYPES, treatmentLabel } from '../lib/treatments'
import { buildCampaignAngles } from '../lib/reactivation'
import { useReactivationCampaigns, useReactivationAudience, queryKeys } from '../lib/queries'

const DATE_RANGES = [
  { key: '2w-1m', label: '2 weeks - 1 month', minDays: 14, maxDays: 30 },
  { key: '1-3m', label: '1 - 3 months', minDays: 30, maxDays: 90 },
  { key: '3-6m', label: '3 - 6 months', minDays: 90, maxDays: 180 },
  { key: '6-12m', label: '6 - 12 months', minDays: 180, maxDays: 365 },
  { key: '12-24m', label: '12 - 24 months', minDays: 365, maxDays: 730 },
]
const OBJECTIONS = ['all', 'price', 'fear', 'spouse', 'timing']

// "All" + each treatment type, for the STEP 1 treatment filter.
const TREATMENT_FILTERS = [{ value: 'all', label: 'All treatments' }, ...TREATMENT_TYPES]

const PER_DAY = [10, 20, 30, 50]

const STATUS_PILL = {
  draft: 'bg-slate-500/15 text-slate-400', scheduled: 'bg-sky-500/15 text-sky-300',
  active: 'bg-emerald-500/15 text-emerald-300', paused: 'bg-amber-500/15 text-amber-300', completed: 'bg-slate-500/15 text-slate-400',
}

function tomorrow() { const d = new Date(); d.setDate(d.getDate() + 1); return d.toLocaleDateString('en-CA') }

// Compact, outlined launcher for the page header - replaces the old full-width
// banner card. Pair with <ReactivationCampaigns> below for the campaign list.
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

// Renders the existing-campaign list (compact, no banner) plus the builder
// modal. `building`/`onCloseBuilder` are lifted to the page so the launch
// button can live in the header. Reloads the list after a launch.
export default function ReactivationCampaigns({ building = false, onCloseBuilder, showList = true }) {
  const { practiceId } = useAuth()
  const queryClient = useQueryClient()
  const { data: campaigns = [], refetch: refetchCampaigns } = useReactivationCampaigns(practiceId)

  async function toggle(c) {
    const next = c.status === 'paused' ? 'active' : 'paused'
    await supabase.from('reactivation_campaigns').update({ status: next }).eq('id', c.id)
    refetchCampaigns()
    queryClient.invalidateQueries({ queryKey: queryKeys.reactivation(practiceId) })
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
                <p className="text-xs text-slate-500 capitalize">{(c.angle_type || '').replace('_', ' ')} · {c.total_recipients} recipients</p>
              </div>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_PILL[c.status] || STATUS_PILL.draft}`}>{c.status}</span>
              {['active', 'paused', 'scheduled'].includes(c.status) && (
                <button onClick={() => toggle(c)} className="rounded-md p-1.5 text-slate-400 transition hover:bg-surface-700 hover:text-slate-100">
                  {c.status === 'paused' ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
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

function CampaignBuilder({ practiceId, onClose, onLaunched }) {
  const [step, setStep] = useState(1)
  const [range, setRange] = useState('6-12m')
  const [objection, setObjection] = useState('all')
  const [treatment, setTreatment] = useState('all')
  const [selected, setSelected] = useState(() => new Set())
  const [search, setSearch] = useState('')
  const [angle, setAngle] = useState('price_lock')
  const [perDay, setPerDay] = useState(20)
  const [days, setDays] = useState('mon-fri')
  const [start, setStart] = useState(tomorrow())
  const [busy, setBusy] = useState(false)

  const rangeMeta = DATE_RANGES.find((r) => r.key === range) || DATE_RANGES[3]
  const audienceFilters = useMemo(
    () => ({ minDays: rangeMeta.minDays, maxDays: rangeMeta.maxDays, objection, treatment }),
    [rangeMeta.minDays, rangeMeta.maxDays, objection, treatment],
  )
  const { data: matches = [], isLoading: loading } = useReactivationAudience(practiceId, audienceFilters)

  useEffect(() => {
    if (loading) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(new Set(matches.filter((r) => !r.inActive).map((r) => r.id)))
  }, [matches, loading, audienceFilters])

  const eligible = matches.filter((m) => !m.inActive)
  const visibleMatches = useMemo(() => {
    const q = search.trim().toLowerCase()
    return matches.filter((m) => !q || (m.patient_name || '').toLowerCase().includes(q))
  }, [matches, search])

  // Treatment-aware angle templates. When a specific treatment is filtered we
  // use its language; "all" yields generic high-value-treatment copy.
  const ANGLES = useMemo(() => buildCampaignAngles(treatment), [treatment])
  const angleMeta = ANGLES.find((a) => a.key === angle) || ANGLES[0]

  // Eligible-count breakdown by treatment type (cheap, in-memory) for the summary.
  const eligibleByType = useMemo(() => {
    const counts = {}
    eligible.forEach((m) => { const t = m.treatment_type || 'other'; counts[t] = (counts[t] || 0) + 1 })
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
  }, [eligible])

  const estDays = Math.max(1, Math.ceil(selected.size / perDay))

  function toggleSel(id) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  async function launch(startNow) {
    setBusy(true)
    const { data: campaign } = await supabase.from('reactivation_campaigns').insert({
      practice_id: practiceId,
      campaign_name: `${angleMeta.name} · ${treatment === 'all' ? rangeMeta.label : `${treatmentLabel(treatment)} · ${rangeMeta.label}`}`,
      angle_type: angle,
      message_1_sms: angleMeta.sms1, message_1_email_subject: angleMeta.email_subject, message_1_email_body: angleMeta.email_body, message_2_sms: angleMeta.sms2,
      filter_date_min: new Date(Date.now() - rangeMeta.maxDays * 86400000).toISOString(),
      filter_date_max: new Date(Date.now() - rangeMeta.minDays * 86400000).toISOString(),
      total_recipients: selected.size, messages_per_day: perDay,
      status: startNow ? 'active' : 'scheduled',
      scheduled_start: startNow ? new Date().toISOString() : new Date(`${start}T09:00:00`).toISOString(),
      started_at: startNow ? new Date().toISOString() : null,
    }).select('id').single()
    if (campaign) {
      const enrollments = matches.filter((m) => selected.has(m.id)).map((m) => {
        const [first, ...rest] = (m.patient_name || 'Patient').split(' ')
        return { campaign_id: campaign.id, practice_id: practiceId, consult_id: m.id, patient_first: first, patient_last: rest.join(' '), patient_phone: m.patient_phone, patient_email: m.patient_email }
      })
      // Insert in chunks to stay well under payload limits.
      for (let i = 0; i < enrollments.length; i += 200) await supabase.from('reactivation_enrollments').insert(enrollments.slice(i, i + 200))
    }
    setBusy(false); onLaunched()
  }

  const steps = ['Filter', 'Review', 'Angle', 'Schedule', 'Launch']

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-surface-700 bg-surface-900 shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-surface-700 px-5 py-3.5">
          <div className="flex items-center gap-2">
            {steps.map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${step === i + 1 ? 'bg-primary !text-white' : step > i + 1 ? 'bg-emerald-600 !text-white' : 'bg-surface-700 text-slate-400'}`}>
                  {step > i + 1 ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                {i < steps.length - 1 && <span className="hidden h-px w-4 bg-surface-700 sm:block" />}
              </div>
            ))}
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-surface-800 hover:text-white"><X className="h-5 w-5" /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {step === 1 && (
            <div className="space-y-4">
              <h3 className="text-base font-semibold text-white">Who do we reach?</h3>
              <div>
                <p className="mb-1.5 text-sm text-slate-400">Last contacted</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {DATE_RANGES.map((r) => (
                    <button key={r.key} onClick={() => setRange(r.key)} className={`rounded-lg border px-3 py-2 text-sm transition ${range === r.key ? 'border-primary bg-primary/10 text-primary-300' : 'border-surface-700 text-slate-300 hover:bg-surface-800'}`}>{r.label}</button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-slate-500">Minimum 2 weeks ago is enforced.</p>
              </div>
              <div>
                <p className="mb-1.5 text-sm text-slate-400">Treatment type</p>
                <select
                  value={treatment}
                  onChange={(e) => setTreatment(e.target.value)}
                  className="input"
                >
                  {TREATMENT_FILTERS.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <p className="mb-1.5 text-sm text-slate-400">Objection</p>
                <div className="flex flex-wrap gap-2">
                  {OBJECTIONS.map((o) => (
                    <button key={o} onClick={() => setObjection(o)} className={`rounded-full border px-3 py-1 text-sm capitalize transition ${objection === o ? 'border-primary bg-primary/10 text-primary-300' : 'border-surface-700 text-slate-300 hover:bg-surface-800'}`}>{o}</button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-slate-200">{loading ? 'Counting…' : `${eligible.length} patient${eligible.length === 1 ? '' : 's'} match`}</p>
                {!loading && treatment === 'all' && eligibleByType.length > 1 && (
                  <p className="mt-1 text-xs text-slate-500">
                    {eligibleByType.slice(0, 4).map(([t, n]) => `${n} ${treatmentLabel(t)}`).join(', ')}
                    {eligibleByType.length > 4 ? '…' : ''}
                  </p>
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-white">Review list</h3>
                <span className="text-sm text-slate-400">{selected.size} of {matches.length} selected</span>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search patients…" className="input pl-9" />
              </div>
              <div className="max-h-72 divide-y divide-surface-700 overflow-y-auto rounded-lg border border-surface-700">
                {visibleMatches.map((m) => (
                  <label key={m.id} className={`flex items-center gap-3 px-3 py-2.5 text-sm ${m.inActive ? 'opacity-50' : 'cursor-pointer hover:bg-surface-800/60'}`}>
                    <input type="checkbox" disabled={m.inActive} checked={selected.has(m.id)} onChange={() => toggleSel(m.id)} className="h-4 w-4 rounded border-surface-600" />
                    <span className="min-w-0 flex-1 truncate text-slate-200">{m.patient_name || 'Unknown'}</span>
                    <span className="shrink-0 text-xs capitalize text-slate-500">{m.objection_type || '-'}</span>
                    {m.case_value > 0 && <span className="shrink-0 text-xs text-slate-400">{formatMoney(m.case_value)}</span>}
                    {m.inActive && <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300">In sequence</span>}
                  </label>
                ))}
                {visibleMatches.length === 0 && <p className="px-3 py-6 text-center text-sm text-slate-500">No patients match.</p>}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <h3 className="text-base font-semibold text-white">Choose your angle</h3>
              {ANGLES.map((a) => (
                <button key={a.key} onClick={() => setAngle(a.key)} className={`block w-full rounded-lg border p-4 text-left transition ${angle === a.key ? 'border-primary bg-primary/10' : 'border-surface-700 hover:bg-surface-800/60'}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">{a.name}</span>
                    {a.recommended && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">Recommended</span>}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-400">{a.desc}</p>
                  <p className="mt-2 rounded bg-surface-800/60 p-2 text-xs italic text-slate-400">“{a.sms1}”</p>
                </button>
              ))}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <h3 className="text-base font-semibold text-white">Schedule the drip</h3>
              <div>
                <p className="mb-1.5 text-sm text-slate-400">Messages per day</p>
                <div className="flex gap-2">
                  {PER_DAY.map((n) => <button key={n} onClick={() => setPerDay(n)} className={`rounded-lg border px-4 py-2 text-sm transition ${perDay === n ? 'border-primary bg-primary/10 text-primary-300' : 'border-surface-700 text-slate-300 hover:bg-surface-800'}`}>{n}</button>)}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm text-slate-400">Days
                  <select value={days} onChange={(e) => setDays(e.target.value)} className="input mt-1"><option value="mon-fri">Mon-Fri</option><option value="mon-sat">Mon-Sat</option></select>
                </label>
                <label className="text-sm text-slate-400">Start date
                  <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="input mt-1" />
                </label>
              </div>
              <p className="rounded-lg bg-surface-800/60 p-3 text-sm text-slate-300">Sends business hours (9am-5pm). Estimated completion: <span className="font-semibold text-white">~{estDays} day{estDays === 1 ? '' : 's'}</span> for {selected.size} patients.</p>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-3">
              <h3 className="text-base font-semibold text-white">Review and launch</h3>
              <dl className="space-y-2 rounded-lg border border-surface-700 p-4 text-sm">
                {[['Recipients', `${selected.size} patients`], ['Treatment', treatment === 'all' ? 'All treatments' : treatmentLabel(treatment)], ['Angle', angleMeta.name], ['Filter', `${rangeMeta.label}${objection !== 'all' ? ` · ${objection}` : ''}`], ['Pace', `${perDay}/day · ${days === 'mon-fri' ? 'Mon-Fri' : 'Mon-Sat'}`], ['Start', start], ['Est. completion', `~${estDays} days`]].map(([k, v]) => (
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
          {step < 5 ? (
            <button onClick={() => setStep((s) => s + 1)} disabled={step === 2 && selected.size === 0} className="btn-primary text-sm">Next <ChevronRight className="h-4 w-4" /></button>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => launch(false)} disabled={busy} className="btn-secondary text-sm">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Schedule</button>
              <button onClick={() => launch(true)} disabled={busy} className="btn-primary bg-primary text-sm hover:bg-primary-700">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Start now</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
