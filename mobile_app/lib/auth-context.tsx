import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { router } from 'expo-router';

import { deviceDeleteItem, deviceGetItem, deviceSetItem } from '@/lib/device-storage';
import { canBypassBaaGate } from '@/lib/access-levels';
import { saveRememberedLogin } from '@/lib/remembered-login';
import { supabase } from '@/lib/supabase';

const VIEW_KEY = 'ciq_view_practice';
const SUPER_ADMIN_EMAIL = 'devyntgrillo@gmail.com';

export type Practice = {
  id: string;
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  agency_id?: string | null;
  baa_accepted_at?: string | null;
  onboarding_completed?: boolean | null;
  archived_at?: string | null;
  subscription_status?: string | null;
  email?: string | null;
  doctors?: string[] | null;
  doctor_first?: string | null;
  doctor_last?: string | null;
  pms_sync_rules?: {
    clusters?: Array<{
      id?: string;
      label?: string;
      procedure_codes?: string[];
      ai_reason?: string;
    }>;
  } | null;
};

export type UserProfile = {
  id: string;
  practice_id?: string | null;
  role?: string | null;
  access_level?: string | null;
  display_name?: string | null;
  full_name?: string | null;
  avatar_url?: string | null;
  accessible_practice_ids?: string[] | null;
  practice?: Practice | Practice[] | null;
};

function normalizePractice(row: Practice | Practice[] | null | undefined): Practice | null {
  if (row == null) return null;
  if (Array.isArray(row)) return row[0] ?? null;
  return row;
}

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  isReady: boolean;
  isLoggedIn: boolean;
  profile: UserProfile | null;
  profileLoading: boolean;
  practice: Practice | null;
  practiceId: string | null;
  accessLevel: string | null;
  isAgencyUser: boolean;
  isAgencyOnly: boolean;
  isPracticeUser: boolean;
  isMobileSupported: boolean;
  isSuperAdmin: boolean;
  canBypassBaa: boolean;
  baaAccepted: boolean;
  onboardingCompleted: boolean;
  practiceContextPending: boolean;
  isSuspended: boolean;
  isMultiPractice: boolean;
  accessiblePractices: Practice[];
  viewPractice: (id: string) => void;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileResolvedUserId, setProfileResolvedUserId] = useState<string | null>(null);
  const [agency, setAgency] = useState<{ id: string } | null>(null);
  const [agencyRole, setAgencyRole] = useState<string | null>(null);
  const [viewingPracticeId, setViewingPracticeId] = useState<string | null>(null);
  const [activePractice, setActivePractice] = useState<Practice | null>(null);
  const [activePracticeFor, setActivePracticeFor] = useState<string | null>(null);
  const [accessiblePractices, setAccessiblePractices] = useState<Practice[]>([]);

  const clearUserState = useCallback(() => {
    setProfile(null);
    setAgency(null);
    setAgencyRole(null);
    setProfileResolvedUserId(null);
    setProfileLoading(false);
    setAccessiblePractices([]);
    setViewingPracticeId(null);
    setActivePractice(null);
    setActivePracticeFor(null);
  }, []);

  useEffect(() => {
    void deviceGetItem(VIEW_KEY).then((stored) => {
      if (stored) setViewingPracticeId(stored);
    });
  }, []);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      if (event === 'TOKEN_REFRESHED') {
        setSession(sess);
        return;
      }
      if (event === 'SIGNED_OUT') {
        setSession(null);
        clearUserState();
        setLoading(false);
        return;
      }
      if (event === 'INITIAL_SESSION') {
        setSession(sess);
        if (!sess?.user) clearUserState();
        setLoading(false);
        return;
      }
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        setSession(sess);
        setLoading(false);
        return;
      }
      if (sess) setSession(sess);
    });
    return () => sub.subscription.unsubscribe();
  }, [clearUserState]);

  const loadProfile = useCallback(async (userId: string) => {
    setProfileLoading(true);
    const { data } = await supabase
      .from('users')
      .select('*, practice:practices(*)')
      .eq('id', userId)
      .maybeSingle();

    let row = data as UserProfile | null;
    if (row?.practice_id) {
      let practice = normalizePractice(row.practice);
      if (!practice) {
        const { data: practiceRow } = await supabase
          .from('practices')
          .select('*')
          .eq('id', row.practice_id)
          .maybeSingle();
        practice = practiceRow ?? null;
      }
      row = { ...row, practice };
    } else if (row?.practice) {
      row = { ...row, practice: normalizePractice(row.practice) };
    }

    setProfile(row);
    setProfileResolvedUserId(userId);
    setProfileLoading(false);
    return row;
  }, []);

  const loadAgency = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from('agency_members')
      .select('role, agency:agency_accounts(id)')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    const row = data as { role?: string; agency?: { id: string } | { id: string }[] } | null;
    const agencyRow = row?.agency;
    const resolved = Array.isArray(agencyRow) ? agencyRow[0] : agencyRow;
    setAgency(resolved ?? null);
    setAgencyRole(row?.role ?? null);
    return resolved ?? null;
  }, []);

  const sessionUserId = session?.user?.id ?? null;

  useEffect(() => {
    if (!sessionUserId) return;
    if (profileResolvedUserId === sessionUserId) return;
    void loadProfile(sessionUserId);
    void loadAgency(sessionUserId);
  }, [sessionUserId, profileResolvedUserId, loadProfile, loadAgency]);

  const loadAccessiblePractices = useCallback(
    async (prof: UserProfile | null, superAdmin = false) => {
    const sel =
      'id, name, address, city, state, agency_id, baa_accepted_at, onboarding_completed, archived_at, subscription_status';
    try {
      // Super-admin sees a sample of all practices (mirrors the web account
      // switcher in src/context/AuthContext.jsx), not just practices they are a
      // member of — so platform sub-accounts like "Demo Dental" are selectable
      // on mobile too.
      if (superAdmin) {
        const { data } = await supabase
          .from('practices')
          .select(sel)
          .is('archived_at', null)
          .order('name')
          .limit(50);
        return (data as Practice[]) || [];
      }
      if (!prof?.id) return [];
      const { data: mem } = await supabase
        .from('practice_members')
        .select('practice_id')
        .eq('user_id', prof.id);
      const ids = [
        ...new Set([...(mem || []).map((m) => m.practice_id), prof.practice_id].filter(Boolean)),
      ] as string[];
      if (!ids.length) return [];
      const { data } = await supabase
        .from('practices')
        .select(sel)
        .in('id', ids)
        .is('archived_at', null)
        .order('name');
      return (data as Practice[]) || [];
    } catch {
      return [];
    }
  },
    [],
  );

  useEffect(() => {
    if (!session?.user || profileLoading) return;
    let active = true;
    const superAdmin =
      (session?.user?.email || '').toLowerCase() === SUPER_ADMIN_EMAIL ||
      profile?.access_level === 'super_admin';
    void loadAccessiblePractices(profile, superAdmin).then((list) => {
      if (!active) return;
      setAccessiblePractices(list);
      if (viewingPracticeId && !list.some((p) => p.id === viewingPracticeId)) {
        void deviceDeleteItem(VIEW_KEY);
        setViewingPracticeId(null);
      } else if (!viewingPracticeId && superAdmin) {
        // Super-admin has no home practice, so the mobile app would otherwise
        // land on the first practice alphabetically. Default the demo experience
        // to the "Demo Dental" sub-account (the populated demo data shared with
        // the web app). Persisted so it sticks, and still overridable via the
        // practice switcher.
        const demo = list.find((p) => p.name === 'Demo Dental');
        if (demo) {
          setViewingPracticeId(demo.id);
          void deviceSetItem(VIEW_KEY, demo.id);
        }
      }
    });
    return () => {
      active = false;
    };
  }, [session, profile, profileLoading, loadAccessiblePractices, viewingPracticeId]);

  const loadActivePractice = useCallback(async (id: string) => {
    const { data } = await supabase.from('practices').select('*').eq('id', id).maybeSingle();
    setActivePractice((data as Practice) ?? null);
    setActivePracticeFor(id);
    return (data as Practice) ?? null;
  }, []);

  const isAgencyUser = Boolean(agency);
  const isMultiPractice = accessiblePractices.length > 1;

  const resolvedPracticeId = useMemo(() => {
    const homeId = profile?.practice_id ?? null;
    const memberIds = accessiblePractices.map((p) => p.id);
    if (viewingPracticeId && memberIds.includes(viewingPracticeId)) return viewingPracticeId;
    if (homeId && memberIds.includes(homeId)) return homeId;
    if (homeId) return homeId;
    return memberIds[0] ?? null;
  }, [profile?.practice_id, accessiblePractices, viewingPracticeId]);

  const switchingPractice = isMultiPractice && Boolean(viewingPracticeId) && viewingPracticeId === resolvedPracticeId;

  useEffect(() => {
    if (!resolvedPracticeId) {
      setActivePractice(null);
      setActivePracticeFor(null);
      return;
    }
    void loadActivePractice(resolvedPracticeId);
  }, [resolvedPracticeId, loadActivePractice]);

  const profilePractice = normalizePractice(profile?.practice);
  const practice =
    activePractice?.id === resolvedPracticeId
      ? activePractice
      : profilePractice?.id === resolvedPracticeId
        ? profilePractice
        : accessiblePractices.find((p) => p.id === resolvedPracticeId) ?? profilePractice;
  const practiceId = resolvedPracticeId;

  const practiceContextPending = Boolean(resolvedPracticeId) && activePracticeFor !== resolvedPracticeId;

  const isSuperAdminEmail =
    (session?.user?.email || '').toLowerCase() === SUPER_ADMIN_EMAIL;

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
      : null);

  const isSuperAdmin = accessLevel === 'super_admin';
  const canBypassBaa = canBypassBaaGate(accessLevel);

  const isPracticeUser = Boolean(profile?.practice_id) || accessiblePractices.length > 0;
  const isAgencyOnly = isAgencyUser && !isPracticeUser;
  const isMobileSupported = isPracticeUser;
  const isSuspended = Boolean(practice?.archived_at);

  const viewPractice = useCallback((id: string) => {
    void deviceSetItem(VIEW_KEY, id);
    setViewingPracticeId(id);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? new Error(error.message) : null };
  }, []);

  const signOut = useCallback(async () => {
    await deviceDeleteItem(VIEW_KEY);
    setViewingPracticeId(null);
    setActivePractice(null);
    setActivePracticeFor(null);
    await supabase.auth.signOut();
    router.replace('/(guest)/login');
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!sessionUserId) return;
    await loadProfile(sessionUserId);
    if (viewingPracticeId) await loadActivePractice(viewingPracticeId);
  }, [sessionUserId, loadProfile, viewingPracticeId, loadActivePractice]);

  const isReady = !loading && (!sessionUserId || profileResolvedUserId === sessionUserId);
  const isLoggedIn = Boolean(session?.user);

  useEffect(() => {
    const email = session?.user?.email?.trim();
    const practiceName = practice?.name?.trim();
    if (!email || !practiceName) return;
    void saveRememberedLogin({
      email,
      practiceName,
      displayName: profile?.display_name || profile?.full_name || undefined,
    });
  }, [session?.user?.email, practice?.name, profile?.display_name, profile?.full_name]);

  const value = useMemo(
    (): AuthContextValue => ({
      session,
      user: session?.user ?? null,
      loading,
      isReady,
      isLoggedIn,
      profile,
      profileLoading,
      practice,
      practiceId,
      accessLevel,
      isAgencyUser,
      isAgencyOnly,
      isPracticeUser,
      isMobileSupported,
      isSuperAdmin,
      canBypassBaa,
      baaAccepted: Boolean(practice?.baa_accepted_at),
      onboardingCompleted: Boolean(practice?.onboarding_completed),
      practiceContextPending,
      isSuspended,
      isMultiPractice,
      accessiblePractices,
      viewPractice,
      signIn,
      signOut,
      refreshProfile,
    }),
    [
      session,
      loading,
      isReady,
      isLoggedIn,
      profile,
      profileLoading,
      practice,
      practiceId,
      accessLevel,
      isAgencyUser,
      isAgencyOnly,
      isPracticeUser,
      isMobileSupported,
      isSuperAdmin,
      canBypassBaa,
      practiceContextPending,
      isSuspended,
      isMultiPractice,
      accessiblePractices,
      viewPractice,
      signIn,
      signOut,
      refreshProfile,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
