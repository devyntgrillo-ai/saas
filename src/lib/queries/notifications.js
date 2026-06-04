import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchNotifications, markAllRead, markRead } from '../notifications'
import { queryKeys } from './keys'

export function useNotifications(practiceId) {
  return useQuery({
    queryKey: queryKeys.notifications(practiceId),
    queryFn: () => fetchNotifications(practiceId),
    enabled: Boolean(practiceId),
  })
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id }) => markRead(id),
    onSuccess: (_data, { practiceId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications(practiceId) })
    },
  })
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (practiceId) => markAllRead(practiceId),
    onSuccess: (_data, practiceId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications(practiceId) })
    },
  })
}
