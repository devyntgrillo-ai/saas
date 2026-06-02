import { objectionMeta, exitIntentMeta } from '../lib/consults'

const base =
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset'

export function ObjectionBadge({ type, className = '' }) {
  if (!type) {
    return <span className="text-xs text-slate-600">-</span>
  }
  const meta = objectionMeta(type)
  return <span className={`${base} ${meta.classes} ${className}`}>{meta.label}</span>
}

export function ExitIntentBadge({ level, className = '' }) {
  if (!level) {
    return <span className="text-xs text-slate-600">-</span>
  }
  const meta = exitIntentMeta(level)
  return (
    <span className={`${base} ${meta.classes} ${className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  )
}
