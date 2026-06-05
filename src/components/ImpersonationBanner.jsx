import { useNavigate } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

// Persistent impersonation bar pinned to the very top of the app shell. Colors
// signal the level: amber for reseller-level ("viewing as a reseller"), blue for
// a specific account. Returns null when not impersonating, so it takes no space.
export default function ImpersonationBanner() {
  const { impersonation, isSuperAdmin, activePractice, exitPractice, exitAgency } = useAuth()
  const navigate = useNavigate()

  if (!impersonation?.active) return null

  const { level, target, reseller } = impersonation
  const archived = Boolean(activePractice?.archived_at)

  // Clear ALL impersonation (reseller + any sub-account) → super admin home.
  const exitToSuperAdmin = () => { exitAgency(); navigate('/admin') }
  // Drop just the sub-account, back to the reseller view (or the viewer's own).
  const backToReseller = () => { exitPractice(); navigate('/agency') }

  // ---- Reseller level (amber) -------------------------------------------------
  if (level === 'reseller') {
    return (
      <div className="flex items-center justify-between gap-3 bg-amber-500 px-4 py-2 text-sm text-amber-950">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">
            👁 Impersonating <span className="font-semibold">{target?.name}</span> — you are viewing as this reseller
          </span>
        </span>
        <button
          onClick={exitToSuperAdmin}
          className="shrink-0 font-semibold underline-offset-2 transition hover:underline"
        >
          Exit to Super Admin
        </button>
      </div>
    )
  }

  // ---- Archived account warning (amber) --------------------------------------
  if (archived) {
    return (
      <div className="flex items-center justify-between gap-3 bg-amber-500 px-4 py-2 text-sm text-amber-950">
        <span className="flex min-w-0 items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="truncate font-medium">
            ⚠️ This account is archived — you are viewing as {isSuperAdmin ? 'Super Admin' : 'an administrator'}
          </span>
        </span>
        <button
          onClick={isSuperAdmin ? exitToSuperAdmin : backToReseller}
          className="shrink-0 font-semibold underline-offset-2 transition hover:underline"
        >
          {isSuperAdmin ? 'Exit to Super Admin' : 'Switch to my account'}
        </button>
      </div>
    )
  }

  // ---- Practice within a reseller impersonation (blue, two exits) ------------
  if (reseller && isSuperAdmin) {
    return (
      <div className="flex items-center justify-between gap-3 bg-sky-500 px-4 py-2 text-sm text-white">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">
            👁 Impersonating <span className="font-semibold">{target?.name}</span> via{' '}
            <span className="font-semibold">{reseller.name}</span>
          </span>
        </span>
        <div className="flex shrink-0 items-center gap-4">
          <button onClick={backToReseller} className="font-semibold underline-offset-2 transition hover:underline">
            Back to {reseller.name}
          </button>
          <button onClick={exitToSuperAdmin} className="font-semibold underline-offset-2 transition hover:underline">
            Exit to Super Admin
          </button>
        </div>
      </div>
    )
  }

  // ---- Plain practice impersonation (blue) -----------------------------------
  return (
    <div className="flex items-center justify-between gap-3 bg-blue-100 px-4 py-2 text-sm text-blue-900">
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate">
          👁 Logged in as <span className="font-semibold">{target?.name}</span>
          {target?.email && <span className="text-blue-700"> ({target.email})</span>}
        </span>
      </span>
      <button
        onClick={isSuperAdmin ? exitToSuperAdmin : backToReseller}
        className="shrink-0 font-semibold text-blue-700 underline-offset-2 transition hover:text-blue-900 hover:underline"
      >
        Switch to my account
      </button>
    </div>
  )
}
