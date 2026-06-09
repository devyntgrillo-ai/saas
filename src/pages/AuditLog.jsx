import { useMemo, useState } from 'react'
import { ShieldCheck, Filter, ScrollText, Lock, ShieldAlert } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { formatDateTime } from '../lib/consults'
import { useAuditLog } from '../lib/queries'
import { SkeletonTable } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import ErrorState, { friendlyError } from '../components/ErrorState'
import BreachInvestigation from '../components/BreachInvestigation'

// Human labels for the canonical action names recorded by lib/audit.js +
// _shared/audit.ts. Grouped for the filter dropdown.
const ACTION_GROUPS = [
  {
    label: 'PHI access',
    actions: {
      'consult.viewed': 'Viewed consult',
      'transcript.viewed': 'Viewed transcript',
      'patient.accessed': 'Accessed patient record',
      'conversation.viewed': 'Viewed conversation',
      'conversation.messages_viewed': 'Viewed messages',
      'recording.accessed': 'Accessed recording',
      'file.downloaded': 'Downloaded file',
      'impersonation.started': 'Started impersonation',
    },
  },
  {
    label: 'Auth',
    actions: {
      'auth.login_success': 'Login',
      'auth.login_failure': 'Login failed',
      'auth.logout': 'Logout',
      'auth.password_reset_requested': 'Password reset requested',
      'auth.password_changed': 'Password changed',
      'auth.mfa_enrolled': 'MFA enrolled',
      'auth.mfa_challenge': 'MFA challenge',
    },
  },
  {
    label: 'Admin',
    actions: {
      'impersonation.ended': 'Ended impersonation',
      'practice.created': 'Practice created',
      'practice.archived': 'Practice archived',
      'user.invited': 'User invited',
      'user.role_changed': 'User role changed',
      'billing.action': 'Billing action',
      'baa.accepted': 'BAA accepted',
    },
  },
  {
    label: 'Data',
    actions: {
      'consult.created': 'Consult created',
      'consult.deleted': 'Consult deleted',
      'sequence.started': 'Sequence started',
      'sequence.stopped': 'Sequence stopped',
      'message.sent': 'Message sent',
    },
  },
]

// Flat lookup of action → label.
const ACTION_LABELS = Object.assign({}, ...ACTION_GROUPS.map((g) => g.actions))

// Solid badge fills so they read in both themes; unmapped falls back to gray.
const ACTION_CLASSES = {
  'consult.viewed': 'bg-purple-100 text-purple-800',
  'transcript.viewed': 'bg-purple-100 text-purple-800',
  'conversation.viewed': 'bg-blue-100 text-blue-800',
  'conversation.messages_viewed': 'bg-blue-100 text-blue-800',
  'patient.accessed': 'bg-orange-100 text-orange-800',
  'recording.accessed': 'bg-orange-100 text-orange-800',
  'file.downloaded': 'bg-orange-100 text-orange-800',
  'impersonation.started': 'bg-rose-100 text-rose-800',
  'impersonation.ended': 'bg-gray-100 text-gray-700',
  'auth.login_success': 'bg-green-100 text-green-800',
  'auth.login_failure': 'bg-rose-100 text-rose-800',
  'auth.logout': 'bg-gray-100 text-gray-700',
  'auth.password_changed': 'bg-amber-100 text-amber-800',
  'practice.created': 'bg-green-100 text-green-800',
  'practice.archived': 'bg-amber-100 text-amber-800',
  'user.invited': 'bg-blue-100 text-blue-800',
  'user.role_changed': 'bg-amber-100 text-amber-800',
  'billing.action': 'bg-blue-100 text-blue-800',
  'baa.accepted': 'bg-green-100 text-green-800',
  'consult.created': 'bg-green-100 text-green-800',
  'consult.deleted': 'bg-rose-100 text-rose-800',
  'sequence.started': 'bg-green-100 text-green-800',
  'sequence.stopped': 'bg-amber-100 text-amber-800',
  'message.sent': 'bg-blue-100 text-blue-800',
}
const ACTION_CLASS_DEFAULT = 'bg-gray-100 text-gray-700'

const RANGES = [
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: 'all', label: 'All time' },
]

export default function AuditLog() {
  const { profile, isSuperAdmin } = useAuth()
  const { isLight } = useTheme()
  // Practice owners/admins see their own practice; super-admin sees everything
  // (RLS enforces the scope server-side regardless).
  const canView = isSuperAdmin || ['owner', 'admin'].includes(profile?.role)

  const [range, setRange] = useState('30d')
  const [actionFilter, setActionFilter] = useState('all')
  const [userFilter, setUserFilter] = useState('all')
  const [practiceFilter, setPracticeFilter] = useState('all')
  const [phiOnly, setPhiOnly] = useState(false)

  const { data: rows = [], isLoading: loading, error: queryError, refetch } = useAuditLog(range, canView)
  const error = queryError ? friendlyError(queryError) : null

  // Filter-dropdown options derived from the loaded range (stable across selections).
  const userOptions = useMemo(
    () => [...new Set(rows.map((r) => r.user_email).filter(Boolean))].sort(),
    [rows],
  )
  const practiceOptions = useMemo(() => {
    const map = new Map()
    for (const r of rows) {
      if (r.practice_id && !map.has(r.practice_id)) {
        map.set(r.practice_id, r.practice_name || r.practice_id)
      }
    }
    return [...map.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])))
  }, [rows])

  const visible = useMemo(
    () =>
      rows.filter(
        (r) =>
          (actionFilter === 'all' || r.action === actionFilter) &&
          (userFilter === 'all' || r.user_email === userFilter) &&
          (practiceFilter === 'all' || r.practice_id === practiceFilter) &&
          (!phiOnly || r.phi_accessed),
      ),
    [rows, actionFilter, userFilter, practiceFilter, phiOnly],
  )

  const phiCount = useMemo(() => visible.filter((r) => r.phi_accessed).length, [visible])

  if (!canView) {
    return (
      <EmptyState
        icon={Lock}
        title="Admins only"
        description="The audit log is restricted to practice owners and admins."
      />
    )
  }

  const selectCls =
    'rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-sm text-slate-100 focus:border-primary focus:outline-none'

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
          {isSuperAdmin && ' You are viewing activity across all practices.'}
        </p>
      </div>

      {/* Platform-admin only: breach-window PHI access investigation + CSV export. */}
      {isSuperAdmin && <BreachInvestigation />}

      {/* Filters */}
      <div className="flex flex-col gap-3 rounded-xl border border-surface-700 bg-surface-900 px-4 py-3">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <Filter className="h-3.5 w-3.5" /> Filters
          </span>

          <label className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">Range</span>
            <select value={range} onChange={(e) => setRange(e.target.value)} className={selectCls}>
              {RANGES.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">Action</span>
            <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className={selectCls}>
              <option value="all">All actions</option>
              {ACTION_GROUPS.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {Object.entries(g.actions).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">User</span>
            <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)} className={selectCls}>
              <option value="all">All users</option>
              {userOptions.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>

          {isSuperAdmin && (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-slate-500">Practice</span>
              <select
                value={practiceFilter}
                onChange={(e) => setPracticeFilter(e.target.value)}
                className={selectCls}
              >
                <option value="all">All practices</option>
                {practiceOptions.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <button
            type="button"
            onClick={() => setPhiOnly((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
              phiOnly
                ? 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30'
                : 'bg-surface-800 text-slate-400 ring-1 ring-surface-700 hover:text-slate-200'
            }`}
          >
            <ShieldAlert className="h-3.5 w-3.5" /> PHI access only
          </button>
        </div>

        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>
            {visible.length} event{visible.length === 1 ? '' : 's'}
            {phiCount > 0 && <span className="ml-1 text-rose-300">· {phiCount} PHI</span>}
          </span>
        </div>
      </div>

      {loading ? (
        <SkeletonTable rows={8} cols={isSuperAdmin ? 6 : 5} />
      ) : error ? (
        <ErrorState message={friendlyError(error)} onRetry={refetch} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="No audit events"
          description="Access and activity events will be recorded here as your team uses CaseLift."
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr className="border-b border-surface-700 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3">Timestamp</th>
                  <th className="px-5 py-3">User</th>
                  {isSuperAdmin && <th className="px-5 py-3">Practice</th>}
                  <th className="px-5 py-3">Action</th>
                  <th className="px-5 py-3">Resource</th>
                  <th className="px-5 py-3">IP</th>
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
                    {isSuperAdmin && (
                      <td className="px-5 py-3.5 text-slate-300">{r.practice_name || r.practice_id || '-'}</td>
                    )}
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            ACTION_CLASSES[r.action] || ACTION_CLASS_DEFAULT
                          }`}
                        >
                          {ACTION_LABELS[r.action] || r.action}
                        </span>
                        {r.phi_accessed && (
                          <span
                            title="PHI accessed"
                            className="inline-flex items-center gap-0.5 rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300"
                          >
                            <ShieldAlert className="h-3 w-3" /> PHI
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-300">
                      <span className="capitalize">{r.resource_type || '-'}</span>
                      {r.resource_id && (
                        <span className="ml-1 text-xs text-slate-500" title={r.resource_id}>
                          {String(r.resource_id).slice(0, 8)}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3.5 text-xs text-slate-500">
                      {r.ip_address || '-'}
                    </td>
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
