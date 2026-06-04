import { useQuery } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { fetchRecentCalls } from '../voice'
import { queryKeys } from './keys'

export async function fetchPowerDialerQueue(practiceId) {
  if (!practiceId) return []
  const endToday = new Date()
  endToday.setHours(23, 59, 59, 999)
  const { data, error } = await supabase
    .from('messages')
    .select(
      'id, consult_id, send_day, scheduled_for, status, channel, type, consults(id, patient_name, patient_phone, patient_email, objection_type, exit_intent_level, personal_detail, tc_action, recording_date, created_at)',
    )
    .eq('practice_id', practiceId)
    .or('channel.eq.call,type.eq.call')
    .in('status', ['scheduled', 'pending', 'draft'])
    .lte('scheduled_for', endToday.toISOString())
    .order('scheduled_for', { ascending: true })
  if (error) throw error
  return (data || []).filter((m) => m.consults && m.consults.patient_phone)
}

export function usePowerDialerQueue(practiceId) {
  return useQuery({
    queryKey: queryKeys.powerDialer.queue(practiceId),
    queryFn: () => fetchPowerDialerQueue(practiceId),
    enabled: Boolean(practiceId),
  })
}

export function useRecentCalls(practiceId) {
  return useQuery({
    queryKey: queryKeys.powerDialer.recentCalls(practiceId),
    queryFn: () => fetchRecentCalls(practiceId),
    enabled: Boolean(practiceId),
  })
}
