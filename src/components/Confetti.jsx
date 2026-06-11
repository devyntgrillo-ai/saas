import { useEffect, useState } from 'react'

// Lightweight, dependency-free full-page confetti, click-through.
//   variant="ambient" — sparse, faint, slow, infinite loop; sits BEHIND content
//                        (z-0) for a subtle festive backdrop.
//   variant="burst"   — dense, bright, larger; one-shot pop on TOP (z-50) for a
//                        celebration moment.
// Mount to play, unmount to clear.
const COLORS = ['#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#FFFFFF']

export default function Confetti({ variant = 'burst', pieces }) {
  const ambient = variant === 'ambient'
  const count = pieces ?? (ambient ? 44 : 260)

  // Randomized pieces are built in an effect (not during render) so generation
  // stays pure per React 19's rules.
  const [items, setItems] = useState([])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(
      Array.from({ length: count }, (_, i) => {
        const duration = ambient ? 7 + Math.random() * 7 : 2.6 + Math.random() * 2.8
        return {
          id: i,
          left: Math.random() * 100,
          // ambient: negative delay pre-spreads pieces mid-fall so the screen is
          // already scattered at mount; burst: small positive stagger.
          delay: ambient ? -Math.random() * duration : Math.random() * 0.7,
          duration,
          size: ambient ? 5 + Math.random() * 5 : 8 + Math.random() * 9,
          color: COLORS[i % COLORS.length],
          drift: (Math.random() - 0.5) * (ambient ? 90 : 360),
          opacity: ambient ? 0.16 + Math.random() * 0.22 : 0.95,
        }
      }),
    )
  }, [count, ambient])

  return (
    <div
      aria-hidden
      className={`pointer-events-none fixed inset-0 overflow-hidden ${ambient ? 'z-0' : 'z-50'}`}
    >
      <style>{`@keyframes cl-confetti-fall {
        0%   { transform: translate3d(0, -12vh, 0) rotate(0deg); }
        100% { transform: translate3d(var(--cl-drift), 112vh, 0) rotate(900deg); }
      }`}</style>
      {items.map((p) => (
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
            animation: `cl-confetti-fall ${p.duration}s linear ${p.delay}s ${ambient ? 'infinite' : 'forwards'}`,
          }}
        />
      ))}
    </div>
  )
}
