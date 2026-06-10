import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  pauseSubscription,
  acceptDownsell,
  submitCancellationFeedback,
  cancelSubscription,
} from '../billing'
import { supabase } from '../supabase'
import { queryKeys } from './keys'

export function usePauseSubscription() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ practiceId, months }) => {
      const ends = await pauseSubscription(practiceId, months)
      return { months, ends }
    },
    onSuccess: (_, { practiceId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.practice(practiceId) })
    },
  })
}

export function useAcceptDownsell() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ practiceId }) => {
      await acceptDownsell(practiceId)
      return { practiceId }
    },
    onSuccess: (_, { practiceId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.practice(practiceId) })
    },
  })
}

export function useCancelSubscriptionFlow() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ practiceId, reason, elaboration, impact }) => {
      await submitCancellationFeedback({ practiceId, reason, elaboration, impact })
      await cancelSubscription(practiceId)
      return { practiceId }
    },
    onSuccess: (_, { practiceId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.practice(practiceId) })
    },
  })
}

export function useUpdateFreeMonth() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ practiceId, patch, current }) => {
      const next = { ...(current || {}), ...patch }
      const { error } = await supabase.from('practices').update({ free_month: next }).eq('id', practiceId)
      if (error) throw error
      return { practiceId, freeMonth: next }
    },
    onSuccess: ({ practiceId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.practice(practiceId) })
    },
  })
}

export function useUploadTestimonial() {
  return useMutation({
    mutationFn: async ({ practiceId, blob }) => {
      const path = `${practiceId}/${Date.now()}.webm`
      const { error: upErr } = await supabase.storage
        .from('testimonials')
        .upload(path, blob, { contentType: blob.type || 'video/webm', upsert: true })
      if (upErr) throw upErr
      supabase.functions
        .invoke('notify-testimonial', { body: { practice_id: practiceId, video_path: path } })
        .catch(() => {})
      return { path }
    },
  })
}

export function useReferFriend() {
  return useMutation({
    mutationFn: async ({ practiceId, friendName, friendEmail, subject, message }) => {
      const { data, error } = await supabase.functions.invoke('refer-friend', {
        body: {
          practice_id: practiceId,
          friend_name: friendName,
          friend_email: friendEmail,
          subject,
          message,
          app_origin: window.location.origin,
        },
      })
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Could not send the email.')
      return data
    },
  })
}
