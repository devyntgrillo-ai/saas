// Loading skeletons - used everywhere instead of blank flashes while data loads.
// All pieces use the same shimmer so the app never shows an empty white screen.

export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded-md bg-surface-700/60 ${className}`} />
}

// A stat card placeholder matching <StatCard />.
export function SkeletonStatCard() {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-9 w-9 rounded-lg" />
      </div>
      <Skeleton className="mt-4 h-8 w-20" />
    </div>
  )
}

// A row of stat-card skeletons.
export function SkeletonStatGrid({ count = 4 }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonStatCard key={i} />
      ))}
    </div>
  )
}

// Table-row placeholders inside a card.
export function SkeletonTable({ rows = 6, cols = 5 }) {
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-surface-700 px-5 py-3">
        <Skeleton className="h-3 w-24" />
      </div>
      <div className="divide-y divide-surface-700">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 px-5 py-4">
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton key={c} className={`h-4 ${c === 0 ? 'w-32' : 'flex-1'}`} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// List-item placeholders (inbox / conversation list).
export function SkeletonList({ rows = 6 }) {
  return (
    <div className="divide-y divide-surface-700">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

// Generic card-block placeholders.
export function SkeletonCards({ count = 4, className = '' }) {
  return (
    <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card space-y-3 p-5">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  )
}
