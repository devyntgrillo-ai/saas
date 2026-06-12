import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queries/keys';

export async function fetchConsultBundle(consultId: string) {
  const { data: consult, error } = await supabase.from('consults').select('*').eq('id', consultId).maybeSingle();
  if (error) throw error;
  if (!consult) return { notFound: true as const };

  const [{ data: messages }, { data: convs }] = await Promise.all([
    supabase
      .from('messages')
      .select('id, status, channel, scheduled_for, sent_at, body, subject')
      .eq('consult_id', consultId)
      .order('scheduled_for', { ascending: true, nullsFirst: true }),
    supabase.from('conversations').select('id, unread_count').eq('consult_id', consultId),
  ]);

  return {
    notFound: false as const,
    consult,
    messages: messages || [],
    conversation: convs?.[0] || null,
  };
}

export function useConsultDetail(consultId: string | null) {
  return useQuery({
    queryKey: queryKeys.consult(consultId),
    queryFn: () => fetchConsultBundle(consultId!),
    enabled: Boolean(consultId),
    refetchInterval: (query) => {
      const bundle = query.state.data;
      if (!bundle || bundle.notFound) return false;
      const status = bundle.consult?.status;
      if (status === 'analyzing') return 8000;
      if (status === 'transcribed') return 15000;
      return false;
    },
    refetchIntervalInBackground: false,
  });
}

export function useUpdateConsultOutcome() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      consultId,
      outcome,
      practiceId,
      userId,
      followupApprovedAt,
      patch: extraPatch,
      pauseOnly,
    }: {
      consultId: string;
      outcome: string;
      practiceId: string;
      userId?: string | null;
      followupApprovedAt?: string | null;
      patch?: Record<string, unknown>;
      pauseOnly?: boolean;
    }) => {
      if (pauseOnly && extraPatch) {
        const { error } = await supabase.from('consults').update(extraPatch).eq('id', consultId);
        if (error) throw error;
        return { consultId, practiceId };
      }

      const patch: Record<string, unknown> = {
        outcome,
        outcome_set_at: new Date().toISOString(),
        outcome_set_by: userId || null,
        ...extraPatch,
      };
      if (outcome === 'pending') {
        patch.sequence_cancelled_at = null;
        patch.sequence_cancelled_reason = null;
        patch.sequence_status = 'active';
        patch.sequence_paused_reason = null;
        if (!followupApprovedAt) patch.followup_approved_at = new Date().toISOString();
      } else if (['accepted', 'not_converting', 'closed_won'].includes(outcome)) {
        patch.sequence_cancelled_at = new Date().toISOString();
        patch.sequence_cancelled_reason = outcome;
        patch.sequence_status = 'cancelled';
        if (outcome === 'accepted') patch.status = 'closed_won';
        if (outcome === 'not_converting') patch.status = 'closed_lost';
      }
      const { error } = await supabase.from('consults').update(patch).eq('id', consultId);
      if (error) throw error;
      return { consultId, practiceId };
    },
    onSuccess: ({ consultId, practiceId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.consult(consultId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(practiceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.consultArchive(practiceId, '', 0) });
    },
  });
}
