import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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

// Per-patient enrollment rows for a campaign's detail/results view. Joins the
// originating consult for its case value (recovered-production estimate).
export async function fetchCampaignEnrollments(campaignId) {
  if (!campaignId) return []
  const { data, error } = await supabase
    .from('reactivation_enrollments')
    .select('*, consult:consults(case_value)')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

export function useCampaignEnrollments(campaignId) {
  return useQuery({
    queryKey: ['reactivation-enrollments', campaignId],
    queryFn: () => fetchCampaignEnrollments(campaignId),
    enabled: Boolean(campaignId),
  })
}

export function useReactivationAudience(practiceId, filters, enabled = true) {
  return useQuery({
    queryKey: queryKeys.reactivationAudience(practiceId, filters),
    queryFn: () => fetchReactivationAudience(practiceId, filters),
    enabled: Boolean(practiceId) && enabled,
  })
}

export function useToggleReactivationCampaign() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ campaignId, practiceId, status }) => {
      const next = status === 'paused' ? 'active' : 'paused'
      const { error } = await supabase.from('reactivation_campaigns').update({ status: next }).eq('id', campaignId)
      if (error) throw error
      return { campaignId, practiceId, status: next }
    },
    onSuccess: ({ practiceId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.reactivation(practiceId) })
    },
  })
}

export function useUpdateEnrollmentNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ enrollmentId, campaignId, practiceId, notes }) => {
      const { error } = await supabase
        .from('reactivation_enrollments')
        .update({ notes: notes || null })
        .eq('id', enrollmentId)
      if (error) throw error
      return { enrollmentId, campaignId, practiceId }
    },
    onSuccess: ({ campaignId }) => {
      queryClient.invalidateQueries({ queryKey: ['reactivation-enrollments', campaignId] })
    },
  })
}

export function useToggleEnrollmentReopened() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ enrollment, campaign }) => {
      const reopened = !enrollment.reopened
      const { error } = await supabase
        .from('reactivation_enrollments')
        .update({ reopened, reopened_at: reopened ? new Date().toISOString() : null })
        .eq('id', enrollment.id)
      if (error) throw error
      const delta = reopened ? 1 : -1
      const val = Number(enrollment.case_value ?? enrollment.consult?.case_value) || 0
      const { error: e2 } = await supabase
        .from('reactivation_campaigns')
        .update({
          cases_reopened: Math.max(0, (campaign.cases_reopened || 0) + delta),
          recovered_estimate: Math.max(0, (campaign.recovered_estimate || 0) + delta * val),
        })
        .eq('id', campaign.id)
      if (e2) throw e2
      return { campaignId: campaign.id, practiceId: campaign.practice_id }
    },
    onSuccess: ({ campaignId, practiceId }) => {
      queryClient.invalidateQueries({ queryKey: ['reactivation-enrollments', campaignId] })
      queryClient.invalidateQueries({ queryKey: queryKeys.reactivation(practiceId) })
    },
  })
}

export function useRemoveEnrollment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ enrollmentId, campaign }) => {
      const { error } = await supabase.from('reactivation_enrollments').delete().eq('id', enrollmentId)
      if (error) throw error
      const { error: e2 } = await supabase
        .from('reactivation_campaigns')
        .update({ total_recipients: Math.max(0, (campaign.total_recipients || 1) - 1) })
        .eq('id', campaign.id)
      if (e2) throw e2
      return { campaignId: campaign.id, practiceId: campaign.practice_id }
    },
    onSuccess: ({ campaignId, practiceId }) => {
      queryClient.invalidateQueries({ queryKey: ['reactivation-enrollments', campaignId] })
      queryClient.invalidateQueries({ queryKey: queryKeys.reactivation(practiceId) })
    },
  })
}

export function useLaunchReactivationCampaign() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ practiceId, campaign, enrollments }) => {
      const { data: row, error } = await supabase
        .from('reactivation_campaigns')
        .insert(campaign)
        .select('id')
        .single()
      if (error) throw error
      for (let i = 0; i < enrollments.length; i += 200) {
        const chunk = enrollments.slice(i, i + 200).map((r) => ({ ...r, campaign_id: row.id }))
        const { error: e2 } = await supabase.from('reactivation_enrollments').insert(chunk)
        if (e2) throw e2
      }
      return { practiceId, campaignId: row.id }
    },
    onSuccess: ({ practiceId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.reactivation(practiceId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.reactivationAudience(practiceId) })
    },
  })
}
