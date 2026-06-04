import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { queryKeys } from './keys'

export async function fetchPracticeTeam(practiceId) {
  if (!practiceId) return { members: [], pending: [] }
  const [{ data: members, error: e1 }, { data: pending, error: e2 }] = await Promise.all([
    supabase.from('users').select('id, email, full_name, role, created_at').eq('practice_id', practiceId).order('created_at'),
    supabase
      .from('invitations')
      .select('id, email, role, created_at')
      .eq('practice_id', practiceId)
      .is('accepted_at', null)
      .order('created_at', { ascending: false }),
  ])
  if (e1 || e2) throw e1 || e2
  return { members: members || [], pending: pending || [] }
}

export function usePracticeTeam(practiceId) {
  return useQuery({
    queryKey: queryKeys.practiceTeam(practiceId),
    queryFn: () => fetchPracticeTeam(practiceId),
    enabled: Boolean(practiceId),
  })
}

export function useRemoveTeamMember() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, practiceId }) => {
      const { error } = await supabase.from('users').update({ practice_id: null }).eq('id', userId)
      if (error) throw error
      return { practiceId }
    },
    onSuccess: ({ practiceId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.practiceTeam(practiceId) })
    },
  })
}

export function useRevokeInvitation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ invitationId, practiceId }) => {
      const { error } = await supabase.from('invitations').delete().eq('id', invitationId)
      if (error) throw error
      return { practiceId }
    },
    onSuccess: ({ practiceId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.practiceTeam(practiceId) })
    },
  })
}
