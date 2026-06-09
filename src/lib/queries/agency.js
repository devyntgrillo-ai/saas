import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { fetchRecordingRate } from '../pms'
import { queryKeys } from './keys'

export async function fetchAgencyPractices(agencyId) {
  if (!agencyId) return []
  const { data, error } = await supabase
    .from('practices')
    .select('*')
    .eq('agency_id', agencyId)
    .is('archived_at', null)
    .order('name')
  if (error) throw error
  return data || []
}

function startOfMonthISODate() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export async function fetchAgencyPracticeMetrics(practiceId) {
  const monthStart = startOfMonthISODate()
  const [consults, followUps, active, lastConsult, lastMessage] = await Promise.all([
    supabase.from('consults').select('id', { count: 'exact', head: true })
      .eq('practice_id', practiceId).gte('recording_date', monthStart),
    supabase.from('messages').select('id', { count: 'exact', head: true })
      .eq('practice_id', practiceId).in('status', ['sent', 'opened', 'replied']),
    supabase.from('consults').select('id', { count: 'exact', head: true })
      .eq('practice_id', practiceId).eq('status', 'active'),
    supabase.from('consults').select('created_at').eq('practice_id', practiceId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('messages').select('created_at').eq('practice_id', practiceId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  const times = [lastConsult.data?.created_at, lastMessage.data?.created_at].filter(Boolean)
  const lastActivity = times.length ? times.sort().at(-1) : null
  let recordingRate = null
  try {
    recordingRate = (await fetchRecordingRate(practiceId, 4)).current
  } catch {
    /* non-critical */
  }
  return {
    consults: consults.count || 0,
    followUps: followUps.count || 0,
    active: active.count || 0,
    lastActivity,
    recordingRate,
  }
}

export async function fetchAgencyOverview(agencyId) {
  if (!agencyId) return { practices: [], metrics: {} }
  // Includes archived_at (not filtered here) so the overview can show an
  // "archived" toggle + restore. Active vs. archived is split in the UI.
  const { data, error } = await supabase
    .from('practices')
    .select('id, name, doctor_first, doctor_last, baa_accepted_at, archived_at, subscription_status')
    .eq('agency_id', agencyId)
    .order('created_at', { ascending: true })
  if (error) throw error
  const practices = data || []
  const live = practices.filter((p) => !p.archived_at)
  // Metrics only for active (non-archived) practices.
  const entries = await Promise.all(
    live.map(async (p) => [p.id, await fetchAgencyPracticeMetrics(p.id)]),
  )

  // Roll-up KPIs the reseller cares about: how many active subaccounts, and the
  // production their subaccounts have recovered (closed-won / recovered cases).
  const ids = live.map((p) => p.id)
  let recovered = 0
  if (ids.length) {
    const { data: cons } = await supabase
      .from('consults')
      .select('case_value, status')
      .in('practice_id', ids)
      .in('status', ['closed_won', 'recovered'])
    recovered = (cons || []).reduce((s, c) => s + (Number(c.case_value) || 0), 0)
  }
  const rollup = {
    totalCount: live.length,
    activeCount: live.filter((p) => p.subscription_status === 'active').length,
    recovered,
  }

  return { practices, metrics: Object.fromEntries(entries), rollup }
}

export function useAgencyOverview(agencyId) {
  return useQuery({
    queryKey: queryKeys.agency.overview(agencyId),
    queryFn: () => fetchAgencyOverview(agencyId),
    enabled: Boolean(agencyId),
  })
}

export async function fetchAgencyAnalytics(agencyId) {
  const practices = await fetchAgencyPractices(agencyId)
  const ids = practices.map((p) => p.id)
  if (!ids.length) return { practices, consults: [] }
  const { data: consults, error } = await supabase
    .from('consults')
    .select('id, practice_id, status, recording_date, case_value')
    .in('practice_id', ids)
  if (error) throw error
  return { practices, consults: consults || [] }
}

export async function fetchAgencyTeam(agencyId) {
  if (!agencyId) return { members: [], pending: [], practices: [] }
  const [{ data: members }, { data: pending }, { data: practices }] = await Promise.all([
    supabase
      .from('agency_members')
      .select('id, role, accessible_practice_ids, user_id, user:users(email)')
      .eq('agency_id', agencyId),
    supabase
      .from('invitations')
      .select('*')
      .eq('agency_id', agencyId)
      .is('accepted_at', null)
      .order('created_at', { ascending: false }),
    supabase.from('practices').select('id, name').eq('agency_id', agencyId).is('archived_at', null).order('name'),
  ])
  return {
    members: members || [],
    pending: pending || [],
    practices: practices || [],
  }
}

export async function fetchAgencySaasClients(agencyId) {
  if (!agencyId) return []
  const { data, error } = await supabase
    .from('practices')
    .select('id, name, created_at, subscription_status, trial_ends_at')
    .eq('agency_id', agencyId)
    .is('archived_at', null)
    .order('name')
  if (error) throw error
  return data || []
}

export function useAgencyPractices(agencyId) {
  return useQuery({
    queryKey: queryKeys.agency.practices(agencyId),
    queryFn: () => fetchAgencyPractices(agencyId),
    enabled: Boolean(agencyId),
  })
}

export function useAgencyAnalytics(agencyId) {
  return useQuery({
    queryKey: queryKeys.agency.analytics(agencyId),
    queryFn: () => fetchAgencyAnalytics(agencyId),
    enabled: Boolean(agencyId),
  })
}

export function useAgencyTeam(agencyId) {
  return useQuery({
    queryKey: queryKeys.agency.team(agencyId),
    queryFn: () => fetchAgencyTeam(agencyId),
    enabled: Boolean(agencyId),
  })
}

export function useAgencySaasClients(agencyId) {
  return useQuery({
    queryKey: queryKeys.agency.saasClients(agencyId),
    queryFn: () => fetchAgencySaasClients(agencyId),
    enabled: Boolean(agencyId),
  })
}

export function useAgencyKbPractices(agencyId) {
  return useQuery({
    queryKey: queryKeys.agency.kbPractices(agencyId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('practices')
        .select('id, name')
        .eq('agency_id', agencyId)
        .is('archived_at', null)
        .order('name')
      if (error) throw error
      return data || []
    },
    enabled: Boolean(agencyId),
  })
}

export function useRemoveAgencyMember() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ memberId, agencyId }) => {
      const { error } = await supabase.from('agency_members').delete().eq('id', memberId)
      if (error) throw error
      return { agencyId }
    },
    onSuccess: ({ agencyId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agency.team(agencyId) })
    },
  })
}

export function useCancelAgencyInvitation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ invitationId, agencyId }) => {
      const { error } = await supabase.from('invitations').delete().eq('id', invitationId)
      if (error) throw error
      return { agencyId }
    },
    onSuccess: ({ agencyId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agency.team(agencyId) })
    },
  })
}
