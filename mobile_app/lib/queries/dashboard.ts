import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queries/keys';

function startOfWeek() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d;
}

async function fetchDashboardExtras(practiceId: string, weekStartIso: string) {
  const empty = {
    sentConsultIds: new Set<string>(),
    repliedConsultIds: new Set<string>(),
    inboundRepliesWeek: 0,
    messageOutcomes: [] as Array<Record<string, unknown>>,
  };

  const [{ data: sentMsgs }, { data: convs }, { data: outcomes }] = await Promise.all([
    supabase.from('messages').select('consult_id').eq('practice_id', practiceId).eq('status', 'sent'),
    supabase.from('conversations').select('id, consult_id').eq('practice_id', practiceId),
    supabase
      .from('message_outcomes')
      .select('message_position, message_channel, replied, closed_after')
      .eq('practice_id', practiceId),
  ]);

  const sentConsultIds = new Set((sentMsgs || []).map((m) => m.consult_id).filter(Boolean) as string[]);
  const convRows = convs || [];
  const convIds = convRows.map((c) => c.id);
  const convToConsult = new Map(
    convRows.filter((c) => c.consult_id).map((c) => [c.id, c.consult_id as string]),
  );
  const repliedConsultIds = new Set<string>();

  let inboundRepliesWeek = 0;
  if (convIds.length) {
    const [{ count }, { data: inbound }] = await Promise.all([
      supabase
        .from('conversation_messages')
        .select('id', { count: 'exact', head: true })
        .in('conversation_id', convIds)
        .eq('direction', 'inbound')
        .gte('sent_at', weekStartIso),
      supabase
        .from('conversation_messages')
        .select('conversation_id')
        .in('conversation_id', convIds)
        .eq('direction', 'inbound')
        .gte('sent_at', weekStartIso),
    ]);
    inboundRepliesWeek = count || 0;
    for (const r of inbound || []) {
      const cid = convToConsult.get(r.conversation_id);
      if (cid) repliedConsultIds.add(cid);
    }
  }

  return {
    sentConsultIds,
    repliedConsultIds,
    inboundRepliesWeek,
    messageOutcomes: outcomes || [],
  };
}

export async function fetchDashboardBundle(practiceId: string) {
  const weekStartIso = startOfWeek().toISOString();

  const [{ data: consults, error: ce }, { data: messages, error: me }, convosRes, apptRes, extras] =
    await Promise.all([
      supabase
        .from('consults')
        .select(
          'id, recording_date, status, outcome, case_value, created_at, attribution_status, treatment_type, tx_plan_value, tx_plan_value_source',
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
    ]);

  if (ce || me) throw ce || me;

  return {
    consults: consults || [],
    messages: messages || [],
    dashExtras: extras,
    unreadConvos: (convosRes.data || []).filter((x) => (x.unread_count || 0) > 0).length,
    implantApptsWeek: apptRes.count || 0,
  };
}

export function useDashboard(practiceId: string | null) {
  return useQuery({
    queryKey: queryKeys.dashboard(practiceId),
    queryFn: () => fetchDashboardBundle(practiceId!),
    enabled: Boolean(practiceId),
  });
}
