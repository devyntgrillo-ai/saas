import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { transcribeRecording } from '../recording'
import { auditConsultViewed, auditPatientAccessed } from '../audit'
import { fetchConsultAttribution } from '../attribution'
import { supabase } from '../supabase'
import { queryKeys } from './keys'

export async function fetchConsultBundle(consultId, { audit = true } = {}) {
  if (!consultId) return null

  const { data: consult, error } = await supabase.from('consults').select('*').eq('id', consultId).maybeSingle()
  if (error) throw error
  if (!consult) return { notFound: true }

  if (audit) {
    auditConsultViewed(consult.id)
    if (consult.patient_name || consult.patient_phone || consult.patient_email) {
      auditPatientAccessed(consult.id)
    }
  }

  const [{ data: messages }, { data: convs }, { data: appointment }] = await Promise.all([
    supabase
      .from('messages')
      .select('*')
      .eq('consult_id', consultId)
      .order('scheduled_for', { ascending: true, nullsFirst: true })
      .order('sent_at', { ascending: true, nullsFirst: true })
      .order('created_at', { ascending: true }),
    supabase.from('conversations').select('id, patient_first, unread_count').eq('consult_id', consultId),
    supabase
      .from('pms_appointments')
      .select(
        'patient_first, patient_last, patient_phone, patient_email, provider, appointment_time, appointment_type',
      )
      .eq('consult_id', consultId)
      .maybeSingle(),
  ])

  return {
    notFound: false,
    consult,
    messages: messages || [],
    conversation: convs?.[0] || null,
    appointment: appointment || null,
  }
}

export function useConsultDetail(consultId) {
  return useQuery({
    queryKey: queryKeys.consult(consultId),
    queryFn: () => fetchConsultBundle(consultId),
    enabled: Boolean(consultId),
    refetchInterval: (query) =>
      query.state.data?.consult?.status === 'transcribed' ? 5000 : false,
  })
}

export function useConsultAttribution(consult, messages) {
  const consultId = consult?.id
  return useQuery({
    queryKey: queryKeys.consultAttribution(consultId),
    queryFn: () => fetchConsultAttribution(consult, messages),
    enabled: Boolean(consultId && messages),
  })
}

export function useInvalidateConsult() {
  const queryClient = useQueryClient()
  return (consultId, practiceId) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.consult(consultId) })
    queryClient.invalidateQueries({ queryKey: queryKeys.consultAttribution(consultId) })
    if (practiceId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(practiceId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.sequences(practiceId) })
    }
  }
}

export function useMarkConsultWon() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ consultId, patch, caseValue, treatmentType }) => {
      const { error } = await supabase.from('consults').update(patch).eq('id', consultId)
      if (error) throw error
      try {
        await supabase.functions.invoke('record-win', {
          body: { consult_id: consultId, source: 'manual', case_value: caseValue, treatment_type: treatmentType },
        })
      } catch { /* best-effort */ }
      return { consultId, patch }
    },
    onSuccess: ({ consultId }, { practiceId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.consult(consultId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.consultAttribution(consultId) })
      if (practiceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(practiceId) })
        queryClient.invalidateQueries({ queryKey: queryKeys.sequences(practiceId) })
      }
    },
  })
}

export function useRetryTranscription() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ consult, practiceId }) => {
      const consultId = consult.id
      try {
        if (consult.audio_storage_path) {
          await transcribeRecording({
            consultId,
            audioPath: consult.audio_storage_path,
            durationSec: consult.duration,
            patient: {
              firstName: consult.patient_first,
              lastName: consult.patient_last,
              phone: consult.patient_phone,
              email: consult.patient_email,
            },
          })
          return { consultId, patch: null, practiceId }
        }
        const patch = { status: 'analyzing', transcript_error: null }
        const { error } = await supabase.from('consults').update(patch).eq('id', consultId)
        if (error) throw error
        return { consultId, patch, practiceId }
      } catch (e) {
        const patch = { status: 'transcription_error', transcript_error: e?.message || 'Transcription failed' }
        const { error } = await supabase.from('consults').update(patch).eq('id', consultId)
        if (error) throw error
        return { consultId, patch, practiceId, failed: true }
      }
    },
    onSuccess: ({ consultId }, { practiceId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.consult(consultId) })
      if (practiceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(practiceId) })
      }
    },
  })
}
