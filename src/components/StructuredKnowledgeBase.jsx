import { useEffect, useState } from 'react'
import { Plus, Trash2, Loader2, Check } from 'lucide-react'
import { supabase } from '../lib/supabase'

// Structured KB the sequence engine reads (practice_knowledge_base). Practices add
// USPs, financing options, testimonials, protocols, guarantees, team facts — the
// generator weaves 1-2 of these into messages where relevant.
const CATEGORIES = [
  { key: 'USP', label: 'What makes us unique (USP)', hint: 'e.g. We do same-day implants in one visit' },
  { key: 'financing', label: 'Financing option', hint: 'e.g. 0% for 18 months through Cherry, no credit check' },
  { key: 'testimonial', label: 'Result / testimonial', hint: 'e.g. Robert got his full arch and was eating steak in a week' },
  { key: 'protocol', label: 'Treatment protocol', hint: 'e.g. We use guided surgery for precise, less invasive placement' },
  { key: 'guarantee', label: 'Guarantee / policy', hint: 'e.g. 5-year warranty on all implant restorations' },
  { key: 'team', label: 'Doctor / team', hint: 'e.g. Dr. Lee placed 2,000+ implants, AAID Fellow' },
]
const labelFor = (k) => CATEGORIES.find((c) => c.key === k)?.label || k

export default function StructuredKnowledgeBase({ practiceId }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState('USP')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function load() {
    const { data } = await supabase
      .from('practice_knowledge_base')
      .select('*')
      .eq('practice_id', practiceId)
      .order('created_at', { ascending: false })
    setItems(data || [])
    setLoading(false)
  }
  useEffect(() => {
    let on = true
    supabase
      .from('practice_knowledge_base')
      .select('*')
      .eq('practice_id', practiceId)
      .order('created_at', { ascending: false })
      .then(({ data }) => { if (on) { setItems(data || []); setLoading(false) } })
    return () => { on = false }
  }, [practiceId])

  async function add() {
    const c = content.trim()
    if (!c) return
    setSaving(true)
    const { error } = await supabase.from('practice_knowledge_base').insert({ practice_id: practiceId, category, content: c })
    if (!error) { setContent(''); setSaved(true); setTimeout(() => setSaved(false), 1800); await load() }
    setSaving(false)
  }
  async function remove(id) {
    await supabase.from('practice_knowledge_base').delete().eq('id', id)
    setItems((prev) => prev.filter((i) => i.id !== id))
  }
  async function toggle(it) {
    await supabase.from('practice_knowledge_base').update({ is_active: !it.is_active }).eq('id', it.id)
    setItems((prev) => prev.map((i) => (i.id === it.id ? { ...i, is_active: !i.is_active } : i)))
  }

  const hint = CATEGORIES.find((c) => c.key === category)?.hint

  return (
    <div className="card p-6">
      <h2 className="text-base font-semibold text-white">Selling points the AI uses in follow-ups</h2>
      <p className="mt-1 text-sm text-slate-400">
        Add your USPs, financing, results, and protocols. CaseLift weaves these into follow-up messages when they're relevant to a patient's objection.
      </p>

      <div className="mt-5 grid gap-2 sm:grid-cols-[200px_1fr_auto]">
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="input">
          {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <input
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add() }}
          placeholder={hint}
          className="input"
          maxLength={400}
        />
        <button onClick={add} disabled={saving || !content.trim()} className="btn-primary whitespace-nowrap">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />} Add
        </button>
      </div>

      <div className="mt-5 space-y-2">
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing yet. Add your first selling point above.</p>
        ) : (
          items.map((it) => (
            <div key={it.id} className={`flex items-start gap-3 rounded-lg border border-surface-700 p-3 ${it.is_active ? '' : 'opacity-50'}`}>
              <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary-300">{labelFor(it.category)}</span>
              <p className="min-w-0 flex-1 text-sm text-slate-200">{it.content}</p>
              <button onClick={() => toggle(it)} className="shrink-0 text-xs text-slate-500 hover:text-slate-300" title={it.is_active ? 'Disable' : 'Enable'}>
                {it.is_active ? 'On' : 'Off'}
              </button>
              <button onClick={() => remove(it.id)} className="shrink-0 text-slate-500 transition hover:text-rose-400" title="Delete">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
