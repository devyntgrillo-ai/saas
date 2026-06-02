import { Activity } from 'lucide-react'
import { useBranding } from '../context/BrandingContext'

export default function Logo({ collapsed = false }) {
  const { brandName, logoUrl, isWhiteLabeled } = useBranding()

  if (isWhiteLabeled && logoUrl) {
    return <img src={logoUrl} alt={brandName} className="h-8 max-w-[170px] object-contain" />
  }

  // Accent a trailing "AI" if present (Hope AI, …); otherwise render plain.
  const name = brandName || 'Hope AI'
  const m = name.match(/^(.*?)(AI)$/)
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary shadow-glow">
        <Activity className="h-5 w-5 text-white" strokeWidth={2.5} />
      </div>
      {!collapsed && (
        <div className="flex items-baseline gap-1.5">
          <span className="text-lg font-bold tracking-tight text-white">
            {m ? (
              <>
                {m[1]}
                <span className="text-primary-400">{m[2]}</span>
              </>
            ) : (
              name
            )}
          </span>
          <span className="rounded px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-primary-400 ring-1 ring-primary-400/40 bg-primary-400/10">
            Beta
          </span>
        </div>
      )}
    </div>
  )
}
