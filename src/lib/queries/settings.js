import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { updateMyProfile, uploadAvatar } from '../profile'
import { supabase } from '../supabase'
import { queryKeys } from './keys'

export async function fetchPracticeTeam(practiceId) {
  if (!practiceId) return { members: [], pending: [] }
  const [{ data: members, error: e1 }, { data: pending, error: e2 }] = await Promise.all([
    supabase.from('users').select('*').eq('practice_id', practiceId).order('created_at'),
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
      // RLS only lets a user update their OWN row, so a direct client update of
      // another user silently no-ops. Go through the SECURITY DEFINER RPC, which
      // authorizes the caller (owner/admin/super-admin) and unlinks the member.
      const { data, error } = await supabase.rpc('remove_practice_member', { p_user_id: userId })
      if (error) throw error
      if (!data?.ok) throw new Error(data?.error || 'Could not remove member')
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
    mutationFn: async ({ token, invitationId }) => {
      const { data, error } = await supabase.functions.invoke('invite-team-member', {
        body: { invitation_token: token, app_origin: window.location.origin },
      })
      if (error) throw error
      return { ...data, invitationId }
    },
  })
}

export function useSendTestDigest() {
  return useMutation({
    mutationFn: async ({ practiceId }) => {
      const { error } = await supabase.functions.invoke('send-weekly-digest', {
        body: { practice_id: practiceId },
      })
      if (error) throw error
      return { practiceId }
    },
  })
}

export function useUpdateMyProfile() {
  return useMutation({
    mutationFn: async ({ userId, displayName, avatarUrl, jobTitle, file }) => {
      let url = avatarUrl
      if (file) url = await uploadAvatar(userId, file)
      await updateMyProfile({ displayName, avatarUrl: url, jobTitle })
      return { displayName, avatarUrl: url, jobTitle }
    },
  })
}
