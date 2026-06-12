import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'

// Shared GHL (LeadConnector) Setup Session booking widget. Used by the post-BAA
// SetupSession page and the admin New Signup success screen. The embed id is
// fixed; form_embed.js auto-resizes the iframe to its content height.
const GHL_CALENDAR_ID = 'yF486V70ALrKsciletAg'
const GHL_BOOKING_SRC = `https://api.leadconnectorhq.com/widget/booking/${GHL_CALENDAR_ID}`
const GHL_EMBED_SCRIPT = 'https://link.msgsndr.com/js/form_embed.js'

export default function BookingCalendar({ onBooked, minHeight = 720, idSuffix = 'embed' }) {
  const [loaded, setLoaded] = useState(false)
  const bookedRef = useRef(false)

  // Warm up the GHL connection ASAP (DNS + TLS) so the booking iframe — which can
  // otherwise sit blank for 10-15s — starts painting sooner.
  useEffect(() => {
    const hosts = ['https://api.leadconnectorhq.com', 'https://link.msgsndr.com']
    const links = hosts.flatMap((href) =>
      ['preconnect', 'dns-prefetch'].map((rel) => {
        const l = document.createElement('link')
        l.rel = rel
        l.href = href
        l.crossOrigin = 'anonymous'
        document.head.appendChild(l)
        return l
      }),
    )
    return () => links.forEach((l) => l.remove())
  }, [])

  // Load the LeadConnector embed script once so the iframe auto-sizes.
  useEffect(() => {
    if (document.querySelector(`script[src="${GHL_EMBED_SCRIPT}"]`)) return
    const s = document.createElement('script')
    s.src = GHL_EMBED_SCRIPT
    s.type = 'text/javascript'
    s.async = true
    document.body.appendChild(s)
  }, [])

  // Best-effort booking detection: the GHL widget posts a message to the parent
  // window when an appointment is booked. Match LeadConnector/msgsndr messages
  // that look like a booking and fire onBooked once.
  useEffect(() => {
    function onMessage(e) {
      const origin = String(e.origin || '')
      if (!/leadconnectorhq\.com|msgsndr\.com/.test(origin)) return
      const raw = typeof e.data === 'string' ? e.data : JSON.stringify(e.data || '')
      if (!/appointment|booking|booked|scheduled/i.test(raw)) return
      if (bookedRef.current) return
      bookedRef.current = true
      onBooked?.()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [onBooked])

  return (
    <div className="relative overflow-hidden rounded-2xl border border-surface-700 bg-white" style={{ minHeight }}>
      {!loaded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white text-slate-500">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
          <p className="text-sm font-medium">Loading calendar…</p>
        </div>
      )}
      <iframe
        src={GHL_BOOKING_SRC}
        title="Book your Setup Session"
        onLoad={() => setLoaded(true)}
        style={{ width: '100%', minHeight, border: 'none', overflow: 'hidden' }}
        scrolling="no"
        id={`${GHL_CALENDAR_ID}_${idSuffix}`}
      />
    </div>
  )
}
