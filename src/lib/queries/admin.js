import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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

export async function fetchAdminBilling() {
  const { data, error } = await supabase
    .from('practices')
    .select(
      'id, name, doctor_first, doctor_last, email, phone, pms_type, plan_amount, subscription_status, next_billing_date, trial_ends_at, created_at, chargebee_customer_id, agency:agency_accounts(name)',
    )
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
    enabled: Boolean(practiceId) && !String(practiceId).startsWith('demo-'),
  })
}

function shapeAgency(r, practiceCount, emailById) {
  return {
    id: r.id,
    name: r.name,
    owner_email: r.owner_email || emailById[r.owner_user_id] || null,
    practices: practiceCount,
    mrr: Number(r.monthly_fee) || 0,
    white_labeled: r.white_label_enabled ?? r.white_labeled ?? r.is_white_labeled ?? false,
    active: r.active ?? (r.status ? r.status === 'active' : true),
    created_at: r.created_at,
  }
}

async function loadAgenciesDirect() {
  const { data: rows, error } = await supabase
    .from('agency_accounts')
    .select('*')
    .order('created_at', { ascending: true })
  if (error || !rows?.length) return []

  const { data: pr } = await supabase.from('practices').select('id, agency_id')
  const counts = {}
  ;(pr || []).forEach((x) => { if (x.agency_id) counts[x.agency_id] = (counts[x.agency_id] || 0) + 1 })

  const ownerIds = [...new Set(rows.map((r) => r.owner_user_id).filter(Boolean))]
  const emailById = {}
  if (ownerIds.length) {
    const { data: us } = await supabase.from('users').select('id, email').in('id', ownerIds)
    ;(us || []).forEach((u) => { emailById[u.id] = u.email })
  }
  return rows.map((r) => shapeAgency(r, counts[r.id] || 0, emailById))
}

async function loadPracticesDirect() {
  const since = new Date()
  since.setDate(since.getDate() - 30)
  const { data: rows, error } = await supabase
    .from('practices')
    .select('*, agency:agency_accounts(name)')
    .order('name')
  if (error || !rows?.length) return []

  const { data: consults } = await supabase
    .from('consults')
    .select('practice_id, created_at')
    .gte('created_at', since.toISOString())
  const byPractice = {}
  ;(consults || []).forEach((c) => { byPractice[c.practice_id] = (byPractice[c.practice_id] || 0) + 1 })

  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    agency_name: p.agency?.name || null,
    doctor:
      p.doctor_name ||
      [p.doctor_first, p.doctor_last].filter(Boolean).join(' ') ||
      null,
    consults_month: byPractice[p.id] || 0,
    subscription_status: p.subscription_status,
  }))
}

function deriveRevenue(agencies) {
  const total = agencies.reduce((s, a) => s + (Number(a.mrr) || 0), 0)
  return {
    total_mrr: total,
    new_signups_month: 0,
    churn_month: 0,
    by_agency: agencies.map((a) => ({ name: a.name, mrr: Number(a.mrr) || 0 })),
  }
}

export async function fetchAdminDashboard() {
  const [a, p, rev] = await Promise.all([
    supabase.rpc('admin_agencies'),
    supabase.rpc('admin_practices'),
    supabase.rpc('admin_revenue'),
  ])

  let agencies = a.error ? [] : a.data || []
  let practices = p.error ? [] : p.data || []
  let revenue = rev.error ? null : rev.data
  if (a.error || agencies.length === 0) agencies = await loadAgenciesDirect()
  if (p.error || practices.length === 0) practices = await loadPracticesDirect()
  if (!revenue) revenue = deriveRevenue(agencies)

  return { agencies, practices, revenue: revenue || {} }
}

export function useAdminDashboard(enabled = true) {
  return useQuery({
    queryKey: queryKeys.admin.dashboard(),
    queryFn: fetchAdminDashboard,
    enabled,
  })
}

export function useToggleAdminAgency() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, active }) => {
      const { error } = await supabase.from('agency_accounts').update({ active: !active }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.dashboard() })
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.data() })
    },
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
