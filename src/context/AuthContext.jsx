/* eslint-disable react-refresh/only-export-components -- this module exports the
   provider/hook plus shared helpers (normalizePractice, SUPER_ADMIN_EMAIL). */
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { ensurePracticeLinked } from '../lib/linkPractice'
import { supabase } from '../lib/supabase'
import { resetPrimaryColor } from '../lib/whitelabel'

const AuthContext = createContext({})
const VIEW_KEY = 'ciq_view_practice'
// Reseller-level impersonation: which agency a super-admin is "viewing as".
const AGENCY_VIEW_KEY = 'ciq_view_agency'

/** PostgREST may return a many-to-one join as an object or a one-element array. */
export function normalizePractice(row) {
  if (row == null) return null
  if (Array.isArray(row)) return row[0] ?? null
  return row
}

// The platform super-admin is granted by email, independent of any DB column,
// so an unset/incorrect users.access_level can never lock this account out of
// the admin view (which is how the BAA-gate lockout happened previously).
export const SUPER_ADMIN_EMAIL = 'devyntgrillo@gmail.com'

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  const [profile, setProfile] = useState(null) // users row (+ practice + practice.agency)
  const [profileLoading, setProfileLoading] = useState(true)
  // User id we last finished loadProfile for — prevents a one-frame BAA redirect
  // between getSession() returning and loadProfile() completing.
  const [profileResolvedUserId, setProfileResolvedUserId] = useState(null)

  const [agency, setAgency] = useState(null) // agency_accounts row the user belongs to
  const [agencyRole, setAgencyRole] = useState(null)
  const [agencyLoading, setAgencyLoading] = useState(true)

  // Agency / super-admin users impersonate a client practice; persisted across reloads.
  const [viewingPracticeId, setViewingPracticeId] = useState(
    () => localStorage.getItem(VIEW_KEY) || null
  )
  const [activePractice, setActivePractice] = useState(null)
  // Which viewingPracticeId the current activePractice record reflects. Lets the
  // guards tell "impersonation target still loading" apart from "loaded, but the
  // practice has no record" — see impersonationPending below.
  const [activePracticeFor, setActivePracticeFor] = useState(null)

  // Reseller-level impersonation: a super-admin "viewing as" an agency (reseller).
  // Parallel to the practice overlay above; persisted across reloads.
  const [viewingAgencyId, setViewingAgencyId] = useState(
    () => localStorage.getItem(AGENCY_VIEW_KEY) || null
  )
  const [activeAgency, setActiveAgency] = useState(null)
  const [activeAgencyFor, setActiveAgencyFor] = useState(null)

  // Set of practices this user can switch between (drives the account switcher).
  const [accessiblePractices, setAccessiblePractices] = useState([])
  // Resellers (agencies) a super-admin can jump into. Empty for everyone else.
  const [accessibleResellers, setAccessibleResellers] = useState([])

  const clearUserState = useCallback(() => {
    setProfile(null)
    setAgency(null)
    setAgencyRole(null)
    setProfileResolvedUserId(null)
    setProfileLoading(false)
    setAgencyLoading(false)
  }, [])

  // Bootstrap via onAuthStateChange only (INITIAL_SESSION replaces getSession).
  // Never call auth APIs inside this callback — use the provided session.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      if (event === 'TOKEN_REFRESHED') {
        setSession(sess)
        return
      }

      if (event === 'SIGNED_OUT') {
        setSession(null)
        clearUserState()
        setLoading(false)
        return
      }

      if (event === 'INITIAL_SESSION') {
        setSession(sess)
        if (!sess?.user) clearUserState()
        setLoading(false)
        return
      }

      if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'PASSWORD_RECOVERY') {
        setSession(sess)
        setLoading(false)
        return
      }

      if (sess) setSession(sess)
    })
    return () => sub.subscription.unsubscribe()
  }, [clearUserState])

  // --- profile (+ practice + that practice's agency) ---
  const loadProfile = useCallback(async (userId, { silent = false } = {}) => {
    if (!silent) setProfileLoading(true)
    const { data } = await supabase
      .from('users')
      .select('*, practice:practices(*, agency:agency_accounts(*))')
      .eq('id', userId)
      .maybeSingle()

    let row = data
    if (row?.practice_id) {
      let practice = normalizePractice(row.practice)
      // Embedded join can be null (RLS/timing) while practice_id is set — fetch directly.
      if (!practice) {
        const { data: practiceRow } = await supabase
          .from('practices')
          .select('*, agency:agency_accounts(*)')
          .eq('id', row.practice_id)
          .maybeSingle()
        practice = practiceRow ?? null
      }
      row = { ...row, practice }
    } else if (row?.practice) {
      row = { ...row, practice: normalizePractice(row.practice) }
    }

    setProfile(row)
    setProfileResolvedUserId(userId)
    if (!silent) setProfileLoading(false)
    return row
  }, [])

  // --- agency membership ---
  const loadAgency = useCallback(async (userId) => {
    setAgencyLoading(true)
    const { data } = await supabase
      .from('agency_members')
      .select('role, agency:agency_accounts(*)')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    setAgency(data?.agency ?? null)
    setAgencyRole(data?.role ?? null)
    setAgencyLoading(false)
    return data
  }, [])

  // Load profile/agency when the signed-in user changes. TOKEN_REFRESHED only
  // updates the session token above — this effect does not re-run for that.
  const sessionUserId = session?.user?.id ?? null
  useEffect(() => {
    if (!sessionUserId) return
    if (profileResolvedUserId === sessionUserId) return
    loadProfile(sessionUserId)
    loadAgency(sessionUserId)
  }, [sessionUserId, profileResolvedUserId, loadProfile, loadAgency])

  // Email-confirmed signups often land with practice_name metadata but no practice_id yet.
  useEffect(() => {
    if (!sessionUserId || !session?.user || profileLoading || profile?.practice_id) return
    let active = true
    ;(async () => {
      const { practiceId, error } = await ensurePracticeLinked(supabase, session.user)
      if (!active || !practiceId) return
      if (error) {
        console.warn('[Hope AI] Could not link practice:', error.message)
        return
      }
      await loadProfile(sessionUserId, { silent: true })
    })()
    return () => {
      active = false
    }
  }, [sessionUserId, session?.user, profile?.practice_id, profileLoading, loadProfile])

  const isAgencyUser = Boolean(agency)

  // The designated super-admin email always resolves as super_admin, ahead of
  // any DB value — this is the role spec's source of truth for super-admin.
  const isSuperAdminEmail =
    (session?.user?.email || '').toLowerCase() === SUPER_ADMIN_EMAIL

  // Effective access level (super-admin email wins; then explicit
  // users.access_level; otherwise inferred from agency/practice membership).
  const accessLevel =
    (isSuperAdminEmail ? 'super_admin' : null) ||
    profile?.access_level ||
    (isAgencyUser ? `agency_${agencyRole || 'owner'}` : null) ||
    (profile?.practice_id
      ? profile?.role === 'member'
        ? 'practice_member'
        : profile?.role === 'viewer'
          ? 'practice_viewer'
          : 'practice_owner'
      : null)
  const isSuperAdmin = accessLevel === 'super_admin'
  const canImpersonate = isAgencyUser || isSuperAdmin
  // A practice user who belongs to more than one practice (multi-location). They
  // switch their active location the same way admins impersonate — but it's not
  // impersonation, so no banner.
  const isMultiPractice = !canImpersonate && accessiblePractices.length > 1

  // --- active (impersonated) practice record ---
  const loadActivePractice = useCallback(async (id) => {
    if (!id) {
      setActivePractice(null)
      setActivePracticeFor(null)
      return null
    }
    const { data } = await supabase
      .from('practices')
      .select('*, agency:agency_accounts(*)')
      .eq('id', id)
      .maybeSingle()
    setActivePractice(data ?? null)
    // Mark this target as resolved (even if not found) so guards stop waiting.
    setActivePracticeFor(id)
    return data
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if ((canImpersonate || isMultiPractice) && viewingPracticeId) loadActivePractice(viewingPracticeId)
    else {
      setActivePractice(null)
      setActivePracticeFor(null)
    }
  }, [canImpersonate, isMultiPractice, viewingPracticeId, loadActivePractice])

  // --- active (impersonated) reseller/agency record ---
  const loadActiveAgency = useCallback(async (id) => {
    if (!id) {
      setActiveAgency(null)
      setActiveAgencyFor(null)
      return null
    }
    const { data } = await supabase
      .from('agency_accounts')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    setActiveAgency(data ?? null)
    setActiveAgencyFor(id)
    return data
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isSuperAdmin && viewingAgencyId) loadActiveAgency(viewingAgencyId)
    else {
      setActiveAgency(null)
      setActiveAgencyFor(null)
    }
  }, [isSuperAdmin, viewingAgencyId, loadActiveAgency])

  // --- accessible-practice list for the account switcher ---
  const loadAccessiblePractices = useCallback(async (lvl, prof, ag, impAgencyId) => {
    const sel = 'id, name, address, agency_id, city, state'
    try {
      // Archived practices never appear in the account switcher (any role). The
      // admin panel uses its own queries (src/lib/queries/admin.js) and keeps
      // archived accounts visible there.
      if (lvl === 'super_admin') {
        // While impersonating a reseller, scope the switcher to that reseller's
        // sub-accounts only; otherwise show a sample across the platform.
        let q = supabase.from('practices').select(sel).is('archived_at', null).order('name')
        q = impAgencyId ? q.eq('agency_id', impAgencyId).limit(500) : q.limit(50)
        const { data } = await q
        return data || []
      }
      if (ag) {
        const { data } = await supabase.from('practices').select(sel).eq('agency_id', ag.id).is('archived_at', null).order('name').limit(500)
        let rows = data || []
        const accessible = prof?.accessible_practice_ids
        if (Array.isArray(accessible) && accessible.length) rows = rows.filter((p) => accessible.includes(p.id))
        return rows
      }
      // Practice user: every practice they belong to (multi-location) via
      // practice_members, unioned with their home practice_id.
      if (prof?.id) {
        const { data: mem } = await supabase.from('practice_members').select('practice_id').eq('user_id', prof.id)
        const ids = [...new Set([...(mem || []).map((m) => m.practice_id), prof.practice_id].filter(Boolean))]
        if (!ids.length) return []
        const { data } = await supabase.from('practices').select(sel).in('id', ids).is('archived_at', null).order('name')
        return data || []
      }
    } catch {
      /* non-critical */
    }
    return []
  }, [])

  useEffect(() => {
    if (!session?.user || profileLoading || agencyLoading) return
    let active = true
    ;(async () => {
      const list = await loadAccessiblePractices(accessLevel, profile, agency, viewingAgencyId)
      if (active) setAccessiblePractices(list)
      // Super-admins also see every reseller, to jump into their admin view.
      if (accessLevel === 'super_admin') {
        const { data } = await supabase
          .from('agency_accounts')
          .select('id, name')
          .order('name')
          .limit(100)
        if (active) setAccessibleResellers(data || [])
      } else if (active) {
        setAccessibleResellers([])
      }
    })()
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, profile, agency, profileLoading, agencyLoading, accessLevel, viewingAgencyId])

  // --- effective practice context (own practice vs. impersonated client) ---
  const profilePractice = normalizePractice(profile?.practice)
  // Admin/reseller impersonation OR a multi-location user switching their own
  // location both swap the active practice; only the former is "impersonation".
  const switchingPractice = (canImpersonate || isMultiPractice) && Boolean(viewingPracticeId)
  // Reseller-level impersonation: super-admin "viewing as" an agency.
  const impersonatingReseller = isSuperAdmin && Boolean(viewingAgencyId)
  const isImpersonating = canImpersonate && (Boolean(viewingPracticeId) || Boolean(viewingAgencyId))
  // While viewing AS a reseller (no sub-account drilled in), there is no current
  // practice — null it so the shell renders the reseller portal (sidebar nav,
  // no Record Consult / practice Settings) rather than the super-admin's own.
  const practice = switchingPractice
    ? activePractice
    : impersonatingReseller
      ? null
      : profilePractice
  const practiceId = switchingPractice
    ? viewingPracticeId
    : impersonatingReseller
      ? null
      : profile?.practice_id ?? null

  // Effective agency = own agency (reseller user) → impersonated agency
  // (reseller-level) → the impersonated practice's agency (practice-level). This
  // is what the /agency dashboard + its query hooks should scope to.
  // Impersonation wins: when a super-admin is "viewing as" a reseller,
  // activeAgency is that reseller and must take precedence over the super-admin's
  // OWN agency membership (if any) — otherwise the dashboard scopes to the wrong
  // reseller. activeAgency is only ever set during reseller impersonation.
  const effectiveAgency = activeAgency || agency || practice?.agency || null
  const effectiveAgencyId = effectiveAgency?.id ?? null
  const isAgencyView = isAgencyUser || Boolean(activeAgency)

  // An ordinary user whose practice is archived is locked out (-> /suspended).
  // Super admins and resellers can still open archived accounts (they impersonate,
  // so canImpersonate is true) — see the red banner in ImpersonationBanner.
  const isSuspended = !canImpersonate && Boolean(practice?.archived_at)

  // Keep route guards in a loading state until the practice row that drives
  // baaAccepted / onboardingCompleted is available (profile join or switch fetch).
  const practiceContextPending = switchingPractice
    ? activePracticeFor !== viewingPracticeId
    : Boolean(profile?.practice_id) && !profilePractice

  // Keep guards waiting while the impersonated reseller record loads, so the
  // /agency view doesn't bounce before its data/branding resolves.
  const agencyContextPending = impersonatingReseller && activeAgencyFor !== viewingAgencyId

  // Reseller id behind the current view, for data scoping (Part 7 helper).
  const getResellerId = () => {
    if (viewingAgencyId) return viewingAgencyId
    if (isImpersonating && viewingPracticeId) return activePractice?.agency?.id || agency?.id || null
    return agency?.id || null
  }

  const profileResolved =
    !session?.user?.id || profileResolvedUserId === session.user.id

  // Full-app loader (App.jsx): first auth bootstrap or a different user signed in.
  // Does not flip on TOKEN_REFRESHED or impersonation context loads.
  const appShellLoading = loading || (Boolean(sessionUserId) && !profileResolved)

  const viewPractice = useCallback((id) => {
    localStorage.setItem(VIEW_KEY, id)
    setViewingPracticeId(id)
  }, [])

  const exitPractice = useCallback(() => {
    localStorage.removeItem(VIEW_KEY)
    setViewingPracticeId(null)
    setActivePractice(null)
  }, [])

  // Enter reseller-level impersonation (super-admin only). Clears any sub-account
  // drill-in so we land on the reseller's own dashboard.
  const viewAgency = useCallback((id) => {
    localStorage.setItem(AGENCY_VIEW_KEY, id)
    localStorage.removeItem(VIEW_KEY)
    setViewingAgencyId(id)
    setViewingPracticeId(null)
    setActivePractice(null)
  }, [])

  // Exit all impersonation (reseller + any sub-account) back to super admin.
  const exitAgency = useCallback(() => {
    localStorage.removeItem(AGENCY_VIEW_KEY)
    localStorage.removeItem(VIEW_KEY)
    setViewingAgencyId(null)
    setActiveAgency(null)
    setActiveAgencyFor(null)
    setViewingPracticeId(null)
    setActivePractice(null)
  }, [])

  // White-label theming (primary color, logo, title, favicon) is resolved and
  // applied by BrandingContext, which reads this auth context. On sign-out we
  // still reset the palette here so the login screen returns to CaseLift.
  const signOut = useCallback(async () => {
    localStorage.removeItem(VIEW_KEY)
    localStorage.removeItem(AGENCY_VIEW_KEY)
    setViewingPracticeId(null)
    setActivePractice(null)
    setViewingAgencyId(null)
    setActiveAgency(null)
    setActiveAgencyFor(null)
    resetPrimaryColor()
    return supabase.auth.signOut()
  }, [])

  const value = {
    session,
    user: session?.user ?? null,
    loading,

    // profile / practice context
    profile,
    profileLoading,
    profileResolved,
    practice,
    practiceId,
    isSuspended,
    baaAccepted: Boolean(practice?.baa_accepted_at),
    onboardingCompleted: Boolean(practice?.onboarding_completed),

    // agency
    agency,
    agencyRole,
    isAgencyUser,
    agencyLoading,
    // Effective agency context (own / impersonated reseller / impersonated
    // practice's reseller) — what the /agency dashboard scopes to.
    effectiveAgency,
    effectiveAgencyId,
    isAgencyView,
    activeAgency,
    viewAgency,
    exitAgency,
    getResellerId,
    // Route guards (BAA, onboarding, admin): wait for profile + impersonation targets.
    contextLoading:
      appShellLoading ||
      profileLoading ||
      agencyLoading ||
      practiceContextPending ||
      agencyContextPending,
    // App shell only — avoids unmounting the tree on token refresh / impersonation fetch.
    appShellLoading,

    // access
    accessLevel,
    isSuperAdmin,
    canImpersonate,
    isMultiPractice,
    accessiblePractices,
    accessibleResellers,

    // impersonation
    isImpersonating,
    activePractice,
    viewPractice,
    exitPractice,
    // Spec-shaped view of the same impersonation state for UI (e.g. the banner).
    // level: 'reseller' when viewing as an agency; 'practice' when in a specific
    // account (a sub-account drill-in keeps the reseller context via `reseller`).
    impersonation: {
      active: isImpersonating,
      level: !isImpersonating ? null : viewingPracticeId ? 'practice' : 'reseller',
      target: !isImpersonating
        ? null
        : viewingPracticeId
          ? {
              id: practiceId,
              name: activePractice?.name || 'this account',
              email: activePractice?.email || null,
              role: 'practice_user',
            }
          : {
              id: viewingAgencyId,
              name: activeAgency?.brand_name || activeAgency?.company_name || activeAgency?.name || 'this reseller',
              email: activeAgency?.support_email || activeAgency?.owner_email || null,
              role: 'reseller_admin',
              logo_url: activeAgency?.logo_url || null,
              brand_color: activeAgency?.primary_color || null,
              brand_name: activeAgency?.brand_name || null,
            },
      // The reseller context behind a practice impersonation, for "Back to [reseller]".
      reseller: viewingAgencyId
        ? {
            id: viewingAgencyId,
            name: activeAgency?.brand_name || activeAgency?.company_name || activeAgency?.name || 'Reseller',
          }
        : null,
      resellerId: getResellerId(),
      originalRole: isSuperAdmin ? 'super_admin' : isAgencyUser ? 'reseller_admin' : accessLevel || null,
      original: {
        id: session?.user?.id || null,
        name: profile?.full_name || session?.user?.email || null,
        email: session?.user?.email || null,
        role: accessLevel || null,
      },
    },

    refreshProfile: () =>
      session?.user
        ? Promise.all([
            loadProfile(session.user.id, { silent: true }),
            isAgencyUser && viewingPracticeId ? loadActivePractice(viewingPracticeId) : null,
            isSuperAdmin && viewingAgencyId ? loadActiveAgency(viewingAgencyId) : null,
          ])
        : Promise.resolve(null),
    // Reload the user's own agency AND, when a super-admin is impersonating a
    // reseller, that reseller's record — so editing white-label settings (name,
    // logo, color) re-applies branding immediately instead of staying stale.
    refreshAgency: () =>
      session?.user
        ? Promise.all([
            loadAgency(session.user.id),
            isSuperAdmin && viewingAgencyId ? loadActiveAgency(viewingAgencyId) : null,
          ])
        : Promise.resolve(null),

    signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
    signUp: (email, password, metadata) =>
      supabase.auth.signUp({ email, password, options: { data: metadata } }),
    signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
