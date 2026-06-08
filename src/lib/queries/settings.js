import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { queryKeys } from './keys'

export async function fetchPracticeTeam(practiceId) {
  if (!practiceId) return { members: [], pending: [] }
  const [{ data: members, error: e1 }, { data: pending, error: e2 }] = await Promise.all([
    supabase.from('users').select('id, email, role, created_at, display_name, avatar_url').eq('practice_id', practiceId).order('created_at'),
    supabase
      .from('invitations')
      .select('id, email, role, created_at, token')
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

// Resend a pending invite by re-invoking the edge function with its existing
// token (no new invitations row). Returns the function result so the caller can
// surface whether the email actually went out vs. needs the share link.
export function useResendInvitation() {
  return useMutation({
    mutationFn: async ({ token }) => {
      const { data, error } = await supabase.functions.invoke('invite-team-member', {
        body: { invitation_token: token, app_origin: window.location.origin },
      })
      if (error) throw error
      return data
    },
  })
}
