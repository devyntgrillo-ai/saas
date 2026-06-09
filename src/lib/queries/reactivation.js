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

// Unscheduled treatment plans (recorded consults) presented between two dates,
// optionally narrowed to a set of treatment types. inActive flags those already
// in a live CaseLift sequence so the builder can exclude them.
export async function fetchReactivationAudience(practiceId, { startDate, endDate, treatmentTypes } = {}) {
  if (!practiceId) return []
  let q = supabase
    .from('consults')
    .select('id, patient_name, patient_first, patient_last, patient_phone, patient_email, treatment_type, case_value, created_at, recording_date, outcome, sequence_activated_at, sequence_cancelled_at')
    .eq('practice_id', practiceId)
  if (startDate) q = q.gte('created_at', new Date(startDate).toISOString())
  if (endDate) q = q.lte('created_at', new Date(`${endDate}T23:59:59`).toISOString())
  if (treatmentTypes && treatmentTypes.length) q = q.in('treatment_type', treatmentTypes)
  const { data, error } = await q.order('created_at', { ascending: false })
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
