import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { queryKeys } from './keys'

export async function fetchInvitation(token) {
  if (!token) return null
  const { data, error } = await supabase.rpc('get_invitation', { p_token: token })
  if (error) throw error
  return data || null
}

export function useInvitation(token) {
  return useQuery({
    queryKey: queryKeys.invitation(token),
    queryFn: () => fetchInvitation(token),
    enabled: Boolean(token),
  })
}

export function useAcceptInvitationToken() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ token }) => {
      const { data, error } = await supabase.rpc('accept_invitation', { p_token: token })
      if (error) throw error
      if (!data?.ok) throw new Error(data?.error || 'Could not accept the invitation.')
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] })
    },
  })
}

export function useSendTeamInvite() {
  return useMutation({
    mutationFn: async ({
      email, role, scope, agencyId, practiceId, accessiblePracticeIds, personalMessage, invitedByUserId,
    }) => {
      const { data, error } = await supabase
        .from('invitations')
        .insert({
          email: email.trim().toLowerCase(),
          role,
          access_level: scope,
          agency_id: agencyId || null,
          practice_id: practiceId || null,
          accessible_practice_ids: accessiblePracticeIds,
          personal_message: personalMessage || null,
          invited_by_user_id: invitedByUserId,
        })
        .select('token')
        .single()
      if (error) throw error
      const inviteLink = `${window.location.origin}/invite/${data.token}`
      let emailSent = false
      let emailReason = ''
      try {
        const { data: fnData, error: fnErr } = await supabase.functions.invoke('invite-team-member', {
          body: { invitation_token: data.token, app_origin: window.location.origin },
        })
        if (fnErr) {
          emailReason = 'the email service errored'
        } else {
          emailSent = fnData?.email_sent === true
          emailReason = fnData?.reason ? `reason: ${fnData.reason}` : ''
        }
      } catch {
        emailReason = 'the email service is unreachable'
      }
      return { token: data.token, inviteLink, emailSent, emailReason }
    },
  })
}
