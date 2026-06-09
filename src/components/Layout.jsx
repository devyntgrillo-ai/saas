import { Suspense, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate, useLocation, useSearchParams } from 'react-router-dom'
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
  LayoutGrid,
  Rocket,
  ClipboardList,
} from 'lucide-react'
import Logo from './Logo'
import NotificationBell from './NotificationBell'
import GlobalSearch from './GlobalSearch'
import RecordConsultButton from './RecordConsultButton'
import TeamMemberWelcome from './TeamMemberWelcome'
import AccountSwitcher from './AccountSwitcher'
import ImpersonationBanner from './ImpersonationBanner'
import { RecorderProvider } from '../context/RecorderContext'
import { VoiceProvider } from '../context/VoiceContext'
import VoiceCallBar from './VoiceCallBar'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useChatUnread } from '../hooks/useChatUnread'
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
  { to: '/chat', label: 'Coaching', icon: Rocket },
  { to: '/community', label: 'Community', icon: Users, locked: true },
]

// Reseller (agency) portal nav - rendered vertically in the sidebar in place of
// the old horizontal AgencyTabs bar. `key` drives active state (the Settings tab
// lives on /agency?tab=settings, so we can't rely on NavLink path matching).
const agencyNav = [
  { key: 'analytics', label: 'Dashboard', icon: LayoutDashboard, to: '/agency/analytics' },
  { key: 'overview', label: 'Subaccounts', icon: LayoutGrid, to: '/agency' },
  { key: 'team', label: 'Team', icon: Users, to: '/agency/team' },
  { key: 'settings', label: 'Settings', icon: Settings, to: '/agency?tab=settings' },
]

// Shared styling for sidebar nav links (active = brand accent + left border).
const navItemClass = ({ isActive }) =>
  [
    'flex h-9 items-center gap-2.5 rounded-lg border-l-[3px] px-3 text-sm transition',
    isActive
      ? 'border-[var(--brand-primary)] bg-[var(--brand-primary-15)] font-medium text-[var(--brand-primary)]'
      : 'border-transparent text-slate-400 hover:bg-surface-800 hover:text-slate-200',
  ].join(' ')

export default function Layout() {
  const {
    user,
    profile,
    agency,
    agencyRole,
    isAgencyUser,
    isAgencyView,
    isSuperAdmin,
    practice,
    practiceId,
    signOut,
  } = useAuth()
  const perms = usePermissions()
  const { isLight, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const [mobileOpen, setMobileOpen] = useState(false)
  const showPaywall = Boolean(practiceId) && needsPaywall(practice)
  // Reseller wholesale billing failed → their account is suspended, so their
  // client subaccounts show a "service paused" banner until the reseller pays.
  const resellerSuspended =
    Boolean(practiceId) && (practice?.agency?.status === 'suspended' || practice?.agency?.active === false)
  // Full-bleed pages own the entire content area (no padding/max-width/scroll)
  // so they can manage their own internal scrolling - e.g. the chat view.
  // The consult detail page (/consults/:id) paints its own full-width background;
  // the list (/consults) and processing screen (/consults/:id/processing) do not.
  const fullBleed =
    location.pathname === '/conversations' ||
    location.pathname === '/chat' ||
    /^\/consults\/[^/]+$/.test(location.pathname)

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const displayName = profile?.display_name || user?.user_metadata?.full_name || user?.email || 'Account'
  const avatarUrl = profile?.avatar_url || user?.user_metadata?.avatar_url || null
  const initials = (() => {
    const s = displayName.trim()
    const parts = s.split(/\s+/)
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
    return s.slice(0, 2).toUpperCase()
  })()

  // Reseller portal: ANY /agency route, OR a viewer in reseller context with no
  // specific practice selected — an agency user at home, or a super-admin
  // impersonating a reseller (both covered by isAgencyView; isAgencyUser alone is
  // false for an impersonating super-admin). Determined first so the practice
  // nav, Record button, and Settings link are suppressed in the reseller portal
  // even if a stale practice id lingers in context.
  const inResellerPortal =
    location.pathname.startsWith('/agency') || (isAgencyView && !practiceId)

  // The practice sidebar shows only when a practice is in context AND we're not
  // viewing the reseller portal.
  const showPracticeNav = Boolean(practiceId) && !inResellerPortal
  // Launchpad sits ABOVE Dashboard until setup is complete, then disappears for
  // good (keyed off launchpad_completed_at). The blue dot flags it as pending.
  const showLaunchpad = showPracticeNav && !practice?.launchpad_completed_at
  const nav = showPracticeNav
    ? (showLaunchpad
        ? [{ to: '/launchpad', label: 'Launchpad', icon: ClipboardList, end: true, dot: true }, ...practiceNav]
        : practiceNav)
    : []
  const showSettings = showPracticeNav && perms.canViewSettings
  const chatUnread = useChatUnread(practiceId)
  const agencyActive =
    location.pathname.startsWith('/agency/analytics') ? 'analytics'
    : location.pathname.startsWith('/agency/team') ? 'team'
    : searchParams.get('tab') === 'settings' ? 'settings'
    : 'overview'

  const SidebarContent = () => (
    <>
      <div className="flex justify-center px-4 pb-5 pt-7">
        {/* Logo resolves the white-label brand via BrandingContext, which already
            honors the super-admin override (Devyn always sees CaseLift). */}
        <Logo size="lg" />
      </div>
      <AccountSwitcher />

      {/* Record Consult - pinned to the top, above the nav. */}
      {showPracticeNav && <RecordConsultButton onLaunch={() => setMobileOpen(false)} />}

      <nav className="flex-1 space-y-0.5 px-3">
        {inResellerPortal
          ? // Reseller portal: agency nav. Plain Links + manual active state so the
            // Settings tab (/agency?tab=settings) highlights correctly.
            agencyNav.map(({ key, label, icon: Icon, to }) => (
              <Link
                key={key}
                to={to}
                onClick={() => setMobileOpen(false)}
                className={navItemClass({ isActive: key === agencyActive })}
              >
                {Icon && <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />}
                <span className="flex-1">{label}</span>
              </Link>
            ))
          : nav.map(({ to, label, icon: Icon, end, locked, dot }) => (
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
                {/* Blue dot flags pending setup on the Launchpad item. */}
                {dot && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />}
                {/* Live unread badge for the Chat channel. */}
                {to === '/chat' && chatUnread > 0 && (
                  <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold !text-white">
                    {chatUnread > 9 ? '9+' : chatUnread}
                  </span>
                )}
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
          <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-800 text-xs font-medium text-slate-300">
            {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-slate-200">{displayName}</p>
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
      <VoiceProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-surface">
      {/* Impersonation bar - pinned above the nav, visible while impersonating. */}
      <ImpersonationBanner />
      <div className="app-shell flex min-h-0 flex-1 overflow-hidden">
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
      </div>
      <VoiceCallBar />
      {/* One-time welcome for invited recorders (gates itself by role). */}
      {showPracticeNav && <TeamMemberWelcome />}
      </VoiceProvider>
    </RecorderProvider>
  )
}
