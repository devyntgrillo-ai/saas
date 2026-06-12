import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarCheck, CalendarClock, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

// Persistent Dashboard banner nudging the practice to book (or showing the
// upcoming) Setup Session. Hidden once the session is completed. Dismissal is
// stored per-practice + per-state in localStorage, so dismissing the
// "not booked" banner doesn't suppress the "booked" one (or vice-versa).
function dismissKey(practiceId, booked) {
  return `cl_setup_banner_dismissed_${practiceId}_${booked ? 'booked' : 'unbooked'}`
}

export default function SetupSessionBanner() {
  const { practice, practiceId } = useAuth()
  const navigate = useNavigate()
  const booked = Boolean(practice?.setup_session_booked_at)
  const completed = Boolean(practice?.setup_session_completed_at)

  const [dismissed, setDismissed] = useState(() => {
    if (!practiceId) return false
    try { return localStorage.getItem(dismissKey(practiceId, booked)) === '1' } catch { return false }
  })

  // Once the session is held there's nothing to nudge. Also hide if no practice
  // yet, or the user dismissed this state's banner.
  if (!practiceId || completed || dismissed) return null

  function dismiss() {
    try { localStorage.setItem(dismissKey(practiceId, booked), '1') } catch { /* noop */ }
    setDismissed(true)
  }

  const Icon = booked ? CalendarClock : CalendarCheck

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-primary/30 bg-primary/[0.06] p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary-300">
        <Icon className="h-5 w-5" />
      </div>
      <p className="min-w-0 flex-1 text-sm text-slate-200">
        {booked
          ? "Your Setup Session is coming up. We'll handle PMS, messaging, and team setup together."
          : "Book your Setup Session — we'll get everything configured together in 30 minutes."}
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => navigate('/onboarding/setup-session')}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold !text-white transition hover:bg-primary-500"
        >
          {booked ? 'Reschedule' : 'Book now →'}
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="rounded-lg p-1.5 text-slate-500 transition hover:bg-surface-800 hover:text-slate-300"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
