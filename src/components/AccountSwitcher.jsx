import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronsUpDown, Search, Shield, ArrowLeft } from 'lucide-react'
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

// City/State subtitle for a practice (no full street address).
function cityState(p) {
  return [p.city, p.state].filter(Boolean).join(', ')
}

// Context switcher. Admins/resellers get a "Back to … View" action + every
// account they can access; multi-location practice users get "My Practices".
export default function AccountSwitcher() {
  const {
    accessiblePractices,
    practice,
    agency,
    isAgencyUser,
    isSuperAdmin,
    isMultiPractice,
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
      (p) => !q || p.name?.toLowerCase().includes(q) || p.address?.toLowerCase().includes(q) || cityState(p).toLowerCase().includes(q)
    )
  }, [accessiblePractices, search])

  // Current context shown on the trigger. When nothing is impersonated, fall back
  // to the role label so the pill always reads sensibly.
  const currentName = practice?.name
    || (isSuperAdmin ? 'Select an account' : isAgencyUser ? 'Select an account' : agency?.name || 'Select account')
  const currentSub = practice
    ? practice.agency?.name || cityState(practice) || practice.address || 'Practice'
    : isSuperAdmin
      ? 'Super Admin'
      : isAgencyUser
        ? agency?.name || 'Reseller View'
        : ACCESS_LABELS[accessLevel] || ''

  function pick(id) {
    viewPractice(id)
    setOpen(false)
    navigate('/')
  }

  // Show the switcher for admins, resellers, and multi-location practice users.
  if (!isSuperAdmin && !isAgencyUser && !isMultiPractice) return null

  // "My Practices" for a multi-location practice user; "All Accounts" for admins/resellers.
  const ownPractices = isMultiPractice && !isSuperAdmin && !isAgencyUser
  const listHeader = ownPractices ? 'My Practices' : 'All Accounts'
  const searchPlaceholder = isSuperAdmin
    ? 'Search for an account'
    : isAgencyUser
      ? 'Search for a sub-account'
      : 'Search your practices'

  return (
    <div className="relative px-2 pb-2" ref={ref}>
      {/* Trigger - light pill so it clearly reads as a clickable button (GHL style). */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-100 px-2.5 py-2.5 text-left transition hover:bg-slate-200"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs font-semibold text-white">
          {initials(currentName)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-slate-900">{currentName}</span>
          {currentSub && <span className="block truncate text-xs text-slate-500">{currentSub}</span>}
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-slate-400" />
      </button>

      {/* Panel - white/light, floating over the dark sidebar */}
      {open && (
        <div className="animate-dropdown absolute left-2 z-50 mt-1 w-80 max-w-[calc(100vw-32px)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_12px_32px_rgba(15,23,42,0.18)]">
          <div className="p-2.5">
            {/* Back to admin/reseller view — only while actively impersonating
                a subaccount; hidden when already in the super-admin/reseller view. */}
            {(isSuperAdmin || isAgencyUser) && isImpersonating && (
              <button
                onClick={() => { exitPractice(); setOpen(false); navigate(isSuperAdmin ? '/admin' : '/agency') }}
                className="mb-2 flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition hover:bg-slate-50"
              >
                {isSuperAdmin
                  ? <Shield className="h-4 w-4 shrink-0 text-blue-600" />
                  : <ArrowLeft className="h-4 w-4 shrink-0 text-blue-600" />}
                <span className="text-sm font-medium text-blue-600">
                  {isSuperAdmin ? 'Back to Super Admin View' : 'Back to Reseller View'}
                </span>
              </button>
            )}

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

            {/* Accounts / practices */}
            <p className="px-1 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              {listHeader}
            </p>
            <div className="max-h-[320px] space-y-0.5 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-slate-400">No accounts found.</p>
              ) : (
                filtered.map((p) => (
                  <AccountRow
                    key={p.id}
                    p={p}
                    active={practice?.id === p.id}
                    sub={ownPractices ? cityState(p) : p.address}
                    onPick={pick}
                  />
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

function AccountRow({ p, active, sub, onPick }) {
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
        {sub && <span className="block truncate text-[11px] leading-tight text-slate-500">{sub}</span>}
      </span>
    </button>
  )
}
