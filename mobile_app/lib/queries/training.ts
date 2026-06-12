import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queries/keys';

export async function fetchTrainingCatalog(userId?: string | null) {
  const [modulesRes, groupsRes, progressRes] = await Promise.all([
    supabase.from('training_modules').select('*').order('order_index', { ascending: true }),
    supabase.from('training_module_groups').select('*').order('order_index', { ascending: true }),
    userId
      ? supabase.from('training_progress').select('*').eq('user_id', userId)
      : supabase.from('training_progress').select('*').limit(0),
  ]);

  if (modulesRes.error) throw modulesRes.error;
  if (groupsRes.error) throw groupsRes.error;
  if ('error' in progressRes && progressRes.error) throw progressRes.error;

  const progress: Record<string, { completed_at?: string | null; progress?: number }> = {};
  for (const p of progressRes.data || []) progress[p.module_id] = p;

  return {
    modules: modulesRes.data || [],
    groups: groupsRes.data || [],
    progress,
  };
}

export function useTrainingCatalog(userId?: string | null) {
  return useQuery({
    queryKey: [...queryKeys.training.modules(), userId || 'anon'],
    queryFn: () => fetchTrainingCatalog(userId),
  });
}

export function useMarkTrainingComplete() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, moduleId }: { userId: string; moduleId: string }) => {
      const { error } = await supabase.from('training_progress').upsert(
        {
          user_id: userId,
          module_id: moduleId,
          progress: 100,
          completed_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,module_id' },
      );
      if (error) throw error;
      return { userId, moduleId };
    },
    onSuccess: ({ userId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.training.modules() });
      queryClient.invalidateQueries({ queryKey: queryKeys.training.progress(userId) });
    },
  });
}
