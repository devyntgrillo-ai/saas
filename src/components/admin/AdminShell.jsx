import { Suspense, useState } from 'react'
import { Link, NavLink, Outlet, Navigate, useLocation } from 'react-router-dom'
import { LogOut, ChevronRight, Loader2, Menu, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import Logo from '../Logo'
import PageLoader from '../PageLoader'
import { useAuth } from '../../context/AuthContext'
import { AdminProvider, useAdmin } from '../../context/AdminContext'

const TABS = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/admin/agencies', label: 'Resellers' },
  { to: '/admin/practices', label: 'Subaccounts' },
  { to: '/admin/revenue', label: 'Revenue' },
  { to: '/admin/billing', label: 'Billing' },
  { to: '/admin/training', label: 'Training' },
  { to: '/admin/wins', label: 'Wins' },
  { to: '/admin/referrals', label: 'Referrals' },
]

// Breadcrumb segments are derived from the path; detail pages can override the
// last crumb label via the `crumbs` context value if needed. For simplicity we
// label by route here.
function Breadcrumbs() {
  const { pathname } = useLocation()
  const parts = pathname.split('/').filter(Boolean) // ['admin', 'agencies', ':id']
  if (parts.length <= 2) return null // only show when drilled in
  const map = { admin: 'Admin', agencies: 'Resellers', practices: 'Subaccounts', revenue: 'Revenue', settings: 'Settings' }
  const trail = []
  trail.push({ label: 'Admin', to: '/admin' })
  if (parts[1]) trail.push({ label: map[parts[1]] || parts[1], to: `/admin/${parts[1]}` })
  if (parts[2]) trail.push({ label: 'Detail', to: pathname })
  return (
    <div className="mx-auto flex max-w-[1400px] items-center gap-1.5 px-4 pt-4 text-xs text-slate-500 sm:px-6">
      {trail.map((c, i) => (
        <span key={c.to} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight className="h-3 w-3" />}
          {i < trail.length - 1 ? (
            <Link to={c.to} className="transition hover:text-slate-300">
              {c.label}
            </Link>
          ) : (
            <span className="text-slate-300">{c.label}</span>
          )}
        </span>
      ))}
    </div>
  )
}

// Sidebar nav link styling - matches the practice/subaccount sidebar
// (active = brand accent + left border).
const navItemClass = ({ isActive }) =>
  [
    'flex h-9 items-center gap-2.5 rounded-lg border-l-2 px-3 text-sm transition',
    isActive
      ? 'border-primary bg-primary/10 font-medium text-primary-300'
      : 'border-transparent text-slate-400 hover:bg-surface-800 hover:text-slate-200',
  ].join(' ')

function Chrome() {
  const { signOut } = useAuth()
  const { loading } = useAdmin()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const SidebarContent = () => (
    <>
      <div className="flex items-center gap-2 px-4 pb-5 pt-7">
        <Logo showBeta={false} />
        <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-semibold text-rose-300">ADMIN</span>
      </div>

      <nav className="flex-1 space-y-0.5 px-3">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            onClick={() => setMobileOpen(false)}
            className={navItemClass}
          >
            {t.label}
          </NavLink>
        ))}
      </nav>

      <div className="space-y-1 border-t border-white/[0.07] p-3">
        <button
          onClick={handleSignOut}
          className="flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-sm text-slate-400 transition hover:bg-surface-800 hover:text-slate-200"
        >
          <LogOut className="h-4 w-4 shrink-0" /> Sign out
        </button>
      </div>
    </>
  )

  return (
    <div className="app-shell flex h-screen overflow-hidden bg-surface">
      {/* Desktop sidebar */}
      <aside className="hidden w-[220px] shrink-0 flex-col border-r border-white/[0.07] bg-surface-900 lg:flex">
        <SidebarContent />
      </aside>

      {/* Mobile sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="safe-top absolute left-0 top-0 flex h-full w-64 flex-col border-r border-surface-700 bg-surface-900">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-4 rounded-md p-1.5 text-slate-400 hover:bg-surface-700 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-white/[0.07] bg-surface-900 px-4 py-3 sm:px-6">
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-md p-2 text-slate-300 hover:bg-surface-800 lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2 lg:hidden">
            <Logo showBeta={false} />
            <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-semibold text-rose-300">ADMIN</span>
          </div>
          <span className="ml-auto hidden text-sm font-semibold text-slate-300 lg:block">CaseLift Admin</span>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <Breadcrumbs />
          <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:py-8">
            {loading ? (
              <div className="flex justify-center py-24">
                <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
              </div>
            ) : (
              <Suspense fallback={<PageLoader />}>
                <Outlet />
              </Suspense>
            )}
          </div>
          <footer className="border-t border-white/[0.07] px-4 py-5 text-center text-xs text-slate-500">CaseLift Platform · caselift.io</footer>
        </main>
      </div>
    </div>
  )
}

export default function AdminShell() {
  const { isSuperAdmin, contextLoading } = useAuth()
  if (contextLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
      </div>
    )
  }
  if (!isSuperAdmin) return <Navigate to="/" replace />
  return (
    <AdminProvider>
      <Chrome />
    </AdminProvider>
  )
}
