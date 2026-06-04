import { useQuery } from '@tanstack/react-query'
import { fetchAppointmentCount, fetchRecordingRate, fetchTodaysAppointments } from '../pms'
import { queryKeys } from './keys'

export function useTodaysAppointments(practiceId) {
  return useQuery({
    queryKey: queryKeys.pmsToday(practiceId),
    queryFn: () => fetchTodaysAppointments(practiceId),
    enabled: Boolean(practiceId),
  })
}

export function useRecordingRate(practiceId, weeks = 4) {
  return useQuery({
    queryKey: queryKeys.recordingRate(practiceId, weeks),
    queryFn: () => fetchRecordingRate(practiceId, weeks),
    enabled: Boolean(practiceId),
  })
}

export function usePmsAppointmentCount(practiceId, enabled = true) {
  return useQuery({
    queryKey: queryKeys.pmsAppointmentCount(practiceId),
    queryFn: () => fetchAppointmentCount(practiceId),
    enabled: Boolean(practiceId) && enabled,
  })
}
