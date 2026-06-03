import { lazy } from 'react'
import { BrowserRouter, Routes, Route, Outlet, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { BrandingProvider } from './context/BrandingContext'
import { ThemeProvider } from './context/ThemeContext'
import { ErrorBoundary } from './components/ErrorState'
import ProtectedRoute from './components/ProtectedRoute'
import RequireBAA from './components/RequireBAA'
import RequireOnboarding from './components/RequireOnboarding'
import RequireActiveBilling from './components/RequireActiveBilling'
import Layout from './components/Layout'
import AdminShell from './components/admin/AdminShell'

// ── Eagerly loaded: auth flow + the core routes a TC hits immediately on login
//    (Dashboard shell, Consults, Conversations) so they paint without a chunk
//    fetch. Their charts/heavy panels are split out separately (see below). ──
import Login from './pages/Login'
import Signup from './pages/Signup'
import ResellerSignup from './pages/ResellerSignup'
import ReferralRedirect from './components/ReferralRedirect'
import BAA from './pages/BAA'
import Onboarding from './pages/Onboarding'
import AcceptInvite from './pages/AcceptInvite'
import AcceptInvitation from './pages/AcceptInvitation'
import Dashboard from './pages/Dashboard'
import Consults from './pages/Consults'
import ConsultDetail from './pages/ConsultDetail'
import Conversations from './pages/Conversations'
import PowerDialer from './pages/PowerDialer'
import Sequences from './pages/Sequences'
import SequencesMobileGate from './pages/SequencesMobileGate'
import NotFound from './pages/NotFound'
import { isNative } from './lib/nativeRecorder'

// ── Lazily loaded: secondary routes (settings, training, agency, and the whole
//    admin portal). These pull in heavier deps (recharts on the analytics/admin
//    pages) and aren't needed on first paint, so they're code-split. ──
const Settings = lazy(() => import('./pages/Settings'))
const Training = lazy(() => import('./pages/Training'))
const Community = lazy(() => import('./pages/Community'))
const Agency = lazy(() => import('./pages/Agency'))
const AgencySaaSMode = lazy(() => import('./pages/AgencySaaSMode'))
const AgencyAnalytics = lazy(() => import('./pages/AgencyAnalytics'))
const AgencyKnowledgeBase = lazy(() => import('./pages/AgencyKnowledgeBase'))
const AgencyTeam = lazy(() => import('./pages/AgencyTeam'))
const AdminOverview = lazy(() => import('./pages/admin/Overview'))
const AdminAgencies = lazy(() => import('./pages/admin/Agencies'))
const AdminResellers = lazy(() => import('./pages/admin/Resellers'))
const AdminAgencyDetail = lazy(() => import('./pages/admin/AgencyDetail'))
const AdminPractices = lazy(() => import('./pages/admin/Practices'))
const AdminPracticeDetail = lazy(() => import('./pages/admin/PracticeDetail'))
const AdminRevenue = lazy(() => import('./pages/admin/Revenue'))
const AdminBilling = lazy(() => import('./pages/admin/Billing'))
const AdminReferrals = lazy(() => import('./pages/admin/Referrals'))

// get.caselift.io is a signup landing host: visiting its root sends people
// straight into the signup funnel. Hostname is stable per page load, so this is
// evaluated once at module init.
const ON_GO_SUBDOMAIN =
  typeof window !== 'undefined' && window.location.hostname === 'get.caselift.io'

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
      <AuthProvider>
        <BrandingProvider>
          <BrowserRouter>
            <Routes>
              {/* get.caselift.io root → signup funnel (preserving ?plan=/?ref=).
                  Defined first so it wins the "/" match; otherwise the gated app
                  shell matches "/" and ProtectedRoute bounces visitors to /login. */}
              {ON_GO_SUBDOMAIN && (
                <Route
                  path="/"
                  element={
                    <Navigate
                      to={`/signup${typeof window !== 'undefined' ? window.location.search : ''}`}
                      replace
                    />
                  }
                />
              )}
              {/* Public */}
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              {/* White-labeled reseller client signup (SaaS mode). Public. */}
              <Route path="/signup/:slug" element={<ResellerSignup />} />
              {/* Referral link entry: stores the code and forwards to signup. */}
              <Route path="/r/:code" element={<ReferralRedirect />} />
              <Route path="/accept-invite" element={<AcceptInvite />} />
              <Route path="/invite/:token" element={<AcceptInvitation />} />

              {/* Requires a session */}
              <Route
                element={
                  <ProtectedRoute>
                    <Outlet />
                  </ProtectedRoute>
                }
              >
                <Route path="/baa" element={<BAA />} />
                <Route
                  element={
                    <RequireBAA>
                      <Outlet />
                    </RequireBAA>
                  }
                >
                  <Route path="/onboarding" element={<Onboarding />} />
                </Route>

                {/* Super-admin portal - standalone shell, outside BAA/onboarding.
                    AdminShell self-gates on isSuperAdmin and provides AdminProvider. */}
                <Route path="/admin" element={<AdminShell />}>
                  <Route index element={<AdminOverview />} />
                  <Route path="agencies" element={<AdminAgencies />} />
                  <Route path="resellers" element={<AdminResellers />} />
                  <Route path="agencies/:id" element={<AdminAgencyDetail />} />
                  <Route path="practices" element={<AdminPractices />} />
                  <Route path="practices/:id" element={<AdminPracticeDetail />} />
                  <Route path="revenue" element={<AdminRevenue />} />
                  <Route path="billing" element={<AdminBilling />} />
                  <Route path="referrals" element={<AdminReferrals />} />
                </Route>

                {/* App shell - gated behind BAA acceptance + onboarding completion */}
                <Route
                  element={
                    <RequireBAA>
                      <RequireOnboarding>
                        <Layout />
                      </RequireOnboarding>
                    </RequireBAA>
                  }
                >
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/agency" element={<Agency />} />
                  <Route path="/agency/saas-mode" element={<AgencySaaSMode />} />
                  <Route path="/agency/analytics" element={<AgencyAnalytics />} />
                  <Route path="/agency/knowledge-base" element={<AgencyKnowledgeBase />} />
                  <Route path="/agency/team" element={<AgencyTeam />} />
                  {/* Community is a locked "coming soon" teaser - always viewable. */}
                  <Route path="/community" element={<Community />} />
                  {/* Core app - gated by active billing. Settings/Dashboard stay open. */}
                  <Route element={<RequireActiveBilling />}>
                    <Route path="/knowledge-base" element={<Navigate to="/settings/knowledge-base" replace />} />
                    <Route path="/consults" element={<Consults />} />
                    <Route path="/consults/:id" element={<ConsultDetail />} />
                    <Route path="/conversations" element={<Conversations />} />
                    <Route path="/conversations/dialer" element={<PowerDialer />} />
                    {/* Sequence editing is desktop-only for now; the native app
                        shows a gate instead of the management/settings view. */}
                    <Route path="/sequences" element={isNative() ? <SequencesMobileGate /> : <Sequences />} />
                    <Route path="/training" element={<Training />} />
                  </Route>
                  <Route path="/settings" element={<Settings />} />
                  {/* Sequence config moved into the Sequences page (Settings tab). */}
                  <Route path="/settings/sequence" element={<Navigate to="/sequences" replace />} />
                  <Route path="/settings/:tab" element={<Settings />} />
                  <Route path="*" element={<NotFound />} />
                </Route>
              </Route>
            </Routes>
          </BrowserRouter>
        </BrandingProvider>
      </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}
