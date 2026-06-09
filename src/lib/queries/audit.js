import { useQuery } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { queryKeys } from './keys'

const RANGES = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  all: null,
}

// Fetch audit rows for the given time range. RLS scopes the result automatically:
// a practice admin sees only their own practice's rows; a super-admin sees all.
// All other filtering (action / user / practice / PHI-only) happens client-side
// so the filter dropdowns stay stable as selections change.
export async function fetchAuditLog(range = '30d') {
  let query = supabase
    .from('audit_logs')
    .select('*, practice:practices(id, name)')
    .order('created_at', { ascending: false })
    .limit(1000)

  const days = RANGES[range]
  if (days) {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    query = query.gte('created_at', cutoff.toISOString())
  }

  const { data, error } = await query
  if (error) {
    console.warn('[audit] could not load audit_logs:', error.message)
    return []
  }

  return (data || []).map((row) => ({
    id: row.id,
    created_at: row.created_at,
    user_id: row.user_id ?? null,
    user_email: row.user_email ?? row.actor_email ?? row.actor?.email ?? null,
    practice_id: row.practice_id ?? null,
    practice_name: row.practice?.name ?? null,
    action: row.action ?? null,
    resource_type: row.resource_type ?? row.target_type ?? null,
    resource_id: row.resource_id ?? row.target_id ?? null,
    phi_accessed: Boolean(row.phi_accessed),
    ip_address: row.ip_address ?? null,
    user_agent: row.user_agent ?? null,
    details: row.details ?? null,
  }))
}

export function useAuditLog(range, enabled = true) {
  return useQuery({
    queryKey: queryKeys.audit(range),
    queryFn: () => fetchAuditLog(range),
    enabled,
  })
}
