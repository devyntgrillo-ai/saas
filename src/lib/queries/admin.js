import { useQuery } from '@tanstack/react-query'
import { loadAdminData } from '../admin'
import { fetchAttributionByPractice } from '../attribution'
import { fetchUnlinkedRegistrations } from '../pms'
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
      .select('id, email, role, access_level, created_at, display_name, job_title, practice:practices(id, name, agency_id)')
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
      'id, name, doctor_first, doctor_last, email, phone, pms_type, plan_amount, subscription_status, next_billing_date, trial_ends_at, created_at, chargebee_customer_id, agency:agency_accounts(name)',
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
