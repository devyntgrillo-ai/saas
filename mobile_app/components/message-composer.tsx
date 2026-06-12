import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Mail, MessageSquare, Send, Smile, Trash2, Zap } from 'lucide-react-native';
import { useAppColors, useAppTheme } from '@/lib/color-scheme-context';

const QUICK_EMOJIS = ['😊', '👍', '❤️', '🙏', '💪', '✅', '📅', '💰'];

const SNIPPETS = [
  'Hi [name], just checking in! Do you have any questions about your implant options?',
  'Hi [name], Dr. [doctor] wanted me to follow up. We have openings this week if you’d like to come in.',
  'Hi [name], we have financing options starting at $X/month. Want me to send you the details?',
  'Hi [name], just a friendly reminder that your consultation offer is still available.',
];

function ChannelToggle({
  channel,
  onSwitch,
  canEmail,
}: {
  channel: 'sms' | 'email';
  onSwitch: (ch: 'sms' | 'email') => void;
  canEmail: boolean;
}) {
  const c = useAppColors();
  const options = [
    { value: 'sms' as const, label: 'SMS', Icon: MessageSquare },
    { value: 'email' as const, label: 'Email', Icon: Mail },
  ];

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surfaceHi,
        padding: 4,
      }}>
      {options.map(({ value, label, Icon }) => {
        if (value === 'email' && !canEmail) return null;
        const active = channel === value;
        return (
          <Pressable
            key={value}
            onPress={() => onSwitch(value)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 8,
              backgroundColor: active ? c.accent : 'transparent',
            }}>
            <Icon size={14} color={active ? '#FFFFFF' : c.textSecondary} />
            <Text
              style={{
                fontSize: 13,
                fontWeight: '600',
                color: active ? '#FFFFFF' : c.textSecondary,
              }}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function MessageComposer({
  onSend,
  sending,
  channel,
  onChannelChange,
  canEmail,
  practiceName,
  patientFirst,
  practiceDoctor,
  missingPatientEmail,
}: {
  onSend: (body: string, channel: 'sms' | 'email', subject?: string) => void;
  sending: boolean;
  channel: 'sms' | 'email';
  onChannelChange: (ch: 'sms' | 'email') => void;
  canEmail: boolean;
  practiceName?: string | null;
  patientFirst?: string | null;
  practiceDoctor?: string | null;
  missingPatientEmail?: boolean;
}) {
  const c = useAppColors();
  const { colorScheme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [snippetsOpen, setSnippetsOpen] = useState(false);

  const defaultSubject = `Message from ${practiceName || 'your care team'}`;

  function discardDraft() {
    setDraft('');
    setEmailSubject('');
    setEmojiOpen(false);
    setSnippetsOpen(false);
  }

  function insertEmoji(emoji: string) {
    setDraft((d) => d + emoji);
    setEmojiOpen(false);
  }

  function fillSnippet(snippet: string) {
    const text = snippet
      .replace(/\[name\]/g, patientFirst || 'name')
      .replace(/\[doctor\]/g, practiceDoctor || 'doctor');
    setDraft(text);
    setSnippetsOpen(false);
  }

  function submit() {
    const body = draft.trim();
    if (!body || sending) return;
    if (channel === 'email' && missingPatientEmail) return;
    const subject = channel === 'email' ? emailSubject.trim() || defaultSubject : undefined;
    setDraft('');
    if (channel === 'email') setEmailSubject('');
    onSend(body, channel, subject);
  }

  const sendDisabled = !draft.trim() || sending || (channel === 'email' && missingPatientEmail);

  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: c.border,
        backgroundColor: c.pageBg,
        paddingHorizontal: 12,
        paddingTop: 10,
        paddingBottom: Math.max(insets.bottom, 10),
      }}>
      <View
        style={{
          borderRadius: 12,
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.surface,
          overflow: 'hidden',
        }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottomWidth: 1,
            borderBottomColor: c.border,
            paddingHorizontal: 8,
            paddingVertical: 8,
          }}>
          <ChannelToggle channel={channel} onSwitch={onChannelChange} canEmail={canEmail} />
        </View>

        {channel === 'email' && missingPatientEmail ? (
          <View
            style={{
              borderBottomWidth: 1,
              borderBottomColor: colorScheme === 'dark' ? '#78350F' : '#FDE68A',
              backgroundColor: colorScheme === 'dark' ? '#78350F33' : '#FFFBEB',
              paddingHorizontal: 14,
              paddingVertical: 10,
            }}>
            <Text style={{ fontSize: 12, color: colorScheme === 'dark' ? '#FCD34D' : '#92400E' }}>
              Add a patient email on this conversation before sending.
            </Text>
          </View>
        ) : null}

        {channel === 'email' ? (
          <>
            <TextInput
              value={emailSubject}
              onChangeText={setEmailSubject}
              placeholder="Subject: Enter subject"
              placeholderTextColor={c.textMuted}
              style={{
                borderBottomWidth: 1,
                borderBottomColor: c.border,
                paddingHorizontal: 14,
                paddingVertical: 12,
                fontSize: 14,
                color: c.text,
              }}
            />
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Type a message"
              placeholderTextColor={c.textMuted}
              multiline
              textAlignVertical="top"
              style={{
                minHeight: 140,
                maxHeight: 220,
                paddingHorizontal: 14,
                paddingVertical: 12,
                fontSize: 15,
                lineHeight: 22,
                color: c.text,
              }}
            />
          </>
        ) : (
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Type a message"
            placeholderTextColor={c.textMuted}
            multiline
            textAlignVertical="top"
            style={{
              minHeight: 56,
              maxHeight: 120,
              paddingHorizontal: 14,
              paddingVertical: 12,
              fontSize: 15,
              lineHeight: 22,
              color: c.text,
            }}
          />
        )}

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderTopWidth: 1,
            borderTopColor: c.border,
            backgroundColor: c.surfaceHi,
            paddingHorizontal: 6,
            paddingVertical: 6,
          }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <Pressable
              onPress={() => {
                setEmojiOpen((v) => !v);
                setSnippetsOpen(false);
              }}
              style={{
                padding: 8,
                borderRadius: 8,
                backgroundColor: emojiOpen ? c.chipBg : 'transparent',
              }}>
              <Smile size={18} color={c.textSecondary} />
            </Pressable>
            <Pressable
              onPress={() => {
                setSnippetsOpen((v) => !v);
                setEmojiOpen(false);
              }}
              style={{
                padding: 8,
                borderRadius: 8,
                backgroundColor: snippetsOpen ? c.chipBg : 'transparent',
              }}>
              <Zap size={18} color={c.textSecondary} />
            </Pressable>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Pressable onPress={discardDraft} style={{ padding: 8 }} accessibilityLabel="Discard draft">
              <Trash2 size={18} color={c.textSecondary} />
            </Pressable>
            {sending ? (
              <ActivityIndicator color={c.accent} style={{ marginHorizontal: 10 }} />
            ) : (
              <Pressable
                onPress={submit}
                disabled={sendDisabled}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: 8,
                  backgroundColor: sendDisabled ? c.chipBg : c.accent,
                }}>
                <Send size={16} color={sendDisabled ? c.textMuted : '#FFFFFF'} />
              </Pressable>
            )}
          </View>
        </View>
      </View>

      {emojiOpen ? (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 6,
            marginTop: 8,
            padding: 10,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.surface,
          }}>
          {QUICK_EMOJIS.map((emoji) => (
            <Pressable
              key={emoji}
              onPress={() => insertEmoji(emoji)}
              style={{
                width: 40,
                height: 40,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 8,
                backgroundColor: c.surfaceHi,
              }}>
              <Text style={{ fontSize: 22 }}>{emoji}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {snippetsOpen ? (
        <ScrollView
          style={{
            maxHeight: 160,
            marginTop: 8,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.surface,
          }}
          keyboardShouldPersistTaps="handled">
          <Text
            style={{
              fontSize: 11,
              fontWeight: '600',
              color: c.textMuted,
              textTransform: 'uppercase',
              paddingHorizontal: 12,
              paddingTop: 10,
              paddingBottom: 6,
            }}>
            Snippets
          </Text>
          {SNIPPETS.map((snippet, i) => (
            <Pressable
              key={i}
              onPress={() => fillSnippet(snippet)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 10,
                borderTopWidth: i > 0 ? 1 : 0,
                borderTopColor: c.border,
              }}>
              <Text style={{ fontSize: 13, color: c.textSecondary, lineHeight: 18 }}>
                {snippet
                  .replace(/\[name\]/g, patientFirst || 'name')
                  .replace(/\[doctor\]/g, practiceDoctor || 'doctor')}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}
