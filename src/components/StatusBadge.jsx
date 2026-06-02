import { statusMeta } from '../lib/consults'

export default function StatusBadge({ status, className = '' }) {
  const meta = statusMeta(status)
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${meta.classes} ${className}`}
    >
      {meta.label}
    </span>
  )
}
