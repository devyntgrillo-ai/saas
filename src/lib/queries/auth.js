import { useMutation } from '@tanstack/react-query'
import { supabase } from '../supabase'

export function useUpdatePassword() {
  return useMutation({
    mutationFn: async ({ password }) => {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      return {}
    },
  })
}
