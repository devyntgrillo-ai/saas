import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardList, ArrowRight } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { LAUNCHPAD_STEPS, LAUNCHPAD_TOTAL, loadLaunchpadStatus } from '../lib/launchpad'

// Compact "setup in progress" nudge shown at the top of the Dashboard until the
// Launchpad is complete. Mirrors the nav item: both disappear once
// launchpad_completed_at is set.
export default function LaunchpadCard() {
  const { practice, practiceId } = useAuth()
  const [count, setCount] = useState(null)
  const done = Boolean(practice?.launchpad_completed_at)

  useEffect(() => {
    let alive = true
    if (!practiceId || done) return
    loadLaunchpadStatus(practiceId, practice).then((s) => {
      if (alive) setCount(LAUNCHPAD_STEPS.filter((step) => s.has(step.key)).length)
    })
    return () => { alive = false }
  }, [practiceId, practice, done])

  if (done || count === null) return null

  const pct = Math.round((count / LAUNCHPAD_TOTAL) * 100)

  return (
    <Link
      to="/launchpad"
      className="group flex items-center gap-4 rounded-2xl border border-primary/30 bg-primary/[0.06] p-4 transition hover:bg-primary/[0.1]"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary-300">
        <ClipboardList className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-white">📋 Setup in progress — {count} of {LAUNCHPAD_TOTAL} steps complete</p>
        <div className="mt-2 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-surface-800">
          <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary-300">
        Go to Launchpad <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  )
}
