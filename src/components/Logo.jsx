import { useBranding } from '../context/BrandingContext'

export default function Logo({ collapsed = false }) {
  const { brandName, logoUrl, isWhiteLabeled } = useBranding()

  if (isWhiteLabeled && logoUrl) {
    return <img src={logoUrl} alt={brandName} className="h-8 max-w-[170px] object-contain" />
  }

  // Clean wordmark only (no icon): "Case" in the primary text color, "Lift" in the
  // sky-blue accent. Falls back to the plain name for other (white-label) brands.
  const name = brandName || 'CaseLift'
  const m = name.match(/^(.*?)(Lift|AI)$/)
  if (collapsed) return null
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-lg font-bold" style={{ letterSpacing: '-0.5px', color: 'var(--text-primary)' }}>
        {m ? (
          <>
            {m[1]}
            <span style={{ color: 'var(--accent)' }}>{m[2]}</span>
          </>
        ) : (
          name
        )}
      </span>
      <span
        className="rounded px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider"
        style={{ color: 'var(--accent)', background: 'var(--accent-subtle)', boxShadow: 'inset 0 0 0 1px var(--accent-border)' }}
      >
        Beta
      </span>
    </div>
  )
}
