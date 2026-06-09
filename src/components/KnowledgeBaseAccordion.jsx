import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Sparkles, Check, Plus, Trash2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useSaveKnowledgeBaseSections } from '../lib/queries'

const SECTIONS = [
  { id: 'practice_overview', title: 'Practice Overview', placeholder: 'Practice name, doctor, specialty focus, what makes you different…' },
  { id: 'pricing', title: 'Pricing & Financing', placeholder: 'Implant types and prices, financing options, typical case values…' },
  { id: 'what_works', title: 'What Works', placeholder: 'Objection-handling wins. Phrases and approaches that convert…' },
  { id: 'what_not', title: 'What Does NOT Work', placeholder: 'Approaches that fall flat. What to avoid saying…' },
  { id: 'stories', title: 'Patient Stories That Convert', stories: true },
  { id: 'coaching_notes', title: 'TC Coaching Notes', placeholder: 'Running notes for the treatment coordinator…' },
  { id: 'doctor_style', title: 'Doctor Communication Style', placeholder: 'How the doctor likes things framed and presented…' },
  { id: 'scheduling', title: 'Scheduling & Availability', placeholder: 'Availability, wait times, surgery windows…' },
]
const STORY_CATEGORIES = [
  { key: 'price_overcome', label: 'Price overcome' },
  { key: 'fear_overcome', label: 'Fear overcome' },
  { key: 'spouse_converted', label: 'Spouse converted' },
  { key: 'other', label: 'Other' },
]
const WORD_TARGET = 400
const countWords = (s) => (s ? s.trim().split(/\s+/).filter(Boolean).length : 0)
const fmtTime = (ts) => (ts ? new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null)

export default function KnowledgeBaseAccordion({ practiceId }) {
  const { practice, refreshProfile } = useAuth()
  const saveKb = useSaveKnowledgeBaseSections()
  const [sections, setSections] = useState({})
  const [stories, setStories] = useState([])
  const [open, setOpen] = useState('practice_overview')
  const [savedAt, setSavedAt] = useState({})
  const timers = useRef({})

  useEffect(() => {
    if (!practice) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSections(practice.knowledge_base_sections || {})
    setStories(Array.isArray(practice.knowledge_base_stories) ? practice.knowledge_base_stories : [])
  }, [practice])

  function persist(patch, savedKey) {
    if (!practiceId) return
    saveKb.mutate(
      { practiceId, patch },
      {
        onSuccess: () => {
          refreshProfile()
          if (savedKey) setSavedAt((s) => ({ ...s, [savedKey]: Date.now() }))
        },
      },
    )
  }

  function editSection(id, value) {
    setSections((prev) => {
      const next = { ...prev, [id]: value }
      clearTimeout(timers.current[id])
      timers.current[id] = setTimeout(() => {
        persist({ knowledge_base_sections: next }, id)
      }, 1000)
      return next
    })
  }

  async function saveStories(next) {
    setStories(next)
    persist({ knowledge_base_stories: next }, 'stories')
  }

  const totalWords = useMemo(() => {
    let w = 0
    SECTIONS.forEach((s) => { if (!s.stories) w += countWords(sections[s.id]) })
    stories.forEach((st) => { w += countWords(st.text) + countWords(st.title) })
    return w
  }, [sections, stories])

  const pct = Math.min(100, Math.round((totalWords / WORD_TARGET) * 100))

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300">
            <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" /></span>
            AI is actively using this context
          </span>
          {practice?.knowledge_base_ai_updated_at && (
            <span className="text-xs text-slate-500">Last updated by AI {fmtTime(practice.knowledge_base_ai_updated_at)}</span>
          )}
        </div>
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-slate-400"><span>Knowledge depth</span><span>{totalWords} / {WORD_TARGET} words</span></div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-700">
            <div className={`h-full rounded-full ${pct >= 100 ? 'bg-emerald-500' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {SECTIONS.map((s) => {
          const isOpen = open === s.id
          const aiTouched = practice?.knowledge_base_ai_updated_at && (sections[`${s.id}__ai`])
          return (
            <div key={s.id} className="card overflow-hidden">
              <button onClick={() => setOpen(isOpen ? null : s.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface-800/50">
                <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${isOpen ? 'rotate-180' : ''}`} />
                <span className="flex-1 text-sm font-semibold text-white">{s.title}</span>
                {aiTouched && <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary-300"><Sparkles className="h-3 w-3" /> AI updated</span>}
                {savedAt[s.id] && <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400"><Check className="h-3 w-3" /> Saved</span>}
              </button>
              {isOpen && (
                <div className="border-t border-surface-700 px-4 py-4">
                  {s.stories ? (
                    <StoriesEditor stories={stories} onSave={saveStories} saving={saveKb.isPending} />
                  ) : (
                    <>
                      <textarea
                        value={sections[s.id] || ''}
                        onChange={(e) => editSection(s.id, e.target.value)}
                        placeholder={s.placeholder}
                        rows={6}
                        className="input resize-y leading-relaxed"
                      />
                      <p className="mt-1.5 text-right text-xs text-slate-500">{countWords(sections[s.id])} words</p>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StoriesEditor({ stories, onSave, saving }) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ title: '', category: 'price_overcome', text: '' })

  function add() {
    if (!draft.title.trim() && !draft.text.trim()) return
    onSave([...(stories || []), { ...draft, id: `s_${stories.length}_${draft.title.slice(0, 8)}` }])
    setDraft({ title: '', category: 'price_overcome', text: '' }); setAdding(false)
  }
  function remove(i) { onSave(stories.filter((_, idx) => idx !== i)) }

  return (
    <div className="space-y-3">
      {(stories || []).map((st, i) => (
        <div key={st.id || i} className="rounded-lg border border-surface-700 bg-surface-800/40 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-100">{st.title || 'Untitled story'}</p>
              <span className="mt-0.5 inline-block rounded-full bg-surface-700 px-2 py-0.5 text-[10px] font-medium capitalize text-slate-400">{(STORY_CATEGORIES.find((c) => c.key === st.category)?.label) || st.category}</span>
            </div>
            <button onClick={() => remove(i)} disabled={saving} className="rounded-md p-1 text-slate-500 transition hover:bg-surface-700 hover:text-rose-300 disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
          {st.text && <p className="mt-2 text-sm leading-relaxed text-slate-300">{st.text}</p>}
        </div>
      ))}

      {adding ? (
        <div className="rounded-lg border border-primary/30 bg-primary/[0.04] p-3">
          <input value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} placeholder="Story title" className="input mb-2" />
          <select value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))} className="input mb-2">
            {STORY_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <textarea value={draft.text} onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))} placeholder="What happened, and why it converted…" rows={3} className="input resize-y" />
          <div className="mt-2 flex justify-end gap-2">
            <button onClick={() => setAdding(false)} className="btn-ghost text-sm">Cancel</button>
            <button onClick={add} disabled={saving} className="btn-primary text-sm">Add story</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="btn-secondary text-sm"><Plus className="h-4 w-4" /> Add story</button>
      )}
    </div>
  )
}
