import { useEffect, useState } from 'react'

// Lightweight, dependency-free full-page confetti burst. Renders a fixed,
// click-through overlay of colored pieces that fall once and settle. Mount it
// when you want the celebration; unmount to clear.
const COLORS = ['#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#FFFFFF']

export default function Confetti({ pieces = 160 }) {
  // Randomized pieces are built in an effect (not during render) so the
  // generation stays pure per React 19's rules.
  const [items, setItems] = useState([])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(
      Array.from({ length: pieces }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 0.8,
        duration: 2.6 + Math.random() * 2.4,
        size: 6 + Math.random() * 7,
        color: COLORS[i % COLORS.length],
        rotate: Math.random() * 360,
        drift: (Math.random() - 0.5) * 220,
      })),
    )
  }, [pieces])

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      <style>{`@keyframes cl-confetti-fall {
        0%   { transform: translate3d(0, -12vh, 0) rotate(0deg); opacity: 1; }
        100% { transform: translate3d(var(--cl-drift), 112vh, 0) rotate(900deg); opacity: 1; }
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
            opacity: 0.92,
            '--cl-drift': `${p.drift}px`,
            transform: `rotate(${p.rotate}deg)`,
            animation: `cl-confetti-fall ${p.duration}s linear ${p.delay}s forwards`,
          }}
        />
      ))}
    </div>
  )
}
