import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { format } from 'date-fns';
import { ArrowLeft, Mail, Phone } from 'lucide-react-native';
import { useAuth } from '@/lib/auth-context';
import { useAppColors } from '@/lib/color-scheme-context';
import { usePermissions } from '@/lib/permissions';
import {
  useConversation,
  useConversationThread,
  useMarkConversationRead,
  useSendThreadMessage,
} from '@/lib/queries/conversations';
import { MessageComposer } from '@/components/message-composer';
import { GateScreen } from '@/components/gate-screen';
import { MessageBubble } from '@/components/ui/MessageBubble';
import { UserAvatar } from '@/components/ui/UserAvatar';

type ThreadMessage = {
  id: string;
  direction?: string | null;
  channel?: string | null;
  body?: string | null;
  sent_at?: string | null;
  created_at?: string | null;
};

const ThreadMessageRow = memo(function ThreadMessageRow({
  item,
  patientName,
}: {
  item: ThreadMessage;
  patientName: string;
}) {
  const c = useAppColors();
  const outbound = item.direction === 'outbound';
  const time = item.sent_at || item.created_at;
  const meta = `${(item.channel || 'sms').toUpperCase()}${time ? ` · ${format(new Date(time), 'h:mm a')}` : ''}`;

  if (item.channel === 'note') {
    return (
      <View style={{ alignItems: 'center', marginBottom: 12 }}>
        <Text
          style={{
            fontSize: 12,
            color: c.textMuted,
            backgroundColor: c.cardTint,
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 12,
          }}>
          Note · {item.body}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ marginBottom: 12 }}>
      <MessageBubble
        body={item.body || ''}
        outbound={outbound}
        meta={meta}
        senderName={outbound ? undefined : patientName}
      />
    </View>
  );
});

function ContactRow({
  label,
  value,
  onPress,
}: {
  label: string;
  value?: string | null;
  onPress?: () => void;
}) {
  const c = useAppColors();
  const display = value?.trim() || 'Not on file';

  const content = (
    <View
      style={{
        padding: 14,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surfaceHi,
      }}>
      <Text style={{ fontSize: 11, fontWeight: '600', color: c.textMuted, textTransform: 'uppercase' }}>
        {label}
      </Text>
      <Text
        style={{
          fontSize: 15,
          color: value ? c.accent : c.textSecondary,
          marginTop: 4,
        }}
        numberOfLines={1}>
        {display}
      </Text>
    </View>
  );

  if (onPress && value) {
    return <Pressable onPress={onPress}>{content}</Pressable>;
  }
  return content;
}

export default function InboxThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useAppColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { practiceId, practice } = useAuth();
  const { canViewConversations } = usePermissions();
  const listRef = useRef<FlatList>(null);

  const { data: conversation } = useConversation(practiceId, id || null);
  const { data: messages = [], isLoading } = useConversationThread(practiceId, id || null);
  const markRead = useMarkConversationRead();
  const sendMessage = useSendThreadMessage();

  const lastChannel = [...messages].reverse().find((m) => m.channel === 'sms' || m.channel === 'email')?.channel;
  const [channel, setChannel] = useState<'sms' | 'email'>(lastChannel === 'email' ? 'email' : 'sms');
  const [contactOpen, setContactOpen] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);

  const patientName =
    [conversation?.patient_first, conversation?.patient_last].filter(Boolean).join(' ') || 'Patient';

  useEffect(() => {
    if (practiceId && id && conversation?.unread_count) {
      void markRead.mutateAsync({ practiceId, conversationId: id });
    }
  }, [practiceId, id, conversation?.unread_count]);

  useEffect(() => {
    if (messages.length) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => {
      if (Platform.OS === 'android') {
        setKeyboardInset(e.endCoordinates.height);
      }
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      if (Platform.OS === 'android') {
        setKeyboardInset(0);
      }
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const renderMessage = useCallback(
    ({ item }: { item: ThreadMessage }) => (
      <ThreadMessageRow item={item} patientName={patientName} />
    ),
    [patientName],
  );

  const keyExtractor = useCallback((item: ThreadMessage) => item.id, []);

  if (!canViewConversations) {
    return (
      <GateScreen
        title="Inbox unavailable"
        message="Your account role cannot access patient conversations."
      />
    );
  }

  function openPhone() {
    const phone = conversation?.patient_phone?.trim();
    if (!phone) {
      setContactOpen(true);
      return;
    }
    setContactOpen(false);
    void Linking.openURL(`tel:${phone}`);
  }

  function openEmail() {
    const email = conversation?.patient_email?.trim();
    if (!email) {
      setContactOpen(true);
      return;
    }
    setContactOpen(false);
    void Linking.openURL(`mailto:${email}`);
  }

  function handleSend(body: string, ch: 'sms' | 'email', subject?: string) {
    if (!practiceId || !id || !conversation) return;
    if (ch === 'sms' && !conversation.patient_phone) {
      Alert.alert('Cannot send', 'No phone number on this conversation.');
      return;
    }
    if (ch === 'email' && !conversation.patient_email) {
      Alert.alert('Cannot send', 'No email on this conversation.');
      return;
    }
    void sendMessage.mutateAsync({
      practiceId,
      conversationId: id,
      channel: ch,
      body,
      subject:
        ch === 'email'
          ? subject || `Message from ${practice?.name || 'your care team'}`
          : undefined,
      patientPhone: conversation.patient_phone,
      patientEmail: conversation.patient_email,
      consultId: conversation.consult_id,
    });
  }

  const practiceDoctor = practice?.doctor_last || practice?.doctor_first || null;
  const headerHeight = insets.top + 68;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.pageBg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}>
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingBottom: 12,
          paddingHorizontal: 12,
          backgroundColor: c.surface,
          borderBottomWidth: 1,
          borderBottomColor: c.border,
        }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pressable onPress={() => router.back()} style={{ padding: 6 }}>
            <ArrowLeft size={22} color={c.text} />
          </Pressable>
          <Pressable
            onPress={() => setContactOpen(true)}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}
            accessibilityRole="button"
            accessibilityLabel="View contact info">
            <UserAvatar name={patientName} size={40} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: c.text }}>{patientName}</Text>
              <Text style={{ fontSize: 12, color: c.textSecondary, marginTop: 2 }}>Tap to view contact info</Text>
            </View>
          </Pressable>
          <Pressable onPress={openEmail} style={{ padding: 8 }} accessibilityLabel="Email patient">
            <Mail size={20} color={c.textSecondary} />
          </Pressable>
          <Pressable onPress={openPhone} style={{ padding: 8 }} accessibilityLabel="Call patient">
            <Phone size={20} color={c.textSecondary} />
          </Pressable>
        </View>
      </View>

      <Modal visible={contactOpen} animationType="slide" transparent onRequestClose={() => setContactOpen(false)}>
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}
          onPress={() => setContactOpen(false)}>
          <Pressable
            style={{
              backgroundColor: c.surface,
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              paddingHorizontal: 20,
              paddingTop: 20,
              paddingBottom: insets.bottom + 20,
            }}
            onPress={(e) => e.stopPropagation()}>
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <UserAvatar name={patientName} size={56} />
              <Text style={{ fontSize: 18, fontWeight: '700', color: c.text, marginTop: 12 }}>{patientName}</Text>
            </View>

            <View style={{ gap: 12 }}>
              <ContactRow
                label="Phone"
                value={conversation?.patient_phone}
                onPress={conversation?.patient_phone ? openPhone : undefined}
              />
              <ContactRow
                label="Email"
                value={conversation?.patient_email}
                onPress={conversation?.patient_email ? openEmail : undefined}
              />
            </View>

            {conversation?.consult_id ? (
              <Pressable
                onPress={() => {
                  setContactOpen(false);
                  router.push(`/consults/${conversation.consult_id}`);
                }}
                style={{
                  marginTop: 20,
                  paddingVertical: 14,
                  borderRadius: 10,
                  backgroundColor: c.accentSubtle,
                  alignItems: 'center',
                }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: c.accent }}>View consult</Text>
              </Pressable>
            ) : null}

            <Pressable
              onPress={() => setContactOpen(false)}
              style={{
                marginTop: 12,
                paddingVertical: 14,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: c.border,
                alignItems: 'center',
              }}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: c.text }}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <FlatList
        ref={listRef}
        data={isLoading ? [] : messages}
        keyExtractor={keyExtractor}
        renderItem={renderMessage}
        style={{ flex: 1 }}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        windowSize={9}
        removeClippedSubviews={Platform.OS === 'android'}
        contentContainerStyle={{
          padding: 16,
          paddingBottom: 8,
          flexGrow: 1,
          justifyContent: isLoading ? 'center' : undefined,
        }}
        ListEmptyComponent={
          isLoading ? (
            <ActivityIndicator color={c.accent} />
          ) : (
            <Text style={{ textAlign: 'center', color: c.textSecondary, marginTop: 40 }}>No messages yet.</Text>
          )
        }
      />

      <View style={{ marginBottom: Platform.OS === 'android' ? keyboardInset : 0 }}>
        <MessageComposer
          channel={channel}
          onChannelChange={setChannel}
          canEmail={Boolean(conversation?.patient_email)}
          missingPatientEmail={!conversation?.patient_email}
          practiceName={practice?.name}
          patientFirst={conversation?.patient_first}
          practiceDoctor={practiceDoctor}
          sending={sendMessage.isPending}
          onSend={handleSend}
        />
      </View>
    </KeyboardAvoidingView>
  );
}
