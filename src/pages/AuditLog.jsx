import { useMemo, useState } from 'react'
import { ShieldCheck, Filter, ScrollText, Lock } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { formatDateTime } from '../lib/consults'
import { useAuditLog } from '../lib/queries'
import { SkeletonTable } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import ErrorState, { friendlyError } from '../components/ErrorState'

// Human labels for the canonical action names recorded by lib/audit.js.
const ACTION_LABELS = {
  'consult.viewed': 'Viewed consult',
  'patient.accessed': 'Accessed patient record',
  'message.sent': 'Sent patient message',
  'conversation.viewed': 'Viewed conversation',
  'consult.analyzed': 'Analyzed consult',
}

// Solid badge fills (not translucent /10) so they read clearly in both light and
// light mode - dark text on a light tint passes contrast either way. Anything
// unmapped falls back to gray below.
const ACTION_CLASSES = {
  'consult.viewed': 'bg-purple-100 text-purple-800',
  'conversation.viewed': 'bg-blue-100 text-blue-800',
  'patient.accessed': 'bg-orange-100 text-orange-800',
  'consult.analyzed': 'bg-green-100 text-green-800',
}
const ACTION_CLASS_DEFAULT = 'bg-gray-100 text-gray-700'

const RANGES = [
  { key: '7d', label: 'Last 7 days', days: 7 },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '90d', label: 'Last 90 days', days: 90 },
  { key: 'all', label: 'All time', days: null },
]

export default function AuditLog() {
  const { profile } = useAuth()
  const { isLight } = useTheme()
  const isAdmin = ['owner', 'admin'].includes(profile?.role)

  const [actionFilter, setActionFilter] = useState('all')
  const [range, setRange] = useState('30d')

  const { data: rows = [], isLoading: loading, error: queryError } = useAuditLog(range, isAdmin)
  const error = queryError ? friendlyError(queryError) : null

  const visible = useMemo(
    () => rows.filter((r) => actionFilter === 'all' || r.action === actionFilter),
    [rows, actionFilter]
  )

  if (!isAdmin) {
    return (
      <EmptyState
        icon={Lock}
        title="Admins only"
        description="The audit log is restricted to practice owners and admins."
      />
    )
  }

  return (
    <div className="space-y-4">
      <div
        className={`card flex items-start gap-2.5 p-4 ${
          isLight ? 'border border-green-200 bg-green-50' : 'border-emerald-500/30 bg-emerald-500/[0.06]'
        }`}
      >
        <ShieldCheck className={`mt-0.5 h-4 w-4 shrink-0 ${isLight ? 'text-green-700' : 'text-emerald-400'}`} />
        <p className={`text-xs leading-relaxed ${isLight ? 'text-green-800' : 'text-emerald-200/90'}`}>
          HIPAA access trail - every read or transmission of patient data is recorded server-side and
          cannot be edited or deleted from here.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 rounded-xl border border-surface-700 bg-surface-900 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <Filter className="h-3.5 w-3.5" /> Filters
          </span>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">Action</span>
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-sm text-slate-100 focus:border-primary focus:outline-none"
            >
              <option value="all">All actions</option>
              {Object.entries(ACTION_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">Range</span>
            <select
              value={range}
              onChange={(e) => setRange(e.target.value)}
              className="rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-sm text-slate-100 focus:border-primary focus:outline-none"
            >
              {RANGES.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <span className="text-xs text-slate-500">{visible.length} events</span>
      </div>

      {loading ? (
        <SkeletonTable rows={8} cols={4} />
      ) : error ? (
        <ErrorState message={friendlyError(error)} onRetry={load} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="No audit events"
          description="Patient-data access events will be recorded here as your team uses CaseLift."
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left">
              <thead>
                <tr className="border-b border-surface-700 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3">Timestamp</th>
                  <th className="px-5 py-3">User</th>
                  <th className="px-5 py-3">Action</th>
                  <th className="px-5 py-3">Resource</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isLight ? 'divide-gray-100' : 'divide-surface-700'}`}>
                {visible.map((r) => (
                  <tr key={r.id} className="text-sm transition hover:bg-surface-800">
                    <td className="whitespace-nowrap px-5 py-3.5 text-slate-200">
                      {formatDateTime(r.created_at)}
                    </td>
                    <td className={`px-5 py-3.5 ${r.user_email ? 'text-slate-200' : 'text-slate-500'}`}>
                      {r.user_email || '-'}
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          ACTION_CLASSES[r.action] || ACTION_CLASS_DEFAULT
                        }`}
                      >
                        {ACTION_LABELS[r.action] || r.action}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 capitalize text-slate-200">{r.resource_type || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
