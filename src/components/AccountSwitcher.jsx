import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronsUpDown, Search, RotateCcw, Shield } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useBranding } from '../context/BrandingContext'
import { ACCESS_LABELS } from '../lib/permissions'

function initials(name) {
  return (name || '?')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

// Single leading letter for the round account avatars in the list.
function firstLetter(name) {
  return (name?.trim()?.[0] || '?').toUpperCase()
}

// Unified context switcher: Super Admin → Agency → Practices.
// Clean, premium dropdown - borderless trigger, elevated panel, accent states.
export default function AccountSwitcher() {
  const {
    accessiblePractices,
    accessibleResellers,
    practice,
    agency,
    isAgencyUser,
    isSuperAdmin,
    isImpersonating,
    accessLevel,
    viewPractice,
    exitPractice,
  } = useAuth()
  const { isWhiteLabeled } = useBranding()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false)
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Reset the search box each time the panel opens.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!open) setSearch('')
  }, [open])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return accessiblePractices.filter(
      (p) => !q || p.name?.toLowerCase().includes(q) || p.address?.toLowerCase().includes(q)
    )
  }, [accessiblePractices, search])

  const filteredResellers = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (accessibleResellers || []).filter((r) => !q || r.name?.toLowerCase().includes(q))
  }, [accessibleResellers, search])

  // Current context shown on the trigger.
  const currentName = practice?.name || agency?.name || (isSuperAdmin ? 'Super Admin' : 'Select account')
  const currentSub = practice
    ? practice.agency?.name || practice.address || 'Practice'
    : agency
      ? ACCESS_LABELS[accessLevel] || 'Reseller'
      : ACCESS_LABELS[accessLevel] || ''

  function pick(id) {
    viewPractice(id)
    setOpen(false)
    navigate('/')
  }

  // Practice users have nothing to switch between - hide the switcher entirely.
  if (!isSuperAdmin && !isAgencyUser) return null

  // Super-admins search across every account; resellers across their sub-accounts.
  const searchPlaceholder = isSuperAdmin ? 'Search for an account' : 'Search for a sub-account'

  return (
    <div className="relative px-2 pb-2" ref={ref}>
      {/* Trigger - borderless, subtle hover */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition hover:bg-surface-800"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-700 text-xs font-semibold text-slate-300">
          {initials(currentName)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-slate-100">{currentName}</span>
          {currentSub && <span className="block truncate text-xs text-slate-500">{currentSub}</span>}
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-slate-500" />
      </button>

      {/* Panel - white/light, floating over the dark sidebar */}
      {open && (
        <div
          className="animate-dropdown absolute left-2 z-50 mt-1 w-80 max-w-[calc(100vw-32px)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_12px_32px_rgba(15,23,42,0.18)]"
        >
          <div className="p-2.5">
            {/* Search */}
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder-slate-400 transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            {/* Super-admin: current context (not clickable). Reseller: switch action. */}
            {isSuperAdmin ? (
              <div className="mt-2 flex items-center gap-2.5 rounded-lg bg-slate-50 px-2 py-2">
                <Shield className="h-4 w-4 shrink-0 text-slate-500" />
                <span className="text-sm font-medium text-slate-700">Super Admin View</span>
                {!isImpersonating && (
                  <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Current
                  </span>
                )}
              </div>
            ) : (
              <button
                onClick={() => { exitPractice(); setOpen(false); navigate('/agency') }}
                className="mt-2 flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition hover:bg-slate-50"
              >
                <RotateCcw className="h-4 w-4 shrink-0 text-blue-600" />
                <span className="text-sm font-medium text-blue-600">Switch to Reseller View</span>
              </button>
            )}

            {/* RESELLERS (super-admin only) - jump to a reseller's admin view. */}
            {isSuperAdmin && filteredResellers.length > 0 && (
              <>
                <p className="px-1 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Resellers
                </p>
                <div className="max-h-[150px] space-y-0.5 overflow-y-auto">
                  {filteredResellers.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => { setOpen(false); navigate(`/admin/agencies/${r.id}`) }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-slate-50"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-600">
                        {firstLetter(r.name)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-900">{r.name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* ALL ACCOUNTS */}
            <p className="px-1 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              All Accounts
            </p>

            {/* Accounts list - compact rows with a little breathing room. */}
            <div className="max-h-[300px] space-y-0.5 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-slate-400">No accounts found.</p>
              ) : (
                filtered.map((p) => (
                  <AccountRow key={p.id} p={p} active={practice?.id === p.id} onPick={pick} />
                ))
              )}
            </div>

            {isWhiteLabeled && (
              <p className="mt-2 border-t border-slate-100 px-2 pt-2 text-center text-[10px] text-slate-400">
                Powered by CaseLift
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function AccountRow({ p, active, onPick }) {
  return (
    <button
      onClick={() => onPick(p.id)}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition ${
        active ? 'bg-blue-50' : 'hover:bg-slate-50'
      }`}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">
        {firstLetter(p.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold leading-tight text-slate-900">{p.name}</span>
        {p.address && <span className="block truncate text-[11px] leading-tight text-slate-500">{p.address}</span>}
      </span>
    </button>
  )
}
