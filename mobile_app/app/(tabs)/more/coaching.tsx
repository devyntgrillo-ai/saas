import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { format } from 'date-fns';
import { MessageCircle, Send } from 'lucide-react-native';
import { useAuth } from '@/lib/auth-context';
import { useAppColors } from '@/lib/color-scheme-context';
import { resolveSupportChatId, useSupportChat } from '@/hooks/useSupportChat';
import { MessageBubble } from '@/components/ui/MessageBubble';

export default function CoachingScreen() {
  const c = useAppColors();
  const insets = useSafeAreaInsets();
  const { practiceId, user, profile } = useAuth();
  const [chatId, setChatId] = useState<string | null>(null);
  const [loadingChat, setLoadingChat] = useState(true);
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList>(null);

  const currentUser = useMemo(
    () => ({
      id: user?.id,
      name: profile?.display_name || profile?.full_name || user?.email || 'You',
      avatar: profile?.avatar_url || null,
    }),
    [user, profile],
  );

  useEffect(() => {
    if (!practiceId) return;
    let cancelled = false;
    void resolveSupportChatId(practiceId).then((id) => {
      if (!cancelled) {
        setChatId(id);
        setLoadingChat(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [practiceId]);

  const chat = useSupportChat({
    chatId,
    practiceId,
    senderType: 'practice',
    currentUser,
  });

  useEffect(() => {
    if (chatId && !chat.loading) void chat.markAsRead();
  }, [chatId, chat.loading, chat.messages.length]);

  useEffect(() => {
    if (chat.messages.length) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [chat.messages.length]);

  if (loadingChat) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.pageBg }}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.pageBg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      {chat.loading ? (
        <ActivityIndicator color={c.accent} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          ref={listRef}
          data={chat.messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 8 }}
          ListEmptyComponent={
            <View style={{ paddingVertical: 40 }}>
              <Text style={{ textAlign: 'center', color: c.textSecondary, fontSize: 15 }}>
                Chat with your CaseLift coach
              </Text>
              <Text style={{ textAlign: 'center', color: c.textMuted, marginTop: 8, fontSize: 13 }}>
                Ask about consults, objections, or sequence strategy.
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const mine = item.sender_id === user?.id;
            return (
              <MessageBubble
                body={item.message}
                outbound={mine}
                senderName={mine ? undefined : item.sender_name || 'CaseLift'}
                meta={format(new Date(item.created_at), 'h:mm a')}
              />
            );
          }}
        />
      )}

      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: c.border,
          backgroundColor: c.surface,
          paddingHorizontal: 12,
          paddingTop: 10,
          paddingBottom: Math.max(insets.bottom, 10),
        }}>
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end' }}>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: c.accentPill,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <MessageCircle size={18} color={c.accent} />
          </View>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Message your coach…"
            placeholderTextColor={c.textMuted}
            multiline
            style={{
              flex: 1,
              minHeight: 44,
              maxHeight: 100,
              borderRadius: 22,
              borderWidth: 1,
              borderColor: c.border,
              backgroundColor: c.searchBg,
              paddingHorizontal: 16,
              paddingVertical: 10,
              fontSize: 16,
              color: c.text,
            }}
          />
          {chat.sending ? (
            <ActivityIndicator color={c.accent} style={{ marginBottom: 10 }} />
          ) : (
            <Pressable
              onPress={() => {
                const text = draft.trim();
                if (!text) return;
                setDraft('');
                void chat.sendMessage(text);
              }}
              disabled={!draft.trim()}
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: draft.trim() ? c.accent : c.chipBg,
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 2,
              }}>
              <Send size={18} color={draft.trim() ? '#FFF' : c.textMuted} />
            </Pressable>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
