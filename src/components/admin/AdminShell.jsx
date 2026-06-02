import { Suspense } from 'react'
import { Link, NavLink, Outlet, Navigate, useLocation } from 'react-router-dom'
import { ArrowLeft, LogOut, ChevronRight, Loader2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import Logo from '../Logo'
import PageLoader from '../PageLoader'
import { useAuth } from '../../context/AuthContext'
import { AdminProvider, useAdmin } from '../../context/AdminContext'

const TABS = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/admin/agencies', label: 'Resellers' },
  { to: '/admin/resellers', label: 'SaaS' },
  { to: '/admin/practices', label: 'Practices' },
  { to: '/admin/revenue', label: 'Revenue' },
  { to: '/admin/billing', label: 'Billing' },
  { to: '/admin/referrals', label: 'Referrals' },
]

// Breadcrumb segments are derived from the path; detail pages can override the
// last crumb label via the `crumbs` context value if needed. For simplicity we
// label by route here.
function Breadcrumbs() {
  const { pathname } = useLocation()
  const parts = pathname.split('/').filter(Boolean) // ['admin', 'agencies', ':id']
  if (parts.length <= 2) return null // only show when drilled in
  const map = { admin: 'Admin', agencies: 'Resellers', practices: 'Practices', revenue: 'Revenue', settings: 'Settings' }
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

function Chrome() {
  const { signOut } = useAuth()
  const { loading } = useAdmin()
  const navigate = useNavigate()
  return (
    <div className="app-shell min-h-screen bg-surface">
      <header className="border-b border-white/[0.07] bg-surface-900">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Logo />
            <span className="text-sm font-semibold text-slate-200">Hope AI · Admin</span>
            <span className="rounded-full bg-rose-500/15 px-2.5 py-0.5 text-xs font-semibold text-rose-300">ADMIN</span>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/" className="btn-ghost px-3 py-2 text-xs">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to app
            </Link>
            <button
              onClick={async () => {
                await signOut()
                navigate('/login')
              }}
              title="Sign out"
              className="rounded-md p-2 text-slate-400 transition hover:bg-surface-800 hover:text-white"
            >
              <LogOut className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>
        <div className="mx-auto flex max-w-[1400px] gap-1 overflow-x-auto px-4 sm:px-6">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                [
                  '-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition',
                  isActive ? 'border-primary text-white' : 'border-transparent text-slate-400 hover:text-slate-200',
                ].join(' ')
              }
            >
              {t.label}
            </NavLink>
          ))}
        </div>
      </header>

      <Breadcrumbs />

      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:py-8">
        {loading ? (
          <div className="flex justify-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
          </div>
        ) : (
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        )}
      </main>
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
