import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { cancelSubscription } from '../billing'
import { insertAgencyAccount, loadAdminData } from '../admin'
import { fetchAttributionByPractice } from '../attribution'
import { fetchUnlinkedRegistrations, saveSikkaConfig } from '../pms'
import { supabase } from '../supabase'
import { queryKeys } from './keys'

export function useAdminData() {
  return useQuery({
    queryKey: queryKeys.admin.data(),
    queryFn: () => loadAdminData(),
  })
}

// All users across every subaccount + reseller (super-admin master view). Uses
// the super-admin SELECT RLS on users; agency memberships are merged in by id.
export async function fetchAdminUsers() {
  const [{ data: users, error: ue }, { data: members }] = await Promise.all([
    supabase
      .from('users')
      .select('*, practice:practices(id, name, agency_id)')
      .order('created_at', { ascending: false }),
    supabase.from('agency_members').select('user_id, role, agency:agency_accounts(id, name)'),
  ])
  if (ue) throw ue
  const byUser = {}
  for (const m of members || []) (byUser[m.user_id] ||= []).push(m)
  return (users || []).map((u) => ({ ...u, agencies: byUser[u.id] || [] }))
}

export function useAdminUsers() {
  return useQuery({ queryKey: ['admin-users'], queryFn: fetchAdminUsers })
}

export async function fetchAdminBilling() {
  const { data, error } = await supabase
    .from('practices')
    .select(
      'id, name, doctor_first, doctor_last, email, phone, pms_type, plan_amount, subscription_status, next_billing_date, trial_ends_at, created_at, helcim_customer_code, helcim_transaction_id, agency:agency_accounts(name)',
    )
    .is('archived_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export function useAdminBilling() {
  return useQuery({
    queryKey: queryKeys.admin.billing(),
    queryFn: fetchAdminBilling,
  })
}

export async function fetchAdminReferrals() {
  const [{ data: relationships, error: e1 }, { data: payouts, error: e2 }] = await Promise.all([
    supabase.rpc('admin_referrals'),
    supabase.rpc('admin_referral_payouts'),
  ])
  if (e1) throw e1
  if (e2) throw e2
  return { relationships: relationships || [], payouts: payouts || [] }
}

export function useAdminReferrals() {
  return useQuery({
    queryKey: queryKeys.admin.referrals(),
    queryFn: fetchAdminReferrals,
  })
}

export async function fetchAdminTraining() {
  const [{ data: lessons }, { data: groups }, { data: lastPush }] = await Promise.all([
    supabase.from('training_modules').select('*').order('sort_order'),
    supabase.from('training_module_groups').select('*').order('sort_order'),
    supabase.from('training_push_log').select('*').order('created_at', { ascending: false }).limit(1),
  ])
  return {
    lessons: lessons || [],
    groups: groups || [],
    lastPush: lastPush?.[0] || null,
  }
}

export function useAdminTraining() {
  return useQuery({
    queryKey: queryKeys.admin.training(),
    queryFn: fetchAdminTraining,
  })
}

export async function fetchAdminAgenciesSaas() {
  const [{ data: agencies }, { data: practices }] = await Promise.all([
    supabase.from('agency_accounts').select('*').order('name'),
    supabase.from('practices').select('id, name, agency_id, subscription_status').not('agency_id', 'is', null),
  ])
  return { agencies: agencies || [], practices: practices || [] }
}

export function useAdminAgenciesSaas() {
  return useQuery({
    queryKey: queryKeys.admin.agenciesSaas(),
    queryFn: fetchAdminAgenciesSaas,
  })
}

export function useAdminAttribution() {
  return useQuery({
    queryKey: queryKeys.admin.attribution(),
    queryFn: () => fetchAttributionByPractice(),
  })
}

export function useAdminPracticeConsults(practiceId) {
  return useQuery({
    queryKey: queryKeys.admin.practiceConsults(practiceId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('consults')
        .select('id, status, recording_date, created_at, primary_objection')
        .eq('practice_id', practiceId)
        .order('created_at', { ascending: false })
        .limit(10)
      if (error) throw error
      return data || []
    },
    enabled: Boolean(practiceId),
  })
}

export async function fetchAdminTrainingPage() {
  const [lr, pr, gr] = await Promise.all([
    supabase.from('training_modules').select('*').order('order_index', { ascending: true }),
    supabase.from('training_push_log').select('*').order('pushed_at', { ascending: false }).limit(1),
    supabase.from('training_module_groups').select('*').order('order_index', { ascending: true }),
  ])
  if (lr.error) throw lr.error
  return {
    lessons: lr.data || [],
    lastPush: pr.data?.[0] || null,
    groups: gr.data || [],
  }
}

export function useAdminTrainingPage() {
  return useQuery({
    queryKey: [...queryKeys.admin.training(), 'page'],
    queryFn: fetchAdminTrainingPage,
  })
}

export async function fetchAdminPracticePms(practiceId) {
  const [{ data: row }, regs] = await Promise.all([
    supabase
      .from('practices')
      .select('id, sikka_practice_id, pms_type, sikka_connected, pms_last_synced_at')
      .eq('id', practiceId)
      .maybeSingle(),
    fetchUnlinkedRegistrations(),
  ])
  return { row: row || {}, regs: regs || [] }
}

export function useAdminPracticePms(practiceId) {
  return useQuery({
    queryKey: queryKeys.admin.practicePms(practiceId),
    queryFn: () => fetchAdminPracticePms(practiceId),
    enabled: Boolean(practiceId),
  })
}

export function useToggleAgencySuspended() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ agencyId, currentlySuspended }) => {
      const patch = currentlySuspended
        ? { status: 'active', active: true }
        : { status: 'suspended', active: false }
      const { error } = await supabase.from('agency_accounts').update(patch).eq('id', agencyId)
      if (error) throw error
      return { agencyId }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.data() })
    },
  })
}

export function useUpdateAgencyCommission() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ agencyId, commissionRate }) => {
      const { error } = await supabase
        .from('agency_accounts')
        .update({ commission_rate: commissionRate })
        .eq('id', agencyId)
      if (error) throw error
      return { agencyId }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.data() })
    },
  })
}

export function useCreateAgencyAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ payload, invite }) => {
      const agency = await insertAgencyAccount(payload)
      if (invite?.email) {
        const { data, error: inviteErr } = await supabase.functions.invoke('admin-users', {
          body: {
            action: 'invite',
            email: invite.email,
            access: 'reseller',
            role: 'owner',
            agency_id: agency.id,
            app_origin: invite.appOrigin,
          },
        })
        if (inviteErr) throw new Error(data?.error || inviteErr.message || 'Invite failed.')
        if (data?.user_id) {
          await supabase.from('agency_accounts').update({ owner_user_id: data.user_id }).eq('id', agency.id)
        }
        return { agency, inviteLink: data?.invite_link && !data?.email_sent ? data.invite_link : null }
      }
      return { agency, inviteLink: null }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.data() })
    },
  })
}

export function useAssignReferredPractice() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ practiceId, agencyId }) => {
      const { data, error } = await supabase.functions.invoke('assign-referred-practice', {
        body: { practice_id: practiceId, agency_id: agencyId },
      })
      if (error) throw new Error(data?.error || error.message)
      if (data?.error) throw new Error(data.error)
      return { agencyId }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.data() })
    },
  })
}

export function useUpdateAgencyAdminNotes() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ agencyId, notes }) => {
      const { error } = await supabase.from('agency_accounts').update({ admin_notes: notes }).eq('id', agencyId)
      if (error) throw error
      return { agencyId }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.data() })
    },
  })
}

export function useMarkSupportChatResolved() {
  return useMutation({
    mutationFn: async ({ chatId, resolved }) => {
      const { error } = await supabase
        .from('support_chats')
        .update({ resolved_at: resolved ? new Date().toISOString() : null })
        .eq('id', chatId)
      if (error) throw error
      return { chatId, resolved }
    },
  })
}

export function useExtendPracticeTrial() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ practiceId, trialEndsAt }) => {
      const { error } = await supabase
        .from('practices')
        .update({ trial_ends_at: trialEndsAt })
        .eq('id', practiceId)
      if (error) throw error
      return { practiceId }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.billing() })
    },
  })
}

export function useMarkReferralPayoutPaid() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ payoutId }) => {
      const { error } = await supabase.rpc('admin_mark_payout_paid', { p_payout_id: payoutId })
      if (error) throw error
      return { payoutId }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.referrals() })
    },
  })
}

export function useCancelPracticeSubscription() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ practiceId }) => {
      await cancelSubscription(practiceId)
      return { practiceId }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.billing() })
    },
  })
}

export function useAdminUserAction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload) => {
      const { data, error } = await supabase.functions.invoke('admin-users', { body: payload })
      if (error) throw new Error(data?.error || error.message)
      if (data?.error) throw new Error(data.error)
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.data() })
    },
  })
}

export function useSaveSikkaConfig() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ practiceId, config }) => {
      await saveSikkaConfig(practiceId, {
        sikkaPracticeId: config.sikka_practice_id,
        pmsType: config.pms_type,
        sikkaConnected: config.sikka_connected,
      })
      return { practiceId }
    },
    onSuccess: ({ practiceId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.practicePms(practiceId) })
    },
  })
}

export function useForceCancelPractice() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ practiceId }) => {
      const { error } = await supabase
        .from('practices')
        .update({ subscription_status: 'cancelled' })
        .eq('id', practiceId)
      if (error) throw error
      return { practiceId }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.data() })
    },
  })
}

export function useUpdatePracticeAdminNotes() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ practiceId, notes }) => {
      const { error } = await supabase.from('practices').update({ admin_notes: notes }).eq('id', practiceId)
      if (error) throw error
      return { practiceId }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.data() })
    },
  })
}

export function useResendAgencyOwnerInvite() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ agencyId, ownerEmail }) => {
      const { data, error: e } = await supabase.functions.invoke('admin-users', {
        body: {
          action: 'invite',
          email: ownerEmail.trim().toLowerCase(),
          access: 'reseller',
          role: 'owner',
          agency_id: agencyId,
          app_origin: window.location.origin,
        },
      })
      if (e) throw new Error(data?.error || e.message)
      if (data?.user_id) {
        await supabase.from('agency_accounts').update({ owner_user_id: data.user_id }).eq('id', agencyId)
      }
      return {
        agencyId,
        emailSent: Boolean(data?.email_sent),
        inviteLink: data?.invite_link && !data?.email_sent ? data.invite_link : null,
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.data() })
    },
  })
}
