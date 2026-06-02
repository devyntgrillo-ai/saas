import { formatMoney } from '../../lib/analytics'

export const money = (n) => formatMoney(Number(n) || 0)

export function initials(name) {
  return (name || '?')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

export function Avatar({ name, color }) {
  return (
    <span
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold text-white"
      style={{ background: color || '#2e3342' }}
    >
      {initials(name)}
    </span>
  )
}

// Big number stat card. `accent` tints the value; `delta` shows a small sub.
export function StatCard({ label, value, icon: Icon, accent, sub }) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">{label}</p>
        {Icon && <Icon className="h-4 w-4 text-slate-500" />}
      </div>
      <p className={`mt-2 text-2xl font-bold ${accent || 'text-white'}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  )
}

export function Badge({ children, className = 'bg-surface-700 text-slate-300' }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>{children}</span>
}

export function Section({ title, action, children }) {
  return (
    <section className="space-y-3">
      {(title || action) && (
        <div className="flex items-center justify-between">
          {title && <h2 className="text-sm font-semibold text-white">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

// Generic table. `head` is an array of column labels (or {label,onSort,active}).
// `rows` is an array of arrays of cells. `onRowClick(i)` optional.
export function Table({ head, rows, empty = 'Nothing here yet.', icon: Icon, onRowClick }) {
  if (!rows.length) {
    return (
      <div className="card px-6 py-16 text-center">
        {Icon && <Icon className="mx-auto h-9 w-9 text-slate-600" />}
        <p className="mt-3 text-sm text-slate-400">{empty}</p>
      </div>
    )
  }
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-surface-700 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {head.map((h, i) => {
                const label = typeof h === 'string' ? h : h.label
                const sortable = typeof h === 'object' && h.onSort
                return (
                  <th
                    key={i}
                    className={`px-5 py-3 ${sortable ? 'cursor-pointer select-none hover:text-slate-300' : ''}`}
                    onClick={sortable ? h.onSort : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {label}
                      {sortable && h.active && <span className="text-primary-300">{h.dir === 'asc' ? '↑' : '↓'}</span>}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-700">
            {rows.map((cells, r) => (
              <tr
                key={r}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={`text-slate-300 ${onRowClick ? 'cursor-pointer transition hover:bg-surface-800' : ''}`}
              >
                {cells.map((c, i) => (
                  <td key={i} className="px-5 py-3.5 align-middle">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Stop row-click propagation for inline action buttons.
export function stop(e) {
  e.stopPropagation()
}
