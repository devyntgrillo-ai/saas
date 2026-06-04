import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { queryKeys } from './keys'

export function useUpdatePractice() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ practiceId, patch }) => {
      const { error } = await supabase.from('practices').update(patch).eq('id', practiceId)
      if (error) throw error
      return { practiceId, patch }
    },
    onSuccess: ({ practiceId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.practice(practiceId) })
      queryClient.invalidateQueries({ queryKey: ['practice', practiceId] })
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(practiceId) })
    },
  })
}

export function useUpdateConsult() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ consultId, patch, practiceId }) => {
      const { error } = await supabase.from('consults').update(patch).eq('id', consultId)
      if (error) throw error
      return { consultId, practiceId }
    },
    onSuccess: ({ consultId, practiceId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.consult(consultId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.consultAttribution(consultId) })
      if (practiceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(practiceId) })
        queryClient.invalidateQueries({ queryKey: queryKeys.sequences(practiceId) })
        queryClient.invalidateQueries({ queryKey: queryKeys.conversations(practiceId) })
      }
    },
  })
}

export function useUpdateMessage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ messageId, patch, consultId }) => {
      const { error } = await supabase.from('messages').update(patch).eq('id', messageId)
      if (error) throw error
      return { messageId, consultId }
    },
    onSuccess: ({ consultId }) => {
      if (consultId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.consult(consultId) })
      }
    },
  })
}

export function useUpdateAgency() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ agencyId, patch }) => {
      const { error } = await supabase.from('agency_accounts').update(patch).eq('id', agencyId)
      if (error) throw error
      return { agencyId }
    },
    onSuccess: ({ agencyId }) => {
      queryClient.invalidateQueries({ queryKey: ['agency', agencyId] })
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.data() })
    },
  })
}
