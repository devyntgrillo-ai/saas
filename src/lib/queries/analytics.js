import { useQuery } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { queryKeys } from './keys'

export async function fetchAnalyticsBundle(practiceId) {
  if (!practiceId) {
    return { consults: [], messages: [], messageOutcomes: [] }
  }

  const [{ data: consults, error: ce }, { data: messages, error: me }, { data: outcomes, error: oe }] =
    await Promise.all([
      supabase
        .from('consults')
        .select(
          'id, recording_date, status, outcome, objection_type, case_value, treatment_type, tx_plan_value, tx_plan_value_source, attribution_status',
        )
        .eq('practice_id', practiceId),
      supabase
        .from('messages')
        .select('consult_id, channel, status, scheduled_for, sent_at, created_at')
        .eq('practice_id', practiceId),
      supabase
        .from('message_outcomes')
        .select('message_position, message_channel, replied, closed_after, opened')
        .eq('practice_id', practiceId),
    ])

  if (ce || me || oe) throw ce || me || oe

  return {
    consults: consults || [],
    messages: messages || [],
    messageOutcomes: outcomes || [],
  }
}

export function useAnalytics(practiceId) {
  return useQuery({
    queryKey: queryKeys.analytics(practiceId),
    queryFn: () => fetchAnalyticsBundle(practiceId),
    enabled: Boolean(practiceId),
  })
}
