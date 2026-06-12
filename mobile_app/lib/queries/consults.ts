import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queries/keys';

export const PROCESSING_STATUSES = ['analyzing', 'transcribed'];
const PROCESSING_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export async function fetchProcessingConsults(practiceId: string) {
  const cutoff = new Date(Date.now() - PROCESSING_MAX_AGE_MS).toISOString();
  const { data, error } = await supabase
    .from('consults')
    .select('id, patient_name, status, created_at')
    .eq('practice_id', practiceId)
    .in('status', PROCESSING_STATUSES)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export function useProcessingConsults(practiceId: string | null) {
  return useQuery({
    queryKey: queryKeys.processingConsults(practiceId),
    queryFn: () => fetchProcessingConsults(practiceId!),
    enabled: Boolean(practiceId),
    refetchInterval: 15_000,
  });
}

export async function fetchTodayAppointments(practiceId: string) {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const { data, error } = await supabase
    .from('pms_appointments')
    .select('*')
    .eq('practice_id', practiceId)
    .gte('appointment_time', start.toISOString())
    .lt('appointment_time', end.toISOString())
    .order('appointment_time', { ascending: true });
  if (error) throw error;
  return data || [];
}

export function useTodayAppointments(practiceId: string | null) {
  return useQuery({
    queryKey: queryKeys.pmsToday(practiceId),
    queryFn: () => fetchTodayAppointments(practiceId!),
    enabled: Boolean(practiceId),
  });
}

export async function fetchConsultArchive(practiceId: string, search = '', page = 0, pageSize = 20) {
  let q = supabase
    .from('consults')
    .select('id, patient_name, patient_first, patient_last, status, outcome, recording_date, created_at', {
      count: 'exact',
    })
    .eq('practice_id', practiceId)
    .order('created_at', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1);

  if (search.trim()) {
    q = q.or(
      `patient_name.ilike.%${search.trim()}%,patient_first.ilike.%${search.trim()}%,patient_last.ilike.%${search.trim()}%`,
    );
  }

  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: data || [], total: count || 0 };
}

export function useConsultArchive(practiceId: string | null, search = '', page = 0) {
  return useQuery({
    queryKey: queryKeys.consultArchive(practiceId, search, page),
    queryFn: () => fetchConsultArchive(practiceId!, search, page),
    enabled: Boolean(practiceId),
  });
}
