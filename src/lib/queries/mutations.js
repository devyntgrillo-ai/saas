import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { queryKeys } from './keys'
import { patchConversationContextConsult } from './conversations'

export async function cancelPendingMessages(consultId) {
  const { error } = await supabase
    .from('messages')
    .update({ status: 'cancelled' })
    .eq('consult_id', consultId)
    .in('status', ['draft', 'scheduled', 'pending'])
  if (error) throw error
}

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

export function useSetConsultOutcome() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ consultId, patch, practiceId, cancelMessages = false }) => {
      if (cancelMessages) await cancelPendingMessages(consultId)
      const { error } = await supabase.from('consults').update(patch).eq('id', consultId)
      if (error) throw error
      return { consultId, practiceId, patch }
    },
    onSuccess: ({ consultId, practiceId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.consult(consultId) })
      if (practiceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(practiceId) })
        queryClient.invalidateQueries({ queryKey: queryKeys.sequences(practiceId) })
        queryClient.invalidateQueries({ queryKey: queryKeys.conversations(practiceId) })
      }
    },
  })
}

export function useArchivePractice() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ practiceId, agencyId, archive, userId }) => {
      const patch = archive
        ? { archived_at: new Date().toISOString(), archived_by: userId ?? null }
        : { archived_at: null, archived_by: null }
      const { error } = await supabase.from('practices').update(patch).eq('id', practiceId)
      if (error) throw error
      return { practiceId, agencyId }
    },
    onSuccess: ({ practiceId, agencyId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.practice(practiceId) })
      if (agencyId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.agency.overview(agencyId) })
        queryClient.invalidateQueries({ queryKey: queryKeys.agency.practices(agencyId) })
      }
    },
  })
}

export function useUploadAgencyAsset() {
  return useMutation({
    mutationFn: async ({ agencyId, kind, file }) => {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase()
      const path = `${agencyId}/${kind}.${ext}`
      const { error } = await supabase.storage
        .from('reseller-assets')
        .upload(path, file, { contentType: file.type, upsert: true })
      if (error) throw error
      const { data } = supabase.storage.from('reseller-assets').getPublicUrl(path)
      const url = `${data.publicUrl}?v=${file.size}`
      const COLUMN = { logo_dark: 'logo_url_dark', logo_light: 'logo_url_light', favicon: 'favicon_url' }
      return { kind, url, column: COLUMN[kind] || 'logo_url' }
    },
  })
}

export function useSaveResellerBrand() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ agencyId, patch }) => {
      const { data: res, error } = await supabase.functions.invoke('save-reseller-brand', {
        body: { agency_id: agencyId, patch },
      })
      if (error) throw error
      if (res?.error) throw new Error(res.error)
      return { agencyId, patch }
    },
    onSuccess: ({ agencyId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agency.overview(agencyId) })
    },
  })
}

export function useMarkConsultConverted() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ consultId, practiceId, conversationId, caseValue, patientName }) => {
      const val = Number(String(caseValue).replace(/[^0-9.]/g, '')) || null
      const patch = {
        outcome: 'closed_won',
        status: 'closed_won',
        case_value: val,
        closed_at: new Date().toISOString(),
        attribution_status: 'caselift_recovered',
        sequence_status: 'cancelled',
      }
      await cancelPendingMessages(consultId)
      const { error } = await supabase.from('consults').update(patch).eq('id', consultId)
      if (error) throw error
      if (practiceId) {
        supabase
          .from('notifications')
          .insert({
            practice_id: practiceId,
            type: 'case_converted',
            event: 'case_converted',
            title: 'Case converted',
            message: `${patientName || 'Patient'} accepted treatment${val ? ` - $${val.toLocaleString()} recovered` : ''}`,
            link: `/consults/${consultId}`,
          })
          .then(() => {}, () => {})
      }
      return { consultId, practiceId, conversationId, patch }
    },
    onSuccess: ({ consultId, practiceId, conversationId, patch }) => {
      if (practiceId && conversationId) {
        patchConversationContextConsult(queryClient, practiceId, conversationId, patch)
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.consult(consultId) })
      if (practiceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.conversations(practiceId) })
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(practiceId) })
      }
    },
  })
}

export function useAcceptBaa() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ practiceId }) => {
      const { error } = await supabase
        .from('practices')
        .update({ baa_accepted_at: new Date().toISOString() })
        .eq('id', practiceId)
      if (error) throw error
      return { practiceId }
    },
    onSuccess: ({ practiceId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.practice(practiceId) })
    },
  })
}

export function useMarkConsultNotConverting() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ consultId, practiceId, conversationId }) => {
      const patch = { outcome: 'not_converting', sequence_status: 'cancelled' }
      await cancelPendingMessages(consultId)
      const { error } = await supabase.from('consults').update(patch).eq('id', consultId)
      if (error) throw error
      return { consultId, practiceId, conversationId, patch }
    },
    onSuccess: ({ consultId, practiceId, conversationId, patch }) => {
      if (practiceId && conversationId) {
        patchConversationContextConsult(queryClient, practiceId, conversationId, patch)
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.consult(consultId) })
      if (practiceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.conversations(practiceId) })
      }
    },
  })
}
