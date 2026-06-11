import { useBranding } from '../context/BrandingContext'
import { useTheme } from '../context/ThemeContext'

// forceDefault: ignore any white-label branding and always render CaseLift.
// Used on billing / BAA / contract screens, which must always be CaseLift.
export default function Logo({ collapsed = false, size = 'md', showBeta = true, forceDefault = false }) {
  const branding = useBranding()
  const { logoUrl, logoDarkUrl, logoLightUrl } = branding
  const isWhiteLabeled = forceDefault ? false : branding.isWhiteLabeled
  const brandName = forceDefault ? 'CaseLift' : branding.brandName
  const { theme } = useTheme()

  const lg = size === 'lg'
  const markClass = lg ? 'h-10 w-10' : 'h-7 w-7'
  const textClass = lg ? 'text-2xl' : 'text-lg'

  // Use the theme-specific logo, falling back to the universal one.
  const themedLogo = (theme === 'dark' ? logoDarkUrl : logoLightUrl) || logoUrl

  if (isWhiteLabeled && themedLogo) {
    return <img src={themedLogo} alt={brandName} className={`${lg ? 'h-11' : 'h-8'} min-w-0 max-w-[190px] object-contain`} />
  }

  // Default CaseLift brand: on dark surfaces use the full-color image lockup
  // (its light wordmark only reads on dark backgrounds). Light theme keeps the
  // text logo below. Collapsed falls through to the standalone mark.
  if (theme === 'dark' && !collapsed) {
    return (
      <div className="flex items-center gap-2.5">
        <img src="/caselift-logo.png" alt="CaseLift" className={`${lg ? 'h-11' : 'h-8'} w-auto object-contain`} />
        {showBeta && (
          <span
            className="rounded px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider"
            style={{ color: 'var(--accent)', background: 'var(--accent-subtle)', boxShadow: 'inset 0 0 0 1px var(--accent-border)' }}
          >
            Beta
          </span>
        )}
      </div>
    )
  }

  // Mark (matches the favicon): sky-gradient rounded square with an upward
  // "lift" arrow, shown to the left of the wordmark, "Case" in the primary text
  // color, "Lift" in the sky-blue accent.
  const name = brandName || 'CaseLift'
  const m = name.match(/^(.*?)(Lift|AI)$/)
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className={`${markClass} shrink-0`} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          {/* Brand-driven: follows the white-label primary palette, defaulting
              to CaseLift sky via the index.css --primary-* values. */}
          <linearGradient id="caselift-mark" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="rgb(var(--primary-400))" />
            <stop offset="1" stopColor="rgb(var(--primary-700))" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="8" fill="url(#caselift-mark)" />
        <path d="M16 23 V11 M16 11 L11 16 M16 11 L21 16" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {!collapsed && (
        <div className="flex items-baseline gap-1.5">
          <span className={`${textClass} font-bold`} style={{ letterSpacing: '-0.5px', color: 'var(--text-primary)' }}>
            {m ? (
              <>
                {m[1]}
                <span style={{ color: 'var(--accent)' }}>{m[2]}</span>
              </>
            ) : (
              name
            )}
          </span>
          {showBeta && (
            <span
              className="rounded px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider"
              style={{ color: 'var(--accent)', background: 'var(--accent-subtle)', boxShadow: 'inset 0 0 0 1px var(--accent-border)' }}
            >
              Beta
            </span>
          )}
        </div>
      )}
    </div>
  )
}
