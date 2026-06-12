import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queries/keys';

// Power Dialer = today's due call-type follow-ups. Ported from the web app
// (src/lib/queries/powerDialer.js). Mobile places calls via the native dialer
// (tel:), so there is no Twilio callSid — the call_logs update is skipped and
// the outcome is logged straight to the conversation thread.

export type DialerConsult = {
  id: string;
  patient_name?: string | null;
  patient_phone?: string | null;
  patient_email?: string | null;
  objection_type?: string | null;
  exit_intent_level?: string | null;
  personal_detail?: string | null;
  tc_action?: string | null;
  recording_date?: string | null;
  created_at?: string | null;
};

export type DialerLead = {
  id: string;
  consult_id: string;
  send_day?: number | null;
  scheduled_for?: string | null;
  status: string;
  channel?: string | null;
  type?: string | null;
  consults: DialerConsult | null;
};

export type Disposition = { key: string; label: string; log: string };

export async function fetchPowerDialerQueue(practiceId: string): Promise<DialerLead[]> {
  if (!practiceId) return [];
  const endToday = new Date();
  endToday.setHours(23, 59, 59, 999);
  const { data, error } = await supabase
    .from('messages')
    .select(
      'id, consult_id, send_day, scheduled_for, status, channel, type, consults(id, patient_name, patient_phone, patient_email, objection_type, exit_intent_level, personal_detail, tc_action, recording_date, created_at)',
    )
    .eq('practice_id', practiceId)
    .or('channel.eq.call,type.eq.call')
    .in('status', ['scheduled', 'pending', 'draft'])
    .lte('scheduled_for', endToday.toISOString())
    .order('scheduled_for', { ascending: true });
  if (error) throw error;
  return ((data as unknown as DialerLead[]) || []).filter((m) => m.consults && m.consults.patient_phone);
}

export function usePowerDialerQueue(practiceId: string | null) {
  return useQuery({
    queryKey: queryKeys.powerDialer.queue(practiceId),
    queryFn: () => fetchPowerDialerQueue(practiceId!),
    enabled: Boolean(practiceId),
  });
}

export function useCompletePowerDialerLead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      practiceId,
      lead,
      consult,
      dispo,
      noteText,
      tcName,
    }: {
      practiceId: string;
      lead: DialerLead;
      consult: DialerConsult;
      dispo: Disposition;
      noteText?: string;
      tcName?: string;
    }) => {
      const d = dispo || { key: 'no_answer', label: 'No answer', log: 'No answer' };

      let convId: string | null = null;
      const { data: existing } = await supabase
        .from('conversations')
        .select('id')
        .eq('practice_id', practiceId)
        .eq('consult_id', consult.id)
        .maybeSingle();
      if (existing) convId = existing.id;
      else {
        const [first, ...rest] = (consult.patient_name || 'Patient').split(' ');
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
          .single();
        convId = created?.id ?? null;
      }

      const nowIso = new Date().toISOString();
      const dateLabel = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const body = `📞 Called ${dateLabel} · ${d.log}${noteText ? ` · ${noteText}` : ''}`;
      const meta = { outcome: d.log, duration_sec: null, note: noteText || null, actor: tcName || 'You' };

      if (convId) {
        await supabase.from('conversation_messages').insert({
          conversation_id: convId,
          direction: 'outbound',
          channel: 'call',
          body,
          sent_at: nowIso,
          meta,
          call_log_id: null,
        });
        await supabase
          .from('conversations')
          .update({ last_message_at: nowIso, last_message_preview: body })
          .eq('id', convId);
      }

      await supabase.from('messages').update({ status: 'sent', sent_at: nowIso }).eq('id', lead.id);
      if (d.key === 'dnc') {
        await supabase.from('consults').update({ outcome: 'not_converting' }).eq('id', consult.id);
      }

      return { leadId: lead.id, consultId: consult.id };
    },
    onSuccess: (_r, { practiceId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.powerDialer.queue(practiceId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations(practiceId) });
    },
  });
}
