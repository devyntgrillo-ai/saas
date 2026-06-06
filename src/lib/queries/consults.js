import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { queryKeys } from './keys'

// A consult is "processing" until analysis + message drafting finish (status
// flips to 'analyzed'). 'analyzing' = transcribing, 'transcribed' = analysis in
// progress. transcription_error is surfaced on the detail page, not here.
export const PROCESSING_STATUSES = ['analyzing', 'transcribed']

const TYPE_RE = /consult|implant/i

export async function fetchDayAppointments(practiceId, date) {
  if (!practiceId) return { appts: [], allNote: false }

  const start = new Date(`${date}T00:00:00`)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)

  const { data, error } = await supabase
    .from('pms_appointments')
    .select('*')
    .eq('practice_id', practiceId)
    .gte('appointment_time', start.toISOString())
    .lt('appointment_time', end.toISOString())
    .order('appointment_time', { ascending: true })

  if (error) throw error

  const rows = data || []
  const consultRows = rows.filter((a) => TYPE_RE.test(a.appointment_type || ''))
  if (consultRows.length === 0 && rows.length > 0) {
    return { appts: rows, allNote: true }
  }
  return { appts: consultRows, allNote: false }
}

export async function fetchUnlinkedConsults(practiceId) {
  if (!practiceId) return []
  const { data, error } = await supabase
    .from('consults')
    .select('id, patient_name, status, created_at')
    .eq('practice_id', practiceId)
    .is('appointment_id', null)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return data || []
}

export function useConsultsDay(practiceId, date) {
  return useQuery({
    queryKey: queryKeys.consultsDay(practiceId, date),
    queryFn: () => fetchDayAppointments(practiceId, date),
    enabled: Boolean(practiceId && date),
  })
}

export function useUnlinkedConsults(practiceId) {
  return useQuery({
    queryKey: queryKeys.unlinkedConsults(practiceId),
    queryFn: () => fetchUnlinkedConsults(practiceId),
    enabled: Boolean(practiceId),
  })
}

// Consults currently being transcribed/analyzed for this practice — surfaced as
// "processing" cards at the top of the Consults list and as the dashboard count.
export async function fetchProcessingConsults(practiceId) {
  if (!practiceId) return []
  const { data, error } = await supabase
    .from('consults')
    .select('id, patient_name, patient_first, patient_last, treatment_type, status, created_at')
    .eq('practice_id', practiceId)
    .in('status', PROCESSING_STATUSES)
    .order('created_at', { ascending: false })
    .limit(25)
  if (error) throw error
  return data || []
}

export function useProcessingConsults(practiceId) {
  return useQuery({
    queryKey: queryKeys.processingConsults(practiceId),
    queryFn: () => fetchProcessingConsults(practiceId),
    enabled: Boolean(practiceId),
    // Light poll as a fallback in case realtime isn't enabled on the consults
    // table; realtime (useConsultsRealtime) invalidates this immediately.
    refetchInterval: 15000,
  })
}

// Realtime: when any consult for this practice changes status, refresh the
// processing list + the day/sequences/dashboard views so processing cards
// transition to "ready" without a manual reload. Falls back to the poll above
// if the consults table isn't in the realtime publication yet.
export function useConsultsRealtime(practiceId) {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!practiceId) return
    const channel = supabase
      .channel(`consults-status:${practiceId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'consults', filter: `practice_id=eq.${practiceId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.processingConsults(practiceId) })
          queryClient.invalidateQueries({ queryKey: queryKeys.unlinkedConsults(practiceId) })
          queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(practiceId) })
        },
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [practiceId, queryClient])
}
