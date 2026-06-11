import { NavLink } from 'react-router-dom'

// Segmented toggle that merges the Resellers and Commissions views under a
// single sidebar tab. Each segment is a route link so deep-linking and the
// browser back button keep working; the sidebar "Resellers" entry stays
// highlighted across both paths (see AdminShell TABS match).
const VIEWS = [
  { to: '/admin/agencies', label: 'Resellers' },
  { to: '/admin/commissions', label: 'Commissions' },
]

export default function ResellerTabs() {
  return (
    <div className="inline-flex rounded-lg border border-surface-700 bg-surface-800/50 p-0.5">
      {VIEWS.map((v) => (
        <NavLink
          key={v.to}
          to={v.to}
          end
          className={({ isActive }) =>
            [
              'rounded-md px-3.5 py-1.5 text-sm font-semibold transition',
              isActive
                ? 'bg-primary/15 text-primary-300'
                : 'text-slate-400 hover:text-slate-200',
            ].join(' ')
          }
        >
          {v.label}
        </NavLink>
      ))}
    </div>
  )
}
