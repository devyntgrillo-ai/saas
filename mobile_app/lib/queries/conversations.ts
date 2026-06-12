import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invokeEdgeFunction } from '@/lib/messaging';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queries/keys';

type ConsultMeta = { id: string; starred?: boolean | null; archived?: boolean | null };

export type ConversationRow = {
  id: string;
  patient_first?: string | null;
  patient_last?: string | null;
  patient_phone?: string | null;
  patient_email?: string | null;
  last_message_at?: string | null;
  last_message_preview?: string | null;
  unread_count?: number | null;
  consult_id?: string | null;
  consult?: ConsultMeta | ConsultMeta[] | null;
  starred?: boolean;
  last_channel?: string | null;
};

function normalizeConsult(conversation: ConversationRow): ConsultMeta | null {
  const row = conversation.consult;
  if (!row) return null;
  return Array.isArray(row) ? row[0] ?? null : row;
}

export async function fetchConversationsList(practiceId: string): Promise<ConversationRow[]> {
  if (!practiceId) return [];

  let { data, error } = await supabase
    .from('conversations')
    .select('*, consult:consults(id, starred, archived)')
    .eq('practice_id', practiceId)
    .order('last_message_at', { ascending: false, nullsFirst: false });

  if (error) {
    const res = await supabase
      .from('conversations')
      .select('*')
      .eq('practice_id', practiceId)
      .order('last_message_at', { ascending: false, nullsFirst: false });
    data = res.data;
    if (res.error) throw res.error;
  }

  const convs = (data as ConversationRow[]) || [];
  if (!convs.length) return [];

  const visible = convs.filter((c) => !normalizeConsult(c)?.archived);

  const ids = visible.map((c) => c.id);
  const { data: recentMsgs } = await supabase
    .from('conversation_messages')
    .select('conversation_id, channel, created_at')
    .in('conversation_id', ids)
    .order('created_at', { ascending: false });

  const lastChannelByConv: Record<string, string> = {};
  for (const m of recentMsgs || []) {
    if (!lastChannelByConv[m.conversation_id]) lastChannelByConv[m.conversation_id] = m.channel;
  }

  return visible.map((c) => ({
    ...c,
    starred: Boolean(normalizeConsult(c)?.starred),
    last_channel: lastChannelByConv[c.id] || null,
  }));
}

export async function fetchConversation(conversationId: string) {
  const { data, error } = await supabase.from('conversations').select('*').eq('id', conversationId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchConversationThread(conversationId: string) {
  const { data, error } = await supabase
    .from('conversation_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export function useConversationsList(practiceId: string | null) {
  return useQuery({
    queryKey: queryKeys.conversations(practiceId),
    queryFn: () => fetchConversationsList(practiceId!),
    enabled: Boolean(practiceId),
    refetchInterval: 30_000,
  });
}

export function useConversation(practiceId: string | null, conversationId: string | null) {
  return useQuery({
    queryKey: queryKeys.conversation(practiceId, conversationId),
    queryFn: () => fetchConversation(conversationId!),
    enabled: Boolean(practiceId && conversationId),
  });
}

export function useConversationThread(practiceId: string | null, conversationId: string | null) {
  return useQuery({
    queryKey: queryKeys.conversationThread(practiceId, conversationId),
    queryFn: () => fetchConversationThread(conversationId!),
    enabled: Boolean(practiceId && conversationId),
    refetchInterval: 15_000,
  });
}

export function useMarkConversationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ practiceId, conversationId }: { practiceId: string; conversationId: string }) => {
      const { error } = await supabase.from('conversations').update({ unread_count: 0 }).eq('id', conversationId);
      if (error) throw error;
      return { practiceId, conversationId };
    },
    onSuccess: ({ practiceId, conversationId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations(practiceId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversation(practiceId, conversationId) });
    },
  });
}

export function useSendThreadMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      practiceId: string;
      conversationId: string;
      channel: 'sms' | 'email';
      body: string;
      subject?: string;
      patientPhone?: string | null;
      patientEmail?: string | null;
      consultId?: string | null;
    }) => {
      const nowIso = new Date().toISOString();
      const meta = payload.channel === 'email' && payload.subject ? { subject: payload.subject } : {};
      const { data, error } = await supabase
        .from('conversation_messages')
        .insert({
          conversation_id: payload.conversationId,
          direction: 'outbound',
          channel: payload.channel,
          body: payload.body,
          sent_at: nowIso,
          meta,
        })
        .select()
        .single();
      if (error) throw error;

      await supabase
        .from('conversations')
        .update({ last_message_at: nowIso, last_message_preview: payload.body.slice(0, 120) })
        .eq('id', payload.conversationId);

      const fn = payload.channel === 'email' ? 'mailgun-send' : 'twilio-send';
      const target = payload.channel === 'email' ? payload.patientEmail : payload.patientPhone;
      if (target) {
        await invokeEdgeFunction(fn, {
          practice_id: payload.practiceId,
          to: target,
          body: payload.body,
          subject: payload.subject,
          conversation_message_id: data.id,
          consult_id: payload.consultId,
        });
      }

      return data;
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.conversationThread(variables.practiceId, variables.conversationId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations(variables.practiceId) });
    },
  });
}
