import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { fetchTrainingRecommendation } from '../insights'
import { queryKeys } from './keys'

export async function fetchTrainingCatalog(userId) {
  const [modulesRes, groupsRes, progressRes] = await Promise.all([
    supabase.from('training_modules').select('*').order('order_index', { ascending: true }),
    supabase.from('training_module_groups').select('*').order('order_index', { ascending: true }),
    userId
      ? supabase.from('training_progress').select('*').eq('user_id', userId)
      : Promise.resolve({ data: [] }),
  ])

  if (modulesRes.error) throw modulesRes.error
  if (groupsRes.error) throw groupsRes.error
  if (progressRes.error) throw progressRes.error

  const progress = {}
  for (const p of progressRes.data || []) progress[p.module_id] = p

  return {
    modules: modulesRes.data || [],
    groups: groupsRes.data || [],
    progress,
  }
}

export function useTrainingCatalog(userId) {
  return useQuery({
    queryKey: [...queryKeys.training.modules(), userId || 'anon'],
    queryFn: () => fetchTrainingCatalog(userId),
  })
}

export function useTrainingRecommendation(practiceId) {
  return useQuery({
    queryKey: queryKeys.training.recommendation(practiceId),
    queryFn: () => fetchTrainingRecommendation(practiceId),
    enabled: Boolean(practiceId),
    staleTime: 60_000,
  })
}

export function useMarkTrainingComplete() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, moduleId }) => {
      const { error } = await supabase.from('training_progress').upsert(
        {
          user_id: userId,
          module_id: moduleId,
          progress: 100,
          completed_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,module_id' },
      )
      if (error) throw error
      return { userId, moduleId }
    },
    onSuccess: ({ userId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.training.modules() })
      queryClient.invalidateQueries({ queryKey: queryKeys.training.progress(userId) })
    },
  })
}
