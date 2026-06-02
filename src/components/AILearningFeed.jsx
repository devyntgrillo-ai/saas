import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { timeAgo } from '../lib/consults'

// Passive feed of AI actions already taken - replaces the "apply suggestion"
// pattern. The AI just works; this shows it working. Read-only.
export default function AILearningFeed({ practiceId }) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const [monthCount, setMonthCount] = useState(0)

  useEffect(() => {
    if (!practiceId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false)
      return
    }
    let active = true
    supabase
      .from('ai_learning_events')
      .select('*')
      .eq('practice_id', practiceId)
      .order('created_at', { ascending: false })
      .limit(30)
      .then(({ data }) => {
        if (!active) return
        const rows = data || []
        setEvents(rows)
        const cutoff = Date.now() - 30 * 86400000
        setMonthCount(rows.filter((e) => new Date(e.created_at).getTime() >= cutoff).length)
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [practiceId])

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
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-100">
            Hope's Learning Feed
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
            </span>
          </h2>
          <p className="mt-0.5 text-sm text-slate-400">
            Hope is evolving automatically based on what's working
          </p>
        </div>
      </div>

      <ul className="mt-5 space-y-4">
        {shown.map((e) => (
          <li key={e.id} className="flex gap-3">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-600" />
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-relaxed text-slate-200">{e.description}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="text-slate-500">{timeAgo(e.created_at)} ago</span>
                {e.result_value && <span className="font-medium text-[#34d399]">{e.result_value}</span>}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {events.length > 5 && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="mt-4 text-sm font-medium text-primary-300 hover:text-primary-200"
        >
          {showAll ? 'Show less' : `View full history`}
        </button>
      )}

      <p className="mt-4 border-t border-white/[0.07] pt-3 text-xs text-slate-500">
        Hope AI has made <span className="font-semibold text-slate-300">{monthCount}</span> optimizations to your
        sequences in the last 30 days.
      </p>
    </div>
  )
}
