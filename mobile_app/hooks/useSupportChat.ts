import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

type SupportMessage = {
  id: string;
  chat_id: string;
  sender_id?: string | null;
  sender_type: string;
  sender_name?: string | null;
  message?: string | null;
  created_at: string;
  deleted_at?: string | null;
  thread_parent_id?: string | null;
};

type CurrentUser = { id?: string; name?: string; avatar?: string | null };

async function sendSupportMessage({
  chatId,
  practiceId,
  senderType,
  currentUser,
  text,
}: {
  chatId: string;
  practiceId: string;
  senderType: string;
  currentUser: CurrentUser;
  text: string;
}) {
  const body = text.trim();
  if (!body) return null;
  const row = {
    chat_id: chatId,
    practice_id: practiceId,
    sender_id: currentUser.id || null,
    sender_type: senderType,
    sender_name: currentUser.name || 'User',
    sender_avatar: currentUser.avatar || null,
    message: body,
  };
  const { data, error } = await supabase.from('support_messages').insert(row).select('*').single();
  if (error) throw error;
  void supabase.functions.invoke('chat-notify', { body: { message_id: data.id } }).catch(() => {});
  return data as SupportMessage;
}

export function useSupportChat({
  chatId,
  practiceId,
  senderType,
  currentUser,
}: {
  chatId: string | null;
  practiceId: string | null;
  senderType: string;
  currentUser: CurrentUser;
}) {
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(true);

  const sendMutation = useMutation({
    mutationFn: (text: string) =>
      sendSupportMessage({
        chatId: chatId!,
        practiceId: practiceId!,
        senderType,
        currentUser,
        text,
      }),
  });

  const fetchMessages = useCallback(async () => {
    if (!chatId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('support_messages')
      .select('*')
      .eq('chat_id', chatId)
      .is('thread_parent_id', null)
      .order('created_at', { ascending: true })
      .limit(100);
    if (!error && data) setMessages(data as SupportMessage[]);
    setLoading(false);
  }, [chatId]);

  useEffect(() => {
    void fetchMessages();
  }, [fetchMessages]);

  useEffect(() => {
    if (!chatId) return;
    const channel = supabase
      .channel(`support-mobile:${chatId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'support_messages', filter: `chat_id=eq.${chatId}` },
        (payload) => {
          setMessages((prev) => {
            if (payload.eventType === 'INSERT') {
              const row = payload.new as SupportMessage;
              if (row.thread_parent_id) return prev;
              if (prev.some((m) => m.id === row.id)) return prev;
              return [...prev, row];
            }
            if (payload.eventType === 'UPDATE') {
              return prev.map((m) => (m.id === payload.new.id ? (payload.new as SupportMessage) : m));
            }
            if (payload.eventType === 'DELETE') {
              return prev.filter((m) => m.id !== payload.old.id);
            }
            return prev;
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [chatId]);

  const markAsRead = useCallback(async () => {
    if (!chatId || !currentUser.id) return;
    await supabase.from('support_chats').update({ unread_count_practice: 0 }).eq('id', chatId);
    await supabase.from('support_reads').upsert(
      {
        chat_id: chatId,
        user_id: currentUser.id,
        last_read_at: new Date().toISOString(),
        user_name: currentUser.name || 'User',
        sender_type: senderType,
      },
      { onConflict: 'chat_id,user_id' },
    );
  }, [chatId, currentUser, senderType]);

  const sendMessage = useCallback(
    async (text: string) => {
      const data = await sendMutation.mutateAsync(text);
      if (data) setMessages((prev) => (prev.some((m) => m.id === data.id) ? prev : [...prev, data]));
      return data;
    },
    [sendMutation],
  );

  return {
    messages: messages.filter((m) => !m.deleted_at),
    loading,
    sending: sendMutation.isPending,
    sendMessage,
    markAsRead,
    refresh: fetchMessages,
  };
}

export async function resolveSupportChatId(practiceId: string): Promise<string | null> {
  let { data } = await supabase.from('support_chats').select('id').eq('practice_id', practiceId).maybeSingle();
  if (!data) {
    const ins = await supabase.from('support_chats').insert({ practice_id: practiceId }).select('id').maybeSingle();
    data = ins.data;
  }
  return data?.id ?? null;
}
