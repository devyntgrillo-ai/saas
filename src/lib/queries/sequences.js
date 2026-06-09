import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { queryKeys } from './keys'

const SEQUENCE_SELECT =
  'id, patient_name, patient_phone, patient_email, outcome, status, created_at, recording_date, duration, treatment_type, objection_type, primary_objection, exit_intent, exit_intent_level, urgency_classification, sequence_timing_preset, what_happened, coaching_insight, tc_action, personal_detail, sequence_activated_at, sequence_cancelled_at, sequence_cancelled_reason, sequence_status, sequence_paused_reason, messages(id, status, channel, type, subject, body, scheduled_for, send_day, sent_at, created_at, call_script, purpose, call_outcome, sequence_position)'

export async function fetchSequences(practiceId) {
  if (!practiceId) return []
  const { data, error } = await supabase
    .from('consults')
    .select(SEQUENCE_SELECT)
    .eq('practice_id', practiceId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).filter((c) => (c.messages || []).length > 0)
}

export async function fetchSequenceActiveCount(practiceId) {
  if (!practiceId) return 0
  const { count, error } = await supabase
    .from('consults')
    .select('id', { count: 'exact', head: true })
    .eq('practice_id', practiceId)
    .eq('sequence_status', 'active')
  if (error) throw error
  return count || 0
}

export function useSequences(practiceId) {
  return useQuery({
    queryKey: queryKeys.sequences(practiceId),
    queryFn: () => fetchSequences(practiceId),
    enabled: Boolean(practiceId),
    // Poll fallback so a just-analyzed consult's sequence appears even if the
    // realtime event is missed; realtime (useSequencesRealtime) is immediate.
    refetchInterval: 30000,
  })
}

export function useSequenceActiveCount(practiceId) {
  return useQuery({
    queryKey: queryKeys.sequenceActiveCount(practiceId),
    queryFn: () => fetchSequenceActiveCount(practiceId),
    enabled: Boolean(practiceId),
  })
}

export function useToggleSequenceStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ consultId, patch, practiceId }) => {
      const { error } = await supabase.from('consults').update(patch).eq('id', consultId)
      if (error) throw error
      return { practiceId }
    },
    onSuccess: ({ practiceId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sequences(practiceId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.sequenceActiveCount(practiceId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(practiceId) })
    },
  })
}

export function useUpdateSequenceMessage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ messageId, patch, practiceId }) => {
      const { error } = await supabase.from('messages').update(patch).eq('id', messageId)
      if (error) throw error
      return { practiceId }
    },
    onSuccess: ({ practiceId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sequences(practiceId) })
    },
  })
}
