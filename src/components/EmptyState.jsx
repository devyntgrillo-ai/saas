import { Link } from 'react-router-dom'

// Reusable, on-brand empty state. Pass an icon, title, description, and either a
// router link action (to + actionLabel) or an onAction callback.
export default function EmptyState({
  icon: Icon,
  title,
  description,
  to,
  actionLabel,
  onAction,
  actionIcon: ActionIcon,
  children,
  className = '',
}) {
  const action = actionLabel && (to ? (
    <Link to={to} className="btn-primary mt-5">
      {ActionIcon && <ActionIcon className="h-4 w-4" />}
      {actionLabel}
    </Link>
  ) : (
    <button onClick={onAction} className="btn-primary mt-5">
      {ActionIcon && <ActionIcon className="h-4 w-4" />}
      {actionLabel}
    </button>
  ))

  return (
    <div className={`card flex flex-col items-center justify-center px-6 py-16 text-center ${className}`}>
      {Icon && (
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-800 text-slate-500">
          <Icon className="h-7 w-7" />
        </div>
      )}
      <p className="mt-4 text-sm font-semibold text-slate-200">{title}</p>
      {description && (
        <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-slate-500">{description}</p>
      )}
      {action}
      {children}
    </div>
  )
}
