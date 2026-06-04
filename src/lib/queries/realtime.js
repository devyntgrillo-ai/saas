import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { queryKeys } from './keys'

/** Invalidate conversation list + active thread when postgres changes fire. */
export function useConversationsRealtime(practiceId, activeConversationId) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!practiceId) return

    const channel = supabase
      .channel(`conversations:${practiceId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'conversation_messages' },
        (payload) => {
          const msg = payload.new
          if (!msg?.conversation_id) return
          queryClient.invalidateQueries({ queryKey: queryKeys.conversations(practiceId) })
          if (msg.conversation_id === activeConversationId) {
            queryClient.invalidateQueries({
              queryKey: queryKeys.conversationThread(practiceId, activeConversationId),
            })
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'conversations',
          filter: `practice_id=eq.${practiceId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.conversations(practiceId) })
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'conversations',
          filter: `practice_id=eq.${practiceId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.conversations(practiceId) })
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [practiceId, activeConversationId, queryClient])
}

/** Invalidate notifications when the bell's table changes. */
export function useNotificationsRealtime(practiceId) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!practiceId) return

    const channel = supabase
      .channel(`notifications:${practiceId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `practice_id=eq.${practiceId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.notifications(practiceId) })
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [practiceId, queryClient])
}
