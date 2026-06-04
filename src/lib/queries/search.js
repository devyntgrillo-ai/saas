import { useQuery } from '@tanstack/react-query'
import { globalSearch } from '../search'
import { queryKeys } from './keys'

export function useGlobalSearch(practiceId, term, enabled = true) {
  const q = term.trim()
  return useQuery({
    queryKey: queryKeys.globalSearch(practiceId, q),
    queryFn: () => globalSearch(practiceId, q),
    enabled: Boolean(practiceId && q && enabled),
    staleTime: 10_000,
  })
}
