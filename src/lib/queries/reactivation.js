import { useQuery } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { queryKeys } from './keys'

export async function fetchReactivationCampaigns(practiceId) {
  if (!practiceId) return []
  const { data, error } = await supabase
    .from('reactivation_campaigns')
    .select('*')
    .eq('practice_id', practiceId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export function useReactivationCampaigns(practiceId) {
  return useQuery({
    queryKey: queryKeys.reactivation(practiceId),
    queryFn: () => fetchReactivationCampaigns(practiceId),
    enabled: Boolean(practiceId),
  })
}

export async function fetchReactivationAudience(practiceId, { minDays, maxDays, objection, treatment }) {
  if (!practiceId) return []
  const max = new Date(Date.now() - maxDays * 86400000).toISOString()
  const min = new Date(Date.now() - minDays * 86400000).toISOString()
  let q = supabase
    .from('consults')
    .select('id, patient_name, patient_phone, patient_email, objection_type, treatment_type, case_value, created_at, recording_date, outcome, sequence_activated_at, sequence_cancelled_at')
    .eq('practice_id', practiceId)
    .gte('created_at', max)
    .lte('created_at', min)
  if (objection !== 'all') q = q.eq('objection_type', objection)
  if (treatment !== 'all') q = q.eq('treatment_type', treatment)
  const { data, error } = await q
  if (error) throw error
  return (data || []).map((c) => ({
    ...c,
    inActive: Boolean(c.sequence_activated_at) && !c.sequence_cancelled_at && c.outcome === 'pending',
  }))
}

export function useReactivationAudience(practiceId, filters, enabled = true) {
  return useQuery({
    queryKey: queryKeys.reactivationAudience(practiceId, filters),
    queryFn: () => fetchReactivationAudience(practiceId, filters),
    enabled: Boolean(practiceId) && enabled,
  })
}
