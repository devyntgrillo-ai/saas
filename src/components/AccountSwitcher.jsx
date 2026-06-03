import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronsUpDown, Search, Shield, Building2, Check } from 'lucide-react'
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

// Unified context switcher: Super Admin → Agency → Practices.
// Clean, premium dropdown - borderless trigger, elevated panel, accent states.
export default function AccountSwitcher() {
  const {
    accessiblePractices,
    practice,
    agency,
    isAgencyUser,
    isSuperAdmin,
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

      {/* Panel */}
      {open && (
        <div
          className="animate-dropdown absolute left-2 z-50 mt-1 w-80 max-w-[calc(100vw-32px)] rounded-lg border border-white/[0.07] bg-surface-800 p-2 shadow-[0_8px_24px_rgba(0,0,0,0.4)]"
        >
          {/* YOUR VIEWS */}
          {(isSuperAdmin || isAgencyUser) && (
            <>
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Your views
              </p>
              {isSuperAdmin && (
                <button
                  onClick={() => { exitPractice(); setOpen(false); navigate('/admin') }}
                  className="flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-sm text-slate-200 transition hover:bg-surface-700"
                >
                  <Shield className="h-4 w-4 shrink-0 text-slate-400" /> Super Admin
                  <span className="ml-auto rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-rose-400">ADMIN</span>
                </button>
              )}
              {isAgencyUser && (
                <button
                  onClick={() => { exitPractice(); setOpen(false); navigate('/agency') }}
                  className="flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-sm text-slate-200 transition hover:bg-surface-700"
                >
                  <Building2 className="h-4 w-4 shrink-0 text-slate-400" /> <span className="truncate">{agency?.name || 'Reseller'}</span>
                  <span className="ml-auto shrink-0 rounded bg-[var(--accent-subtle)] px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-[var(--accent)]">RESELLER</span>
                </button>
              )}
              <div className="my-2 border-t border-white/[0.07]" />
            </>
          )}

          {/* CLIENT PRACTICES */}
          <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            {isSuperAdmin || isAgencyUser ? 'Client practices' : 'Your practice'}
          </p>

          {(isSuperAdmin || isAgencyUser) && (
            <div className="relative mb-1 mt-0.5">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search practices..."
                className="h-7 w-full rounded-md border-0 bg-surface-700 pl-8 pr-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </div>
          )}

          {/* Up to 6 rows visible, scroll beyond. */}
          <div className="max-h-[216px] space-y-0.5 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-2 py-5 text-center text-xs text-slate-500">No practices found.</p>
            ) : (
              filtered.map((p) => (
                <AccountRow key={p.id} p={p} active={practice?.id === p.id} onPick={pick} />
              ))
            )}
          </div>

          {isWhiteLabeled && (
            <p className="mt-2 border-t border-white/[0.07] px-2 pt-2 text-center text-[10px] text-slate-600">
              Powered by CaseLift
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function AccountRow({ p, active, onPick }) {
  return (
    <button
      onClick={() => onPick(p.id)}
      className={`flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left transition ${
        active ? 'border-l-2 border-primary bg-primary/10' : 'hover:bg-surface-700'
      }`}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-700 text-[10px] font-semibold text-slate-300">
        {initials(p.name)}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-slate-100">{p.name}</span>
      {active && <Check className="h-3.5 w-3.5 shrink-0 text-primary-300" />}
    </button>
  )
}
