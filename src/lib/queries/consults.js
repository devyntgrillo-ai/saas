import { useQuery } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { queryKeys } from './keys'

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
