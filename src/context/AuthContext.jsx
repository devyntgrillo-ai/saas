import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { resetPrimaryColor } from '../lib/whitelabel'

const AuthContext = createContext({})
const VIEW_KEY = 'ciq_view_practice'

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

  // Set of practices this user can switch between (drives the account switcher).
  const [accessiblePractices, setAccessiblePractices] = useState([])

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

  const isAgencyUser = Boolean(agency)

  // Effective access level (explicit users.access_level wins; otherwise inferred).
  const accessLevel =
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
      return null
    }
    const { data } = await supabase
      .from('practices')
      .select('*, agency:agency_accounts(*)')
      .eq('id', id)
      .maybeSingle()
    setActivePractice(data ?? null)
    return data
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (canImpersonate && viewingPracticeId) loadActivePractice(viewingPracticeId)
    else setActivePractice(null)
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
  // still reset the palette here so the login screen returns to Hope AI.
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
    contextLoading: profileLoading || agencyLoading,

    // access
    accessLevel,
    isSuperAdmin,
    canImpersonate,
    accessiblePractices,

    // impersonation
    isImpersonating,
    activePractice,
    viewPractice,
    exitPractice,

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
