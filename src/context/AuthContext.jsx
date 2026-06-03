import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { ensurePracticeLinked } from '../lib/linkPractice'
import { supabase } from '../lib/supabase'
import { resetPrimaryColor } from '../lib/whitelabel'

const AuthContext = createContext({})
const VIEW_KEY = 'ciq_view_practice'

// The platform super-admin is granted by email, independent of any DB column,
// so an unset/incorrect users.access_level can never lock this account out of
// the admin view (which is how the BAA-gate lockout happened previously).
export const SUPER_ADMIN_EMAIL = 'devyntgrillo@gmail.com'

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  const [profile, setProfile] = useState(null) // users row (+ practice + practice.agency)
  const [profileLoading, setProfileLoading] = useState(true)

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

  // Set of practices this user can switch between (drives the account switcher).
  const [accessiblePractices, setAccessiblePractices] = useState([])
  // Resellers (agencies) a super-admin can jump into. Empty for everyone else.
  const [accessibleResellers, setAccessibleResellers] = useState([])

  // --- session ---
  useEffect(() => {
    let active = true
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return
        setSession(data.session)
      })
      .catch(() => {
        if (!active) return
        setSession(null)
      })
      .finally(() => {
        if (!active) return
        setLoading(false)
      })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess)
      setLoading(false)
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  // --- profile (+ practice + that practice's agency) ---
  const loadProfile = useCallback(async (userId, { silent = false } = {}) => {
    if (!silent) setProfileLoading(true)
    const { data } = await supabase
      .from('users')
      .select('*, practice:practices(*, agency:agency_accounts(*))')
      .eq('id', userId)
      .maybeSingle()
    setProfile(data)
    if (!silent) setProfileLoading(false)
    return data
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

  useEffect(() => {
    if (!session?.user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProfile(null)
      setAgency(null)
      setAgencyRole(null)
      setProfileLoading(false)
      setAgencyLoading(false)
      return
    }
    loadProfile(session.user.id)
    loadAgency(session.user.id)
  }, [session, loadProfile, loadAgency])

  // Email-confirmed signups often land with practice_name metadata but no practice_id yet.
  useEffect(() => {
    if (!session?.user || profileLoading || profile?.practice_id) return
    let active = true
    ;(async () => {
      const { practiceId, error } = await ensurePracticeLinked(supabase, session.user)
      if (!active || !practiceId) return
      if (error) {
        console.warn('[Hope AI] Could not link practice:', error.message)
        return
      }
      await loadProfile(session.user.id, { silent: true })
    })()
    return () => {
      active = false
    }
  }, [session, profile?.practice_id, profileLoading, loadProfile])

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
    if (canImpersonate && viewingPracticeId) loadActivePractice(viewingPracticeId)
    else {
      setActivePractice(null)
      setActivePracticeFor(null)
    }
  }, [canImpersonate, viewingPracticeId, loadActivePractice])

  // --- accessible-practice list for the account switcher ---
  const loadAccessiblePractices = useCallback(async (lvl, prof, ag) => {
    const sel = 'id, name, address, agency_id'
    try {
      if (lvl === 'super_admin') {
        const { data } = await supabase.from('practices').select(sel).order('name').limit(50)
        return data || []
      }
      if (ag) {
        const { data } = await supabase.from('practices').select(sel).eq('agency_id', ag.id).order('name')
        let rows = data || []
        const accessible = prof?.accessible_practice_ids
        if (Array.isArray(accessible) && accessible.length) rows = rows.filter((p) => accessible.includes(p.id))
        return rows
      }
      if (prof?.practice_id) {
        const { data } = await supabase.from('practices').select(sel).eq('id', prof.practice_id)
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
      const list = await loadAccessiblePractices(accessLevel, profile, agency)
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
  }, [session, profile, agency, profileLoading, agencyLoading, accessLevel])

  // --- effective practice context (own practice vs. impersonated client) ---
  const practice = canImpersonate ? activePractice : profile?.practice ?? null
  const practiceId = canImpersonate ? viewingPracticeId : profile?.practice_id ?? null
  const isImpersonating = canImpersonate && Boolean(viewingPracticeId)

  // On a hard refresh, viewingPracticeId is restored from localStorage
  // synchronously (so practiceId is truthy at once), but the practice record it
  // points to is fetched async and is NOT part of profile/agency loading. Until
  // that fetch resolves, practice is null and onboardingCompleted/baaAccepted
  // read false — which made route guards bounce impersonating super-admins to
  // /onboarding (then on to the dashboard), losing the current route on refresh.
  // Treat the context as still loading until activePractice matches the target.
  const impersonationPending =
    canImpersonate && Boolean(viewingPracticeId) && activePracticeFor !== viewingPracticeId

  const viewPractice = useCallback((id) => {
    localStorage.setItem(VIEW_KEY, id)
    setViewingPracticeId(id)
  }, [])

  const exitPractice = useCallback(() => {
    localStorage.removeItem(VIEW_KEY)
    setViewingPracticeId(null)
    setActivePractice(null)
  }, [])

  // White-label theming (primary color, logo, title, favicon) is resolved and
  // applied by BrandingContext, which reads this auth context. On sign-out we
  // still reset the palette here so the login screen returns to CaseLift.
  const signOut = useCallback(async () => {
    localStorage.removeItem(VIEW_KEY)
    setViewingPracticeId(null)
    setActivePractice(null)
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
    practice,
    practiceId,
    baaAccepted: Boolean(practice?.baa_accepted_at),
    onboardingCompleted: Boolean(practice?.onboarding_completed),

    // agency
    agency,
    agencyRole,
    isAgencyUser,
    agencyLoading,
    contextLoading: profileLoading || agencyLoading || impersonationPending,

    // access
    accessLevel,
    isSuperAdmin,
    canImpersonate,
    accessiblePractices,
    accessibleResellers,

    // impersonation
    isImpersonating,
    activePractice,
    viewPractice,
    exitPractice,
    // Spec-shaped view of the same impersonation state for UI (e.g. the banner).
    impersonation: {
      active: isImpersonating,
      target: isImpersonating
        ? {
            id: practiceId,
            name: activePractice?.name || 'this account',
            email: activePractice?.email || null,
            role: 'practice_user',
          }
        : null,
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
          ])
        : Promise.resolve(null),
    refreshAgency: () => (session?.user ? loadAgency(session.user.id) : Promise.resolve(null)),

    signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
    signUp: (email, password, metadata) =>
      supabase.auth.signUp({ email, password, options: { data: metadata } }),
    signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext)
}
