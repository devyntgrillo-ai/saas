import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { queryKeys } from './keys'

export async function fetchKnowledgeBase(practiceId) {
  if (!practiceId) return { kb: null, lastUpdated: null }
  const { data, error } = await supabase
    .from('practices')
    .select('knowledge_base, knowledge_base_updated_at')
    .eq('id', practiceId)
    .maybeSingle()
  if (error) throw error
  return {
    kb: data?.knowledge_base ?? null,
    lastUpdated: data?.knowledge_base_updated_at ?? null,
  }
}

export function useKnowledgeBase(practiceId) {
  return useQuery({
    queryKey: queryKeys.knowledgeBase(practiceId),
    queryFn: () => fetchKnowledgeBase(practiceId),
    enabled: Boolean(practiceId),
  })
}

export function useSaveKnowledgeBase() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ practiceId, kb }) => {
      const now = new Date().toISOString()
      const { error } = await supabase
        .from('practices')
        .update({ knowledge_base: kb, knowledge_base_updated_at: now })
        .eq('id', practiceId)
      if (error) throw error
      return { practiceId, kb, lastUpdated: now }
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.knowledgeBase(data.practiceId), {
        kb: data.kb,
        lastUpdated: data.lastUpdated,
      })
    },
  })
}
