import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Check, Loader2, Info, Sparkles, ArrowRight,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import {
  DEFAULT_TOUCHPOINTS, DEFAULT_RULES, parseSequenceConfig, serializeSequenceConfig,
} from '../lib/sequence'

function Toggle({ checked, onChange, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${checked ? 'bg-primary' : 'bg-surface-700'} ${disabled ? 'opacity-50' : ''}`}>
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  )
}

function RuleRow({ label, description, children }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-200">{label}</p>
        {description && <p className="text-xs text-slate-500">{description}</p>}
      </div>
      {children}
    </div>
  )
}

export default function SequenceSettings() {
  const { practice, refreshProfile } = useAuth()
  const navigate = useNavigate()
  // Touchpoint timing now lives in the per-patient sequence editor (the drawer on
  // the Sequences page). We still load + preserve the saved touchpoints here so
  // saving delivery/sequence rules doesn't wipe them.
  const [touchpoints, setTouchpoints] = useState(() => DEFAULT_TOUCHPOINTS.map((t) => ({ ...t })))
  const [rules, setRules] = useState({ ...DEFAULT_RULES })
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState('')
  const { data: activeCount = 0 } = useSequenceActiveCount(practice?.id)
  const updatePractice = useUpdatePractice()

  useEffect(() => {
    if (!practice) return
    const cfg = parseSequenceConfig(practice.sequence_config)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTouchpoints(cfg.touchpoints)
    setRules(cfg.rules)
  }, [practice])

  const setRule = (k, v) => setRules((r) => ({ ...r, [k]: v }))

  async function save() {
    if (!practice?.id) return
    setSaving(true)
    try {
      await updatePractice.mutateAsync({
        practiceId: practice.id,
        patch: { sequence_config: serializeSequenceConfig(touchpoints, rules) },
      })
      setFlash('Settings saved')
      setTimeout(() => setFlash(''), 2500)
      await refreshProfile()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-white">Follow-up Sequence</h2>
        <p className="mt-1 text-sm text-slate-400">
          Control when AI-generated messages go out. Content is personalized per patient - you control the timing.
        </p>
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-slate-200">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary-300" />
          <span>Messages are written by AI based on each patient's specific consult. You can preview what was generated for any patient in their consult record.</span>
        </div>
      </div>

      {/* SECTION 2 - Delivery Rules */}
      <section className="card p-5">
        <h3 className="text-sm font-semibold text-white">Delivery rules</h3>
        <div className="mt-2 divide-y divide-surface-700">
          <RuleRow label="Quiet hours" description="Don't send outside these hours (practice timezone).">
            <Toggle checked={rules.quietHours} onChange={(v) => setRule('quietHours', v)} />
          </RuleRow>
          {rules.quietHours && (
            <div className="grid grid-cols-1 gap-3 py-3 sm:grid-cols-2">
              <label className="text-sm text-slate-400">Don't send before
                <input type="time" value={rules.quietStart} onChange={(e) => setRule('quietStart', e.target.value)} className="input mt-1" />
              </label>
              <label className="text-sm text-slate-400">Don't send after
                <input type="time" value={rules.quietEnd} onChange={(e) => setRule('quietEnd', e.target.value)} className="input mt-1" />
              </label>
              <p className="sm:col-span-2 flex items-center gap-2 text-xs text-slate-500">
                Timezone: <span className="text-slate-300">{practice?.timezone || 'practice default'}</span>
                <Link to="/settings" className="text-primary-400 hover:text-primary-300">change in Practice Profile</Link>
              </p>
              <p className="sm:col-span-2 text-xs text-slate-500">Messages scheduled outside quiet hours will send at the next available time.</p>
            </div>
          )}
          <RuleRow label="Weekend delivery" description="If off, weekend messages shift to Monday.">
            <Toggle checked={rules.weekendDelivery} onChange={(v) => setRule('weekendDelivery', v)} />
          </RuleRow>
          <div className="py-3">
            <RuleRow label="Activation hold period"
              description="After a consult is recorded, sequences wait this long before the first message - giving your TC time to mark the outcome if the patient accepted treatment.">
              <div className="flex items-center gap-1.5">
                <input type="number" min={1} max={72} value={rules.holdHours}
                  onChange={(e) => setRule('holdHours', Math.min(72, Math.max(1, Number(e.target.value) || 1)))}
                  className="w-16 rounded-lg border border-surface-700 bg-surface-800 px-2 py-1 text-sm text-slate-100 focus:border-primary focus:outline-none" />
                <span className="text-xs text-slate-500">hours</span>
              </div>
            </RuleRow>
          </div>
        </div>
      </section>

      {/* SECTION 3 - Sequence Rules */}
      <section className="card p-5">
        <h3 className="text-sm font-semibold text-white">Stop sequence when patient…</h3>
        <div className="mt-3 space-y-2.5">
          {[
            ['stopOnReply', 'Replies to any message'],
            ['stopOnBooking', 'Books an appointment (detected via PMS sync)'],
            ['stopOnNotConverting', 'Is marked “Not converting” in CaseLift'],
          ].map(([k, label]) => (
            <label key={k} className="flex items-center gap-3 text-sm text-slate-200">
              <input type="checkbox" checked={Boolean(rules[k])} onChange={(e) => setRule(k, e.target.checked)}
                className="h-4 w-4 rounded border-surface-600 bg-surface-800 text-primary focus:ring-primary/40" />
              {label}
            </label>
          ))}
          <label className="flex items-center gap-3 text-sm text-slate-500">
            <input type="checkbox" checked disabled className="h-4 w-4 rounded border-surface-600 bg-surface-800 text-primary opacity-60" />
            Opts out (STOP reply) - always on
          </label>
        </div>
        <div className="mt-4 border-t border-surface-700 pt-3">
          <RuleRow label="Re-engagement"
            description="If a patient who stopped books but doesn't show, restart from Day 30.">
            <Toggle checked={rules.reengagement} onChange={(v) => setRule('reengagement', v)} />
          </RuleRow>
        </div>
      </section>

      {/* SECTION 4 - Preview */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-surface-700 bg-surface-800/40 px-4 py-3">
        <p className="flex items-center gap-2 text-sm text-slate-300">
          <Info className="h-4 w-4 text-slate-500" />
          Want to see what a patient's actual messages look like? Open any consult record and view their personalized sequence.
        </p>
        <button onClick={() => navigate('/consults')} className="inline-flex items-center gap-1 text-sm font-medium text-primary-300 hover:text-primary-200">
          View a consult <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Save */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          {activeCount} active sequence{activeCount === 1 ? '' : 's'} in progress - changes won't affect patients already in a sequence.
        </p>
        <div className="flex items-center gap-3">
          {flash && <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-300"><Check className="h-3.5 w-3.5" /> {flash}</span>}
          <button onClick={save} disabled={saving} className="btn-primary">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save settings
          </button>
        </div>
      </div>
      <p className="text-center text-xs text-slate-600">Changes apply to new consults only.</p>
    </div>
  )
}
