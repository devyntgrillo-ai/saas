import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Check } from 'lucide-react'
import Modal from './Modal'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

const FINANCING = ['CareCredit', 'Sunbit', 'Cherry', 'Alphaeon', 'In-house payment plan', 'Other']

// Short 5-field knowledge-base starter. Writes one practice_knowledge_base row
// per answered field (category-tagged) so the follow-up AI has practice context
// without making the user fill the full Knowledge Base first.
export default function KnowledgeBaseQuickForm({ onClose, onSaved }) {
  const { practiceId } = useAuth()
  const [usp, setUsp] = useState('')
  const [financing, setFinancing] = useState([])
  const [years, setYears] = useState('')
  const [guarantee, setGuarantee] = useState('')
  const [story, setStory] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function toggleFin(opt) {
    setFinancing((prev) => (prev.includes(opt) ? prev.filter((x) => x !== opt) : [...prev, opt]))
  }

  async function save() {
    if (!practiceId) return
    setError('')
    const rows = []
    if (usp.trim()) rows.push({ category: 'USP', content: usp.trim() })
    if (financing.length) rows.push({ category: 'financing', content: `Financing offered: ${financing.join(', ')}.` })
    if (String(years).trim()) rows.push({ category: 'team', content: `Doctor has ${String(years).trim()} years of experience.` })
    if (guarantee.trim()) rows.push({ category: 'guarantee', content: guarantee.trim() })
    if (story.trim()) rows.push({ category: 'testimonial', content: story.trim() })
    if (!rows.length) { setError('Fill in at least one field, or add details later.'); return }
    setBusy(true)
    try {
      const { error: e } = await supabase
        .from('practice_knowledge_base')
        .insert(rows.map((r) => ({ ...r, practice_id: practiceId, is_active: true })))
      if (e) throw e
      onSaved?.()
    } catch (e) {
      setError(e?.message || 'Could not save. Please try again.')
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Tell CaseLift about your practice"
      onClose={onClose}
      footer={
        <>
          <Link to="/settings/knowledge-base" className="btn-ghost">Add more details later</Link>
          <button onClick={save} disabled={busy} className="btn-primary">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Save and continue
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-400">These few details help CaseLift write follow-up messages that sound like your practice. All optional — anything you add helps.</p>

        <div>
          <label className="label">What makes your practice different?</label>
          <textarea className="input resize-y" rows={3} value={usp} onChange={(e) => setUsp(e.target.value)} placeholder="2–3 sentences on what sets you apart…" />
        </div>

        <div>
          <label className="label">Financing options you offer</label>
          <div className="grid grid-cols-2 gap-2">
            {FINANCING.map((opt) => (
              <label key={opt} className="flex items-center gap-2 rounded-lg border border-surface-700 bg-surface-800/50 px-3 py-2 text-sm text-slate-300">
                <input type="checkbox" checked={financing.includes(opt)} onChange={() => toggleFin(opt)} className="h-4 w-4 rounded border-surface-600 bg-surface-800 text-primary" />
                {opt}
              </label>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Doctor’s years of experience</label>
            <input type="number" min="0" className="input" value={years} onChange={(e) => setYears(e.target.value)} placeholder="e.g. 15" />
          </div>
          <div>
            <label className="label">Do you offer any guarantee?</label>
            <input className="input" value={guarantee} onChange={(e) => setGuarantee(e.target.value)} placeholder='e.g. "$50k in 90 days or free"' />
          </div>
        </div>

        <div>
          <label className="label">One patient success story <span className="font-normal text-slate-500">(optional)</span></label>
          <textarea className="input resize-y" rows={2} value={story} onChange={(e) => setStory(e.target.value)} placeholder="A short before/after a patient would relate to…" />
        </div>

        {error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}
      </div>
    </Modal>
  )
}
