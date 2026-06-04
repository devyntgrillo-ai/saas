import { useQuery } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { queryKeys } from './keys'

export async function fetchAILearningEvents(practiceId, limit = 30) {
  if (!practiceId) return { events: [], monthCount: 0 }
  const start = new Date()
  start.setDate(1)
  start.setHours(0, 0, 0, 0)

  const [{ data: events, error: e1 }, { count, error: e2 }] = await Promise.all([
    supabase
      .from('ai_learning_events')
      .select('*')
      .eq('practice_id', practiceId)
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('ai_learning_events')
      .select('id', { count: 'exact', head: true })
      .eq('practice_id', practiceId)
      .gte('created_at', start.toISOString()),
  ])

  if (e1 || e2) throw e1 || e2
  return { events: events || [], monthCount: count || 0 }
}

export async function fetchAITip(practiceId) {
  if (!practiceId) return null
  const { data } = await supabase
    .from('ai_learning_events')
    .select('title, description, created_at')
    .eq('practice_id', practiceId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data || null
}

export function useAILearningEvents(practiceId, limit = 30) {
  return useQuery({
    queryKey: queryKeys.aiLearning(practiceId, limit),
    queryFn: () => fetchAILearningEvents(practiceId, limit),
    enabled: Boolean(practiceId),
  })
}

export function useAITip(practiceId) {
  return useQuery({
    queryKey: queryKeys.aiTip(practiceId),
    queryFn: () => fetchAITip(practiceId),
    enabled: Boolean(practiceId),
  })
}
