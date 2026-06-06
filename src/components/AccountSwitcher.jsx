import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ChevronsUpDown, Search, Shield, ArrowLeft, MousePointerClick } from 'lucide-react'
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
    impersonation,
    accessLevel,
    viewPractice,
    exitPractice,
    exitAgency,
  } = useAuth()
  const { isWhiteLabeled } = useBranding()
  const navigate = useNavigate()
  const location = useLocation()
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
  // While impersonating a reseller (no sub-account), show that reseller's name.
  const resellerImp = impersonation?.level === 'reseller' ? impersonation.target : null
  const currentName = practice?.name
    || resellerImp?.name
    || (isSuperAdmin ? 'Select an account' : isAgencyUser ? 'Select an account' : agency?.name || 'Select account')
  const currentSub = practice
    ? practice.agency?.name || cityState(practice) || practice.address || 'Practice'
    : resellerImp
      ? 'Reseller'
      : isSuperAdmin
        ? 'Super Admin'
        : isAgencyUser
          ? agency?.name || 'Reseller View'
          : ACCESS_LABELS[accessLevel] || ''

  // "Click here to switch" is ONLY for a super-admin / reseller in their own
  // portal with nothing impersonated. On /admin routes (and when no practice is
  // in context) the stored practice is ignored, so the super-admin's own home
  // practice never leaks onto the trigger. Once impersonating - a practice (show
  // its name) or a reseller (show the reseller name) - this is false.
  const onAdminRoute = location.pathname.startsWith('/admin')
  const idle = (isSuperAdmin || isAgencyUser) && !isImpersonating && (onAdminRoute || !practice?.name)

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
      {/* Trigger - elevated pill that adapts to the theme (light in light mode,
          dark in dark mode) via the surface scale + text tokens. */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-lg border border-surface-700 bg-surface-800 px-2.5 py-2.5 text-left transition hover:bg-surface-700"
      >
        {idle ? (
          <>
            <MousePointerClick className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--text-secondary)]">Click here to switch</span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
          </>
        ) : (
          <>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-700 text-xs font-semibold text-[var(--text-primary)]">
              {initials(currentName)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-[var(--text-primary)]">{currentName}</span>
              {currentSub && <span className="block truncate text-xs text-[var(--text-muted)]">{currentSub}</span>}
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
          </>
        )}
      </button>

      {/* Panel - theme-aware surface, floating over the sidebar. --sw-soft is the
          brand accent at low opacity, used for the active/selected row (so it
          follows a white-label brand color instead of a hardcoded blue). */}
      {open && (
        <div
          style={{ '--sw-soft': 'color-mix(in srgb, var(--accent) 15%, transparent)' }}
          className="animate-dropdown absolute left-2 z-50 mt-1 w-80 max-w-[calc(100vw-32px)] overflow-hidden rounded-xl border border-surface-700 bg-surface-900 shadow-[0_12px_32px_rgba(0,0,0,0.45)]"
        >
          <div className="p-2.5">
            {/* Back action — only while inside a specific sub-account. Returns to
                the reseller view if there's a reseller context behind the
                impersonation, otherwise to the super-admin view. */}
            {(isSuperAdmin || isAgencyUser) && isImpersonating && impersonation?.level === 'practice' && (() => {
              const toReseller = Boolean(impersonation?.reseller) || isAgencyUser
              const onBack = () => {
                setOpen(false)
                if (toReseller) { exitPractice(); navigate('/agency') }
                else { exitAgency(); navigate('/admin') }
              }
              return (
                <button
                  onClick={onBack}
                  style={{ color: 'var(--accent)' }}
                  className="mb-2 flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition hover:bg-surface-800"
                >
                  {toReseller
                    ? <ArrowLeft className="h-4 w-4 shrink-0" />
                    : <Shield className="h-4 w-4 shrink-0" />}
                  <span className="text-sm font-medium">
                    {toReseller ? 'Back to Reseller View' : 'Back to Super Admin View'}
                  </span>
                </button>
              )
            })()}

            {/* Search */}
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                style={{ color: 'var(--text-primary)' }}
                className="h-9 w-full rounded-lg border border-surface-700 bg-surface-800 pl-9 pr-3 text-sm placeholder-slate-500 transition focus:border-[var(--accent)] focus:outline-none"
              />
            </div>

            {/* Accounts / practices */}
            <p className="px-1 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {listHeader}
            </p>
            <div className="max-h-[320px] space-y-0.5 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-slate-500">No accounts found.</p>
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
              <p className="mt-2 border-t border-surface-700 px-2 pt-2 text-center text-[10px] text-slate-500">
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
      // Active row uses the brand accent at low opacity (--sw-soft, set on the
      // panel); inactive rows get a theme-aware hover.
      style={active ? { backgroundColor: 'var(--sw-soft)' } : undefined}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition ${
        active ? '' : 'hover:bg-surface-800'
      }`}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-700 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
        {firstLetter(p.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold leading-tight" style={{ color: active ? 'var(--accent)' : 'var(--text-primary)' }}>{p.name}</span>
        {sub && <span className="block truncate text-[11px] leading-tight text-slate-400">{sub}</span>}
      </span>
    </button>
  )
}
