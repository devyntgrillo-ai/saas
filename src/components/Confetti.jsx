import { useEffect, useState } from 'react'

// Lightweight, dependency-free confetti, click-through.
//   variant="ambient" — sparse-ish, faint, slow, infinite loop. Renders
//                        CONTAINED (absolute inset-0) so it stays inside its
//                        positioned parent (e.g. the form panel) instead of
//                        spilling over the app chrome. Sits behind content (z-0).
//   variant="burst"   — a celebratory POP: tons of tiny flakes launch up from
//                        the bottom like a confetti cannon, arc to an apex, then
//                        fall away and fade. Fixed full-screen, on TOP (z-50).
// Mount to play, unmount to clear.
const COLORS = ['#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#FBBF24', '#FFFFFF']

export default function Confetti({ variant = 'burst', pieces }) {
  const ambient = variant === 'ambient'
  const count = pieces ?? (ambient ? 110 : 460)

  // Randomized pieces are built in an effect (not during render) so generation
  // stays pure per React 19's rules.
  const [items, setItems] = useState([])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(
      Array.from({ length: count }, (_, i) => {
        if (ambient) {
          const duration = 7 + Math.random() * 7
          return {
            id: i,
            ambient: true,
            left: Math.random() * 100,
            // negative delay pre-spreads pieces mid-fall so the panel is already
            // scattered at mount.
            delay: -Math.random() * duration,
            duration,
            size: 5 + Math.random() * 5,
            color: COLORS[i % COLORS.length],
            drift: (Math.random() - 0.5) * 90,
            opacity: 0.18 + Math.random() * 0.24,
          }
        }
        // burst: launch up from the bottom, arc over, fall away.
        const x = (Math.random() - 0.5) * 64 // vw horizontal end drift
        return {
          id: i,
          ambient: false,
          left: Math.random() * 100,
          delay: Math.random() * 0.3, // tight stagger so it reads as one pop
          duration: 2.3 + Math.random() * 2.3,
          size: 2 + Math.random() * 3.5, // tiny flakes
          color: COLORS[i % COLORS.length],
          x,
          xMid: x * 0.5,
          peak: -(48 + Math.random() * 44), // vh up at the apex
          endY: 10 + Math.random() * 24, // vh below the launch — falls away
          rot: (Math.random() - 0.5) * 1440, // lots of spin for tiny flakes
        }
      }),
    )
  }, [count, ambient])

  return (
    <div
      aria-hidden
      className={`pointer-events-none overflow-hidden ${ambient ? 'absolute inset-0 z-0' : 'fixed inset-0 z-50'}`}
    >
      <style>{`
        /* ambient: container-relative fall via top% so it stays inside the panel */
        @keyframes cl-confetti-drift {
          0%   { top: -8%;  transform: translate3d(0, 0, 0) rotate(0deg); }
          100% { top: 108%; transform: translate3d(var(--cl-drift), 0, 0) rotate(900deg); }
        }
        /* burst: cannon from the bottom — rise to an apex, arc back down, fade */
        @keyframes cl-confetti-pop {
          0%   { transform: translate3d(0, 0, 0) rotate(0deg); opacity: 1; }
          50%  { transform: translate3d(var(--cl-xm), var(--cl-peak), 0) rotate(calc(var(--cl-r) * 0.5)); opacity: 1; }
          100% { transform: translate3d(var(--cl-x), var(--cl-endy), 0) rotate(var(--cl-r)); opacity: 0; }
        }
      `}</style>
      {items.map((p) =>
        p.ambient ? (
          <span
            key={p.id}
            style={{
              position: 'absolute',
              top: 0,
              left: `${p.left}%`,
              width: `${p.size}px`,
              height: `${p.size * 0.45 + 3}px`,
              background: p.color,
              borderRadius: '2px',
              opacity: p.opacity,
              '--cl-drift': `${p.drift}px`,
              animation: `cl-confetti-drift ${p.duration}s linear ${p.delay}s infinite`,
            }}
          />
        ) : (
          <span
            key={p.id}
            style={{
              position: 'absolute',
              bottom: 0,
              top: 'auto',
              left: `${p.left}%`,
              width: `${p.size}px`,
              height: `${p.size}px`,
              background: p.color,
              borderRadius: '1px',
              opacity: 0.95,
              '--cl-x': `${p.x}vw`,
              '--cl-xm': `${p.xMid}vw`,
              '--cl-peak': `${p.peak}vh`,
              '--cl-endy': `${p.endY}vh`,
              '--cl-r': `${p.rot}deg`,
              animation: `cl-confetti-pop ${p.duration}s ease-out ${p.delay}s forwards`,
            }}
          />
        ),
      )}
    </div>
  )
}
