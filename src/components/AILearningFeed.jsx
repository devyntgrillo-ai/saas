import { useMemo, useState } from 'react'
import { timeAgo } from '../lib/consults'
import { useAILearningEvents } from '../lib/queries'

export default function AILearningFeed({ practiceId }) {
  const { data, isLoading: loading } = useAILearningEvents(practiceId)
  const events = data?.events ?? []
  const [showAll, setShowAll] = useState(false)

  const monthCount = useMemo(() => {
    const cutoff = Date.now() - 30 * 86400000
    return events.filter((e) => new Date(e.created_at).getTime() >= cutoff).length
  }, [events])

  if (loading) {
    return (
      <div className="card p-5">
        <div className="h-4 w-40 animate-pulse rounded bg-surface-800" />
        <div className="mt-4 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-3">
              <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-surface-800" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-3/4 animate-pulse rounded bg-surface-800" />
                <div className="h-3 w-1/4 animate-pulse rounded bg-surface-800" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (events.length === 0) return null

  const shown = showAll ? events : events.slice(0, 5)

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">What CaseLift learned this month</h2>
          <p className="mt-0.5 text-xs text-slate-500">{monthCount} optimization{monthCount === 1 ? '' : 's'} applied automatically</p>
        </div>
        {events.length > 5 && (
          <button type="button" onClick={() => setShowAll((v) => !v)} className="shrink-0 text-xs font-medium text-primary-400 hover:text-primary-300">
            {showAll ? 'Show less' : `Show all (${events.length})`}
          </button>
        )}
      </div>
      <ul className="mt-4 space-y-3">
        {shown.map((e) => (
          <li key={e.id} className="flex gap-3 text-sm">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-400" />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-slate-200">{e.title}</p>
              {e.description && <p className="mt-0.5 text-slate-500">{e.description}</p>}
              <p className="mt-1 text-xs text-slate-600">{timeAgo(e.created_at)}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
