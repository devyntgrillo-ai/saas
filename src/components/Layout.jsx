import { Suspense, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import PageLoader from './PageLoader'
import {
  LayoutDashboard,
  CalendarCheck,
  MessageSquare,
  GitBranch,
  GraduationCap,
  Users,
  Lock,
  Settings,
  LogOut,
  Menu,
  X,
  AlertTriangle,
  Sun,
  Moon,
} from 'lucide-react'
import Logo from './Logo'
import NotificationBell from './NotificationBell'
import GlobalSearch from './GlobalSearch'
import RecordConsultButton from './RecordConsultButton'
import AccountSwitcher from './AccountSwitcher'
import { RecorderProvider } from '../context/RecorderContext'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { usePermissions } from '../lib/permissions'
import { needsPaywall } from '../lib/billing'

// Settings is intentionally absent here - it's pinned to the bottom of the
// sidebar (below), separate from the main nav.
const practiceNav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/consults', label: 'Consults', icon: CalendarCheck },
  { to: '/conversations', label: 'Conversations', icon: MessageSquare },
  { to: '/sequences', label: 'Sequences', icon: GitBranch },
  { to: '/training', label: 'Training', icon: GraduationCap },
  { to: '/community', label: 'Community', icon: Users, locked: true },
]

// Shared styling for sidebar nav links (active = brand accent + left border).
const navItemClass = ({ isActive }) =>
  [
    'flex h-9 items-center gap-2.5 rounded-lg border-l-2 px-3 text-sm transition',
    isActive
      ? 'border-primary bg-primary/10 font-medium text-primary-300'
      : 'border-transparent text-slate-400 hover:bg-surface-800 hover:text-slate-200',
  ].join(' ')

export default function Layout() {
  const {
    user,
    profile,
    agency,
    agencyRole,
    isAgencyUser,
    isSuperAdmin,
    isImpersonating,
    activePractice,
    practice,
    practiceId,
    exitPractice,
    signOut,
  } = useAuth()
  const perms = usePermissions()
  const { isLight, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const showPaywall = Boolean(practiceId) && needsPaywall(practice)
  // Reseller wholesale billing failed → their account is suspended, so their
  // client subaccounts show a "service paused" banner until the reseller pays.
  const resellerSuspended =
    Boolean(practiceId) && (practice?.agency?.status === 'suspended' || practice?.agency?.active === false)
  // Full-bleed pages own the entire content area (no padding/max-width/scroll)
  // so they can manage their own internal scrolling - e.g. the chat view.
  const fullBleed = location.pathname === '/conversations'

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const handleExit = (to) => {
    exitPractice()
    navigate(to || '/agency')
  }

  const initials = (user?.email || '?').slice(0, 2).toUpperCase()

  // The sidebar shows practice nav only. Admin and Reseller portals are reached
  // through the AccountSwitcher's "Your Views" dropdown, not the sidebar.
  // Practice nav appears only when a practice is in context (their own, or one
  // they're impersonating).
  const nav = practiceId ? practiceNav : []
  const showSettings = practiceId && perms.canViewSettings

  const SidebarContent = () => (
    <>
      <div className="px-4 pb-3 pt-6">
        {/* Logo resolves the white-label brand via BrandingContext, which already
            honors the super-admin override (Devyn always sees CaseLift). */}
        <Logo />
      </div>
      <AccountSwitcher />

      {/* Record Consult - pinned to the top, above the nav. */}
      {practiceId && <RecordConsultButton onLaunch={() => setMobileOpen(false)} />}

      <nav className="flex-1 space-y-0.5 px-3">
        {nav.map(({ to, label, icon: Icon, end, locked }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => setMobileOpen(false)}
            className={navItemClass}
          >
            {/* Icon inherits the link's text color: muted gray when inactive,
                brand accent when active. Size 16px, 10px gap (gap-2.5 above). */}
            {Icon && <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />}
            <span className="flex-1">{label}</span>
            {/* Locked tabs (e.g. Community) show a small lock - viewable as a teaser. */}
            {locked && <Lock className="h-3 w-3 shrink-0 text-slate-500" strokeWidth={2} />}
          </NavLink>
        ))}
      </nav>

      {/* Settings - pinned to the bottom (where Record Consult used to be). */}
      {showSettings && (
        <div className="px-3 pb-2">
          <NavLink to="/settings" onClick={() => setMobileOpen(false)} className={navItemClass}>
            <Settings className="h-4 w-4 shrink-0" strokeWidth={2} />
            Settings
          </NavLink>
        </div>
      )}

      <div className="border-t border-white/[0.07] p-3">
        <div className="flex items-center gap-3 px-1 py-1">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-800 text-xs font-medium text-slate-300">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-slate-200">{user?.email}</p>
            <p className="truncate text-xs capitalize text-slate-500">
              {isSuperAdmin ? 'Super Admin' : isAgencyUser ? `${agencyRole || 'member'} · ${agency?.name || 'Reseller'}` : profile?.role || 'member'}
            </p>
          </div>
          <button
            onClick={toggleTheme}
            title={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
            aria-label={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
            className="rounded-md p-2 text-slate-500 transition hover:bg-surface-800 hover:text-slate-200"
          >
            {isLight ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <button
            onClick={handleSignOut}
            title="Sign out"
            className="rounded-md p-2 text-slate-500 transition hover:bg-surface-800 hover:text-slate-200"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </>
  )

  return (
    <RecorderProvider>
      <div className="app-shell flex h-screen overflow-hidden bg-surface">
      {/* Desktop sidebar */}
      <aside className="hidden w-[220px] shrink-0 flex-col border-r border-white/[0.07] bg-surface-900 lg:flex">
        <SidebarContent />
      </aside>

      {/* Mobile sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
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
        {/* Service paused - the reseller behind this practice is past due on
            their CaseLift wholesale bill, so their subaccounts are paused. */}
        {resellerSuspended && (
          <div
            className={`flex flex-wrap items-center gap-2 border-b px-4 py-2.5 text-sm ${
              isLight ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-rose-500/30 bg-rose-500/10 text-rose-200'
            }`}
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              Service is temporarily paused. Please contact{' '}
              <span className="font-semibold">{practice?.agency?.company_name || practice?.agency?.name || 'your provider'}</span> to restore access.
            </span>
          </div>
        )}

        {/* Soft paywall - trial ended / subscription not active. Access is not
            blocked yet; this is a persistent upgrade nudge. */}
        {showPaywall && (
          <div
            className={`flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5 text-sm ${
              isLight ? 'border-amber-200 bg-amber-50' : 'border-amber-500/30 bg-amber-500/10'
            }`}
          >
            <span className={`flex items-center gap-2 ${isLight ? 'text-amber-900' : 'text-amber-200'}`}>
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {practice?.subscription_status === 'past_due'
                ? 'Your last payment failed. Update your billing to keep CaseLift active.'
                : practice?.subscription_status === 'cancelled' ||
                    practice?.subscription_status === 'canceled'
                  ? 'Your subscription is cancelled. Reactivate to keep full access.'
                  : 'Your free trial has ended. Upgrade to keep using CaseLift.'}
            </span>
            <Link
              to="/settings/billing"
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                isLight
                  ? 'bg-amber-500 !text-white hover:bg-amber-600'
                  : 'bg-amber-400 text-amber-950 hover:bg-amber-300'
              }`}
            >
              {practice?.subscription_status === 'past_due'
                ? 'Update billing'
                : practice?.subscription_status === 'cancelled' ||
                    practice?.subscription_status === 'canceled'
                  ? 'Reactivate'
                  : 'Upgrade now'}
            </Link>
          </div>
        )}

        {/* Viewing banner - subtle 32px strip, muted text, text-link exit. */}
        {isImpersonating && (
          <div className="flex h-8 items-center justify-between gap-3 border-b border-white/[0.07] bg-surface-800 px-4 text-xs text-slate-400">
            <span className="truncate">
              Viewing <span className="text-slate-200">{activePractice?.name || 'client practice'}</span>
              {activePractice?.agency?.name && <span> · {activePractice.agency.name}</span>}
            </span>
            <button
              onClick={() => handleExit(isSuperAdmin ? '/admin' : '/agency')}
              className="shrink-0 font-medium text-slate-400 transition hover:text-slate-200"
            >
              Exit
            </button>
          </div>
        )}

        {/* Top bar - mobile menu/logo on the left, search + notifications on the right */}
        <header className="flex items-center gap-3 border-b border-white/[0.07] bg-surface-900 px-4 py-3 sm:px-6">
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-md p-2 text-slate-300 hover:bg-surface-800 lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="lg:hidden">
            <Logo />
          </div>
          <div className="ml-auto flex items-center gap-2">
            {practiceId && <GlobalSearch />}
            {practiceId && <NotificationBell />}
          </div>
        </header>

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Suspense fallback={<PageLoader />}>
            {fullBleed ? (
              <Outlet />
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
                  <Outlet />
                </div>
              </div>
            )}
          </Suspense>
        </main>
      </div>

      {/* Subtle corner marker so super-admins always know they're in admin mode,
          even when previewing a client's white-label brand. */}
      {isSuperAdmin && (
        <div className="pointer-events-none fixed bottom-3 right-3 z-30 rounded-full border border-white/10 bg-surface-900/90 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-slate-400 shadow-lg backdrop-blur">
          CaseLift Admin
        </div>
      )}
      </div>
    </RecorderProvider>
  )
}
