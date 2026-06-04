import { useQuery } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { fetchOptOutCount } from '../messaging'
import { queryKeys } from './keys'

export async function fetchPlaudLastSync(practiceId) {
  if (!practiceId) return null
  const { data } = await supabase
    .from('consults')
    .select('created_at')
    .eq('practice_id', practiceId)
    .ilike('recording_source', 'plaud%')
    .order('created_at', { ascending: false })
    .limit(1)
  return data?.[0]?.created_at || null
}

export function usePlaudLastSync(practiceId) {
  return useQuery({
    queryKey: queryKeys.plaudLastSync(practiceId),
    queryFn: () => fetchPlaudLastSync(practiceId),
    enabled: Boolean(practiceId),
  })
}

export function useMessagingOptOuts(practiceId) {
  return useQuery({
    queryKey: queryKeys.messagingOptOuts(practiceId),
    queryFn: () => fetchOptOutCount(practiceId),
    enabled: Boolean(practiceId),
  })
}
