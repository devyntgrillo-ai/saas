import { useQuery } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { fetchDashboardExtras } from '../dashboard'
import { fetchNetworkComparison } from '../insights'
import { queryKeys } from './keys'

function startOfWeek() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  const day = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - day)
  return d
}

export async function fetchDashboardBundle(practiceId) {
  if (!practiceId) {
    return {
      consults: [],
      messages: [],
      dashExtras: {
        sentConsultIds: new Set(),
        repliedConsultIds: new Set(),
        inboundRepliesWeek: 0,
        messageOutcomes: [],
      },
      unreadConvos: 0,
      implantApptsWeek: 0,
    }
  }

  const weekStart = startOfWeek()
  const weekStartIso = weekStart.toISOString()

  const [{ data: consults, error: ce }, { data: messages, error: me }, convosRes, apptRes, extras, pmsTxRes] =
    await Promise.all([
      supabase
        .from('consults')
        .select(
          'id, recording_date, status, outcome, objection_type, case_value, created_at, attribution_status, treatment_type, tx_plan_value, tx_plan_value_source',
        )
        .eq('practice_id', practiceId),
      supabase
        .from('messages')
        .select('consult_id, channel, status, scheduled_for, sent_at, created_at')
        .eq('practice_id', practiceId),
      supabase.from('conversations').select('unread_count').eq('practice_id', practiceId),
      supabase
        .from('pms_appointments')
        .select('id', { count: 'exact', head: true })
        .eq('practice_id', practiceId)
        .eq('is_implant_consult', true)
        .gte('appointment_time', weekStartIso),
      fetchDashboardExtras(practiceId, weekStartIso),
      // Unscheduled treatment plans pulled live from the PMS. Tolerant: if the
      // table doesn't exist yet / isn't synced, this resolves to an error we
      // ignore and the dashboard falls back to the consult-based count.
      supabase.from('pms_unscheduled_treatments').select('tx_value').eq('practice_id', practiceId),
    ])

  if (ce || me) throw ce || me

  // Roll up the PMS unscheduled-treatment list (count + total value). Only used
  // by the dashboard when there's at least one row; otherwise it falls back.
  const pmsRows = pmsTxRes?.error ? [] : pmsTxRes?.data || []
  const pmsUnscheduled = {
    count: pmsRows.length,
    value: pmsRows.reduce((sum, r) => sum + (Number(r.tx_value) || 0), 0),
  }

  return {
    consults: consults || [],
    messages: messages || [],
    dashExtras: extras,
    unreadConvos: (convosRes.data || []).filter((x) => (x.unread_count || 0) > 0).length,
    implantApptsWeek: apptRes.count || 0,
    pmsUnscheduled,
  }
}

export function useDashboard(practiceId) {
  return useQuery({
    queryKey: queryKeys.dashboard(practiceId),
    queryFn: () => fetchDashboardBundle(practiceId),
    enabled: Boolean(practiceId),
  })
}

export function useNetworkComparison(practiceId) {
  return useQuery({
    queryKey: queryKeys.networkComparison(practiceId),
    queryFn: () => fetchNetworkComparison(practiceId),
    enabled: Boolean(practiceId),
  })
}
