import { Loader2 } from 'lucide-react'

// Suspense fallback for lazily-loaded routes/components. Centered, theme-aware
// spinner that fills its container without collapsing the surrounding layout.
export default function PageLoader({ className = '' }) {
  return (
    <div className={`flex min-h-[40vh] w-full flex-col items-center justify-center gap-3 ${className}`}>
      <Loader2 className="h-6 w-6 animate-spin text-primary-400" />
      <p className="text-sm text-slate-400">Hope is thinking…</p>
    </div>
  )
}
