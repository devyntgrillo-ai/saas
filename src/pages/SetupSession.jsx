import { useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarCheck } from 'lucide-react'
import Logo from '../components/Logo'
import BookingCalendar from '../components/BookingCalendar'
import { useAuth } from '../context/AuthContext'
import { useUpdatePractice } from '../lib/queries'

// Final step of onboarding: BAA is signed, billing is active. We send the
// practice straight here (the multi-step wizard is bypassed) to book a 20-minute
// Setup Session where our team connects their PMS, configures messaging, and
// gets them recording. Booking or skipping both land on the Dashboard.
export default function SetupSession() {
  const navigate = useNavigate()
  const { practiceId, refreshProfile } = useAuth()
  const updatePractice = useUpdatePractice()
  const bookedRef = useRef(false)

  const handleBooked = useCallback(async () => {
    if (bookedRef.current) return
    bookedRef.current = true
    try {
      if (practiceId) {
        await updatePractice.mutateAsync({
          practiceId,
          patch: { setup_session_booked_at: new Date().toISOString() },
        })
        await refreshProfile()
      }
    } catch { /* non-blocking — still send them to the dashboard */ }
    navigate('/', { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [practiceId, navigate])

  return (
    <div className="relative min-h-screen overflow-hidden bg-surface">
      <div className="relative mx-auto flex max-w-2xl flex-col px-5 py-10 sm:px-8 sm:py-16">
        <div className="flex justify-center">
          <Logo forceDefault />
        </div>

        <div className="mt-10 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-300">
            <CalendarCheck className="h-7 w-7" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">You're in! Let's get you set up.</h1>
          <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-slate-400">
            Book a 20-minute Setup Session with our team. We'll connect your PMS, configure your
            messaging, and have you live by the end of the call.
          </p>
        </div>

        <div className="mt-8">
          <BookingCalendar onBooked={handleBooked} idSuffix="setup_session" />
        </div>

        <button
          type="button"
          onClick={() => navigate('/', { replace: true })}
          className="mx-auto mt-6 block text-sm font-medium text-slate-500 transition hover:text-slate-300"
        >
          Skip for now — go to dashboard
        </button>
      </div>
    </div>
  )
}
