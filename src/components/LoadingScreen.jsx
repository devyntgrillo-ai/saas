import { useEffect, useState } from 'react'

// Branded full-screen loader shown while the app initializes / auth resolves /
// an impersonated practice loads. Self-contained: keyframes live in the inline
// <style> below (prefixed `cl-`) so no global CSS or new package is needed.

const MESSAGES = [
  'Preparing your dashboard...',
  'Loading your consults...',
  'Checking your sequences...',
  'Almost ready...',
]

export default function LoadingScreen() {
  const [msg, setMsg] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setMsg((i) => (i + 1) % MESSAGES.length), 1500)
    return () => clearInterval(id)
  }, [])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '20px',
        background: 'linear-gradient(160deg, #0a0f1e 0%, #0f1729 100%)',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      }}
      role="status"
      aria-label="Loading"
    >
      <style>{`
        @keyframes cl-pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.04); } }
        @keyframes cl-bar { 0% { transform: translateX(-100%); } 100% { transform: translateX(200%); } }
        @keyframes cl-msg { 0% { opacity: 0; } 25% { opacity: 1; } 75% { opacity: 1; } 100% { opacity: 0; } }
        @media (prefers-reduced-motion: reduce) {
          .cl-logo, .cl-bar-fill, .cl-msg { animation: none !important; }
        }
      `}</style>

      {/* Logo mark (matches the sidebar): sky-gradient rounded square + white lift arrow */}
      <div className="cl-logo" style={{ animation: 'cl-pulse 2s ease-in-out infinite' }}>
        <svg width="64" height="64" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <defs>
            <linearGradient id="cl-loader-mark" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#38BDF8" />
              <stop offset="1" stopColor="#0284C7" />
            </linearGradient>
          </defs>
          <rect width="32" height="32" rx="8" fill="url(#cl-loader-mark)" />
          <path d="M16 23 V11 M16 11 L11 16 M16 11 L21 16" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {/* Wordmark */}
      <div style={{ color: '#fff', fontSize: '24px', fontWeight: 600, letterSpacing: '-0.5px' }}>CaseLift</div>

      {/* Loading bar */}
      <div
        style={{
          width: '200px',
          height: '3px',
          background: '#1e293b',
          borderRadius: '9999px',
          overflow: 'hidden',
        }}
      >
        <div
          className="cl-bar-fill"
          style={{
            width: '40%',
            height: '100%',
            borderRadius: '9999px',
            background: 'linear-gradient(90deg, rgba(14,165,233,0) 0%, #0EA5E9 50%, rgba(14,165,233,0) 100%)',
            animation: 'cl-bar 1.5s ease-in-out infinite',
          }}
        />
      </div>

      {/* Rotating messages */}
      <div
        key={msg}
        className="cl-msg"
        style={{ color: '#64748b', fontSize: '13px', animation: 'cl-msg 1.5s ease-in-out', minHeight: '16px' }}
      >
        {MESSAGES[msg]}
      </div>
    </div>
  )
}
