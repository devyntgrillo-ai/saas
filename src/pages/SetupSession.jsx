import { useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarCheck } from 'lucide-react'
import Logo from '../components/Logo'
import Confetti from '../components/Confetti'
import { useAuth } from '../context/AuthContext'
import { useUpdatePractice } from '../lib/queries'

// GHL (LeadConnector) booking widget for the post-BAA Setup Session. The embed
// id is fixed; form_embed.js auto-resizes the iframe to its content height.
const GHL_CALENDAR_ID = 'yF486V70ALrKsciletAg'
const GHL_BOOKING_SRC = `https://api.leadconnectorhq.com/widget/booking/${GHL_CALENDAR_ID}`
const GHL_EMBED_SCRIPT = 'https://link.msgsndr.com/js/form_embed.js'

// Final step of onboarding: BAA is signed, billing is active. We send the
// practice straight here (the multi-step wizard is bypassed) to book a 30-minute
// Setup Session where our team connects their PMS, configures messaging, and
// gets them recording. Booking or skipping both land on the Dashboard.
export default function SetupSession() {
  const navigate = useNavigate()
  const { practiceId, refreshProfile } = useAuth()
  const updatePractice = useUpdatePractice()
  const bookedRef = useRef(false)

  // Load the LeadConnector embed script once so the iframe auto-sizes.
  useEffect(() => {
    if (document.querySelector(`script[src="${GHL_EMBED_SCRIPT}"]`)) return
    const s = document.createElement('script')
    s.src = GHL_EMBED_SCRIPT
    s.type = 'text/javascript'
    s.async = true
    document.body.appendChild(s)
  }, [])

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

  // Best-effort booking detection: the GHL widget posts a message to the parent
  // window when an appointment is booked. Match LeadConnector/msgsndr messages
  // that look like a booking, stamp setup_session_booked_at, then go to the
  // dashboard. The "Skip for now" link is the guaranteed path if no event fires.
  useEffect(() => {
    function onMessage(e) {
      const origin = String(e.origin || '')
      if (!/leadconnectorhq\.com|msgsndr\.com/.test(origin)) return
      const raw = typeof e.data === 'string' ? e.data : JSON.stringify(e.data || '')
      if (!/appointment|booking|booked|scheduled/i.test(raw)) return
      handleBooked()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [handleBooked])

  return (
    <div className="relative min-h-screen overflow-hidden bg-surface">
      <Confetti variant="burst" />

      <div className="relative mx-auto flex max-w-2xl flex-col px-5 py-10 sm:px-8 sm:py-16">
        <Logo forceDefault />

        <div className="mt-10 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-300">
            <CalendarCheck className="h-7 w-7" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">You're in! Let's get you set up.</h1>
          <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-slate-400">
            Book a 30-minute Setup Session with our team. We'll connect your PMS, configure your
            messaging, and have you recording consults by the end of the call.
          </p>
        </div>

        {/* GHL booking calendar */}
        <div className="mt-8 overflow-hidden rounded-2xl border border-surface-700 bg-white">
          <iframe
            src={GHL_BOOKING_SRC}
            title="Book your Setup Session"
            style={{ width: '100%', minHeight: 720, border: 'none', overflow: 'hidden' }}
            scrolling="no"
            id={`${GHL_CALENDAR_ID}_setup_session`}
          />
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
