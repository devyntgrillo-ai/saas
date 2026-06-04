import { useQuery } from '@tanstack/react-query'
import { supabase } from '../supabase'

export function useResellerSignup(slug) {
  return useQuery({
    queryKey: ['reseller-signup', slug],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_reseller_signup', { p_slug: slug })
      if (error || !data) throw error || new Error('Reseller not found')
      return data
    },
    enabled: Boolean(slug),
    retry: false,
  })
}
