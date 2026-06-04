import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { queryKeys } from './keys'

export async function fetchPracticeReferrals(practiceId) {
  if (!practiceId) return { referrals: [], payouts: [] }
  const [r, p] = await Promise.all([
    supabase.rpc('my_referrals'),
    supabase.from('referral_payouts').select('amount, status'),
  ])
  if (r.error) throw r.error
  if (p.error) throw p.error
  return { referrals: r.data || [], payouts: p.data || [] }
}

export function usePracticeReferrals(practiceId) {
  return useQuery({
    queryKey: queryKeys.referrals(practiceId),
    queryFn: () => fetchPracticeReferrals(practiceId),
    enabled: Boolean(practiceId),
  })
}

export function useEnsureReferralCode() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (practiceId) => {
      const { data, error } = await supabase.rpc('ensure_referral_code')
      if (error) throw error
      return { code: data, practiceId }
    },
    onSuccess: ({ practiceId }) => {
      if (practiceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.referrals(practiceId) })
      }
    },
  })
}
