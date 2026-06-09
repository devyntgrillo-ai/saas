import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { fetchRecentCalls } from '../voice'
import { queryKeys } from './keys'

export async function fetchPowerDialerQueue(practiceId) {
  if (!practiceId) return []
  const endToday = new Date()
  endToday.setHours(23, 59, 59, 999)
  const { data, error } = await supabase
    .from('messages')
    .select(
      'id, consult_id, send_day, scheduled_for, status, channel, type, consults(id, patient_name, patient_phone, patient_email, objection_type, exit_intent_level, personal_detail, tc_action, recording_date, created_at)',
    )
    .eq('practice_id', practiceId)
    .or('channel.eq.call,type.eq.call')
    .in('status', ['scheduled', 'pending', 'draft'])
    .lte('scheduled_for', endToday.toISOString())
    .order('scheduled_for', { ascending: true })
  if (error) throw error
  return (data || []).filter((m) => m.consults && m.consults.patient_phone)
}

export function usePowerDialerQueue(practiceId) {
  return useQuery({
    queryKey: queryKeys.powerDialer.queue(practiceId),
    queryFn: () => fetchPowerDialerQueue(practiceId),
    enabled: Boolean(practiceId),
  })
}

export function useRecentCalls(practiceId) {
  return useQuery({
    queryKey: queryKeys.powerDialer.recentCalls(practiceId),
    queryFn: () => fetchRecentCalls(practiceId),
    enabled: Boolean(practiceId),
  })
}

export function useCompletePowerDialerLead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      practiceId, lead, consult, dispo, noteText, callSid, durationSec, tcName,
    }) => {
      const d = dispo || { key: 'no_answer', log: 'No answer' }

      let convId = null
      const { data: existing } = await supabase
        .from('conversations')
        .select('id')
        .eq('practice_id', practiceId)
        .eq('consult_id', consult.id)
        .maybeSingle()
      if (existing) convId = existing.id
      else {
        const [first, ...rest] = (consult.patient_name || 'Patient').split(' ')
        const { data: created } = await supabase
          .from('conversations')
          .insert({
            practice_id: practiceId,
            consult_id: consult.id,
            patient_first: first,
            patient_last: rest.join(' '),
            patient_phone: consult.patient_phone,
            patient_email: consult.patient_email,
            last_message_at: new Date().toISOString(),
          })
          .select('id')
          .single()
        convId = created?.id
      }

      const nowIso = new Date().toISOString()
      const dateLabel = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      const durLabel = callSid && durationSec > 0 ? ` · ${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, '0')}` : ''
      const body = `📞 Called ${dateLabel} · ${d.log}${durLabel}${noteText ? ` · ${noteText}` : ''}`

      let callLogId = null
      if (callSid) {
        const { data: cl } = await supabase.from('call_logs').select('id').eq('twilio_call_sid', callSid).maybeSingle()
        callLogId = cl?.id || null
      }
      const meta = {
        outcome: d.log,
        duration_sec: callSid ? (durationSec || 0) : null,
        note: noteText || null,
        actor: tcName || 'You',
      }

      if (convId) {
        await supabase.from('conversation_messages').insert({
          conversation_id: convId,
          direction: 'outbound',
          channel: 'call',
          body,
          sent_at: nowIso,
          meta,
          call_log_id: callLogId,
        })
        await supabase.from('conversations').update({ last_message_at: nowIso, last_message_preview: body }).eq('id', convId)
      }
      if (callSid) {
        await supabase.from('call_logs').update({
          disposition: d.key,
          notes: noteText || null,
          duration_seconds: durationSec || null,
          conversation_id: convId,
        }).eq('twilio_call_sid', callSid)
      }

      await supabase.from('messages').update({ status: 'sent', sent_at: nowIso }).eq('id', lead.id)
      if (d.key === 'dnc') {
        await supabase.from('consults').update({ outcome: 'not_converting' }).eq('id', consult.id)
      }

      return { leadId: lead.id, consultId: consult.id }
    },
    onSuccess: (_, { practiceId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.powerDialer.queue(practiceId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.powerDialer.recentCalls(practiceId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations(practiceId) })
    },
  })
}
