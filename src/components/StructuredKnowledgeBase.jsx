import { useState } from 'react'
import { Plus, Trash2, Loader2, Check, Sparkles, X } from 'lucide-react'
import {
  usePracticeKbItems,
  useAddPracticeKbItem,
  useRemovePracticeKbItem,
  useTogglePracticeKbItem,
  useApprovePracticeKbItem,
  isMutating,
} from '../lib/queries'

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
  const { data: items = [], isLoading: loading } = usePracticeKbItems(practiceId)
  const addMutation = useAddPracticeKbItem()
  const removeMutation = useRemovePracticeKbItem()
  const toggleMutation = useTogglePracticeKbItem()
  const approveMutation = useApprovePracticeKbItem()
  const [category, setCategory] = useState('USP')
  const [content, setContent] = useState('')
  const [saved, setSaved] = useState(false)

  function add() {
    const c = content.trim()
    if (!c || addMutation.isPending) return
    addMutation.mutate(
      { practiceId, category, content: c },
      {
        onSuccess: () => {
          setContent('')
          setSaved(true)
          setTimeout(() => setSaved(false), 1800)
        },
      },
    )
  }

  function remove(id) {
    removeMutation.mutate({ id, practiceId })
  }

  function toggle(it) {
    toggleMutation.mutate({ id: it.id, practiceId, isActive: it.is_active })
  }

  function approve(id) {
    approveMutation.mutate({ id, practiceId })
  }

  const hint = CATEGORIES.find((c) => c.key === category)?.hint
  const adding = addMutation.isPending
  // Auto-learned facts awaiting review vs. the approved list the AI actually uses.
  const pending = items.filter((i) => i.status === 'pending')
  const approved = items.filter((i) => i.status !== 'pending')

  return (
    <div className="space-y-4">

    {/* Review queue — facts CaseLift learned from recorded consults. Nothing here
        is used by the AI until approved. */}
    {pending.length > 0 && (
      <div className="card border-primary/30 p-6">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary-300" />
          <h2 className="text-base font-semibold text-white">Learned from your consults — review</h2>
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary-300">{pending.length}</span>
        </div>
        <p className="mt-1 text-sm text-slate-400">CaseLift picked these up from recorded consultations. Approve the ones that are accurate and the AI will start using them; dismiss anything that's off.</p>
        <div className="mt-5 space-y-2">
          {pending.map((it) => {
            const approving = isMutating(approveMutation, (v) => v.id === it.id)
            const dismissing = isMutating(removeMutation, (v) => v.id === it.id)
            return (
              <div key={it.id} className="flex items-start gap-3 rounded-lg border border-surface-700 bg-surface-800/40 p-3">
                <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary-300">{labelFor(it.category)}</span>
                <p className="min-w-0 flex-1 text-sm text-slate-200">{it.content}</p>
                <button onClick={() => approve(it.id)} disabled={approving || dismissing} className="inline-flex shrink-0 items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-1 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/25 disabled:opacity-50" title="Approve">
                  {approving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Approve
                </button>
                <button onClick={() => remove(it.id)} disabled={approving || dismissing} className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-400 transition hover:text-rose-400 disabled:opacity-50" title="Dismiss">
                  {dismissing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />} Dismiss
                </button>
              </div>
            )
          })}
        </div>
      </div>
    )}

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
        <button onClick={add} disabled={adding || !content.trim()} className="btn-primary whitespace-nowrap">
          {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />} Add
        </button>
      </div>

      <div className="mt-5 space-y-2">
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : approved.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing yet. Add your first selling point above.</p>
        ) : (
          approved.map((it) => {
            const toggling = isMutating(toggleMutation, (v) => v.id === it.id)
            const removing = isMutating(removeMutation, (v) => v.id === it.id)
            return (
              <div key={it.id} className={`flex items-start gap-3 rounded-lg border border-surface-700 p-3 ${it.is_active ? '' : 'opacity-50'}`}>
                <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary-300">{labelFor(it.category)}</span>
                <p className="min-w-0 flex-1 text-sm text-slate-200">{it.content}</p>
                <button onClick={() => toggle(it)} disabled={toggling} className="inline-flex shrink-0 items-center gap-1 text-xs text-slate-500 hover:text-slate-300 disabled:opacity-50" title={it.is_active ? 'Disable' : 'Enable'}>
                  {toggling ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  {it.is_active ? 'On' : 'Off'}
                </button>
                <button onClick={() => remove(it.id)} disabled={removing} className="shrink-0 text-slate-500 transition hover:text-rose-400 disabled:opacity-50" title="Delete">
                  {removing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
    </div>
  )
}
