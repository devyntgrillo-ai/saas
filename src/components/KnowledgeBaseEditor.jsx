import { useEffect, useRef, useState } from 'react'
import {
  Sparkles,
  Plus,
  Trash2,
  Check,
  Loader2,
  BookOpen,
  ThumbsUp,
  ThumbsDown,
  MessageSquareQuote,
  ClipboardList,
  DollarSign,
  CalendarClock,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { parseKB, serializeKB, newStoryId, EMPTY_KB } from '../lib/knowledgeBase'
import { formatDateTime } from '../lib/consults'

function SectionCard({ icon: Icon, title, subtitle, children }) {
  return (
    <section className="card p-5">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary-400" />
        <h2 className="text-sm font-semibold text-white">{title}</h2>
      </div>
      {subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function AutoTextarea({ value, onChange, placeholder, rows = 4 }) {
  return (
    <textarea
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full resize-y rounded-lg border border-surface-700 bg-surface-800 px-3.5 py-2.5 text-sm leading-relaxed text-slate-100 placeholder-slate-500 transition focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-500/30"
    />
  )
}

function EditableList({ items, onChange, placeholder, addLabel }) {
  const update = (i, v) => onChange(items.map((it, idx) => (idx === i ? v : it)))
  const remove = (i) => onChange(items.filter((_, idx) => idx !== i))
  const add = () => onChange([...items, ''])
  return (
    <div className="space-y-2">
      {items.length === 0 && <p className="text-xs text-slate-500">No items yet.</p>}
      {items.map((it, i) => (
        <div key={i} className="flex items-start gap-2">
          <textarea
            value={it}
            onChange={(e) => update(i, e.target.value)}
            placeholder={placeholder}
            rows={2}
            className="flex-1 resize-y rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-500/30"
          />
          <button
            onClick={() => remove(i)}
            className="mt-1 rounded-md p-2 text-slate-500 transition hover:bg-surface-800 hover:text-rose-400"
            title="Remove"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      <button onClick={add} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-400 hover:text-primary-300">
        <Plus className="h-4 w-4" /> {addLabel}
      </button>
    </div>
  )
}

export default function KnowledgeBaseEditor({ practiceId }) {
  const [kb, setKb] = useState(EMPTY_KB)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [saveState, setSaveState] = useState('idle') // idle | saving | saved
  const lastSavedRef = useRef('')
  const timerRef = useRef(null)

  // Load whenever the target practice changes.
  useEffect(() => {
    let active = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    supabase
      .from('practices')
      .select('knowledge_base, knowledge_base_updated_at')
      .eq('id', practiceId)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return
        const parsed = parseKB(data?.knowledge_base)
        setKb(parsed)
        lastSavedRef.current = serializeKB(parsed)
        setLastUpdated(data?.knowledge_base_updated_at || parsed.updatedAt || null)
        setSaveState('idle')
        setLoading(false)
      })
    return () => {
      active = false
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [practiceId])

  // Debounced auto-save on any change.
  useEffect(() => {
    if (loading) return
    const serialized = serializeKB(kb)
    if (serialized === lastSavedRef.current) return

    setSaveState('saving')
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      const nowIso = new Date().toISOString()
      const payload = { ...kb, updatedAt: nowIso }
      const { error } = await supabase
        .from('practices')
        .update({
          knowledge_base: JSON.stringify(payload),
          knowledge_base_updated_at: nowIso,
        })
        .eq('id', practiceId)
      if (!error) {
        lastSavedRef.current = serialized
        setLastUpdated(nowIso)
        setSaveState('saved')
      } else {
        setSaveState('idle')
      }
    }, 900)
    return () => timerRef.current && clearTimeout(timerRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kb])

  const set = (key, value) => setKb((prev) => ({ ...prev, [key]: value }))

  // Patient stories CRUD
  const addStory = () =>
    setKb((p) => ({ ...p, patientStories: [...p.patientStories, { id: newStoryId(), title: '', story: '' }] }))
  const updateStory = (id, field, value) =>
    setKb((p) => ({
      ...p,
      patientStories: p.patientStories.map((s) => (s.id === id ? { ...s, [field]: value } : s)),
    }))
  const deleteStory = (id) =>
    setKb((p) => ({ ...p, patientStories: p.patientStories.filter((s) => s.id !== id) }))

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-surface-700 border-t-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Status row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary-300 ring-1 ring-inset ring-primary/20">
          <Sparkles className="h-3.5 w-3.5" /> AI is using this context
        </span>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          {saveState === 'saving' && (
            <span className="inline-flex items-center gap-1.5 text-amber-300">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
            </span>
          )}
          {saveState === 'saved' && (
            <span className="inline-flex items-center gap-1.5 text-emerald-300">
              <Check className="h-3.5 w-3.5" /> Saved
            </span>
          )}
          <span>Last updated {lastUpdated ? formatDateTime(lastUpdated) : '-'}</span>
        </div>
      </div>

      <SectionCard icon={BookOpen} title="Practice Overview" subtitle="Doctor, location, pricing, financing options.">
        <AutoTextarea value={kb.overview} onChange={(v) => set('overview', v)}
          placeholder="Dr. … , located in … . Full arch runs … . Financing via …" rows={5} />
      </SectionCard>

      <SectionCard icon={ThumbsUp} title="Common Objections & What Works" subtitle="Tactics proven to move cases forward.">
        <EditableList items={kb.objectionsThatWork} onChange={(v) => set('objectionsThatWork', v)}
          placeholder="e.g. Price: present the monthly number before the total." addLabel="Add objection tactic" />
      </SectionCard>

      <SectionCard icon={ThumbsDown} title="What Does NOT Work" subtitle="Approaches to avoid.">
        <EditableList items={kb.whatDoesNotWork} onChange={(v) => set('whatDoesNotWork', v)}
          placeholder="e.g. Quoting the full arch total cold before financing framing." addLabel="Add pitfall" />
      </SectionCard>

      <SectionCard icon={MessageSquareQuote} title="Patient Stories That Convert" subtitle="Real stories the TC can reference.">
        <div className="space-y-3">
          {kb.patientStories.length === 0 && <p className="text-xs text-slate-500">No stories yet.</p>}
          {kb.patientStories.map((s) => (
            <div key={s.id} className="rounded-lg border border-surface-700 bg-surface-800/50 p-3">
              <div className="flex items-center gap-2">
                <input
                  value={s.title}
                  onChange={(e) => updateStory(s.id, 'title', e.target.value)}
                  placeholder="Story title"
                  className="flex-1 rounded-md border border-surface-700 bg-surface-800 px-3 py-1.5 text-sm font-medium text-slate-100 placeholder-slate-500 focus:border-primary focus:outline-none"
                />
                <button onClick={() => deleteStory(s.id)} className="rounded-md p-2 text-slate-500 hover:bg-surface-800 hover:text-rose-400" title="Delete story">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <textarea
                value={s.story}
                onChange={(e) => updateStory(s.id, 'story', e.target.value)}
                placeholder="What happened and why it converted…"
                rows={3}
                className="mt-2 w-full resize-y rounded-md border border-surface-700 bg-surface-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-500/30"
              />
            </div>
          ))}
          <button onClick={addStory} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-400 hover:text-primary-300">
            <Plus className="h-4 w-4" /> Add story
          </button>
        </div>
      </SectionCard>

      <SectionCard icon={ClipboardList} title="TC Coaching Notes" subtitle="Running notes from Laura.">
        <AutoTextarea value={kb.coachingNotes} onChange={(v) => set('coachingNotes', v)}
          placeholder="Ongoing coaching reminders for the treatment coordinators…" rows={5} />
      </SectionCard>

      <SectionCard icon={DollarSign} title="Pricing Reference Points">
        <AutoTextarea value={kb.pricingReference} onChange={(v) => set('pricingReference', v)}
          placeholder="Single implant: $… / Full arch: $… / Financing terms…" rows={4} />
      </SectionCard>

      <SectionCard icon={CalendarClock} title="Scheduling & Availability Notes">
        <AutoTextarea value={kb.schedulingNotes} onChange={(v) => set('schedulingNotes', v)}
          placeholder="Surgery days, consult availability, healing buffers…" rows={4} />
      </SectionCard>
    </div>
  )
}
