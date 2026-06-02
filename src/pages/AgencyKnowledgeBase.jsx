import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { BookOpen } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import KnowledgeBaseEditor from '../components/KnowledgeBaseEditor'
import AgencyTabs from '../components/AgencyTabs'

// Agency view: pick any client practice and edit its knowledge base.
export default function AgencyKnowledgeBase() {
  const { agency, agencyLoading, isAgencyUser } = useAuth()
  const [practices, setPractices] = useState([])
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!agency?.id) return
    let active = true
    supabase
      .from('practices')
      .select('id, name')
      .eq('agency_id', agency.id)
      .order('name', { ascending: true })
      .then(({ data }) => {
        if (!active) return
        const rows = data || []
        setPractices(rows)
        setSelected((cur) => cur || rows[0]?.id || '')
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [agency?.id])

  if (!agencyLoading && !isAgencyUser) return <Navigate to="/settings/knowledge-base" replace />

  return (
    <div className="space-y-6">
      <AgencyTabs />
      <div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white">
              <BookOpen className="h-6 w-6 text-primary-400" /> Knowledge Base
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Add your practice details so Hope can personalize every message.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">Practice</span>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-sm text-slate-100 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-500/30"
            >
              {practices.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-slate-500">Loading practices…</div>
      ) : !selected ? (
        <div className="card px-6 py-16 text-center text-sm text-slate-400">No client practices yet.</div>
      ) : (
        <KnowledgeBaseEditor key={selected} practiceId={selected} />
      )}
    </div>
  )
}
