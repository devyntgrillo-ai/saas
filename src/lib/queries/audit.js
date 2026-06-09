import { useQuery } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { queryKeys } from './keys'

const RANGES = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  all: null,
}

export async function fetchAuditLog(range = '30d') {
  let query = supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(500)

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
    user_email: row.user_email ?? row.actor_email ?? row.actor?.email ?? null,
    action: row.action ?? null,
    resource_type: row.resource_type ?? row.target_type ?? null,
    resource_id: row.resource_id ?? row.target_id ?? null,
  }))
}

export function useAuditLog(range, enabled = true) {
  return useQuery({
    queryKey: queryKeys.audit(range),
    queryFn: () => fetchAuditLog(range),
    enabled,
  })
}

// On-demand HIPAA breach investigation (platform admin only). Calls the
// SECURITY DEFINER RPC that joins audit_logs -> practices -> consults for every
// PHI-access event in [startISO, endISO]. Bypasses the per-practice RLS via the
// function's is_platform_admin() guard; non-admins get a "not authorized" error.
export async function runBreachInvestigation(startISO, endISO) {
  const { data, error } = await supabase.rpc('breach_investigation', {
    window_start: startISO,
    window_end: endISO,
  })
  if (error) throw error
  return data || []
}
