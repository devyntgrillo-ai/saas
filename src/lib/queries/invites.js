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
