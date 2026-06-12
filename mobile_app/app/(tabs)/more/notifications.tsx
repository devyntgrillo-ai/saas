import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { useAuth } from '@/lib/auth-context';
import { useAppColors } from '@/lib/color-scheme-context';
import {
  registerForPushNotifications,
  useMyNotificationSettings,
  useUpdateMyNotificationSettings,
  type NotificationPrefs,
} from '@/lib/queries/notifications';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { AppCard } from '@/components/ui/AppCard';

// Channels mirror the web Settings page. Slack stays CaseLift-internal.
const EVENTS = [
  { key: 'patient_replied', label: 'Patient Replied', def: { email: true, sms: true, push: true } },
  { key: 'case_converted', label: 'Case Converted', def: { email: true, sms: true, push: true } },
  { key: 'daily_calls_due', label: 'Daily Calls Due', def: { email: true, sms: false, push: true } },
  { key: 'low_recording_rate', label: 'Low Recording Reminder', def: { email: true, sms: false, push: true }, noSms: true },
] as const;
const CHANNELS = ['email', 'sms', 'push'] as const;

function defaultPrefs(): NotificationPrefs {
  const out: NotificationPrefs = {};
  EVENTS.forEach((e) => { out[e.key] = { ...e.def }; });
  return out;
}

export default function NotificationsScreen() {
  const c = useAppColors();
  const { user, practiceId } = useAuth();
  const userId = user?.id;
  const { data: settings, isLoading } = useMyNotificationSettings(userId);
  const update = useUpdateMyNotificationSettings();

  const [prefs, setPrefs] = useState<NotificationPrefs>(defaultPrefs());
  const [email, setEmail] = useState('');
  const [sms, setSms] = useState('');
  const [push, setPush] = useState(true);
  const [recording, setRecording] = useState(false);
  const [digest, setDigest] = useState(true);

  useEffect(() => {
    if (!userId) return;
    const s = settings || ({} as NonNullable<typeof settings>);
    setPrefs({ ...defaultPrefs(), ...(s.notification_prefs || {}) });
    setEmail(s.notify_email_address || user?.email || '');
    setSms(s.notify_sms_number || '');
    setPush(s.notify_push ?? true);
    setRecording(s.recording_reminders_enabled ?? false);
    setDigest(s.weekly_digest_enabled ?? true);
  }, [settings, userId, user?.email]);

  function save(patch: Record<string, unknown>) {
    if (!userId) return;
    update.mutate({ userId, practiceId, patch });
  }

  function toggleCell(eventKey: string, channel: string) {
    const next: NotificationPrefs = {
      ...prefs,
      [eventKey]: { ...prefs[eventKey], [channel]: !prefs[eventKey]?.[channel as keyof typeof prefs[string]] },
    };
    setPrefs(next);
    save({ notification_prefs: next });
  }

  async function onTogglePush(v: boolean) {
    setPush(v);
    save({ notify_push: v });
    // Turning push on prompts for permission + registers this device's token.
    if (v && userId) await registerForPushNotifications(userId, practiceId);
  }

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: c.pageBg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.pageBg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Text style={{ fontSize: 13, color: c.textMuted, lineHeight: 19, marginBottom: 12 }}>
        These preferences are yours and sync with the CaseLift desktop app.
      </Text>

      <SectionHeader>Channels</SectionHeader>
      <AppCard style={{ gap: 14, marginBottom: 8 }}>
        <View>
          <Text style={{ fontSize: 13, color: c.textSecondary, marginBottom: 6 }}>Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            onEndEditing={() => save({ notify_email_address: email || null })}
            placeholder="you@practice.com"
            placeholderTextColor={c.textMuted}
            autoCapitalize="none"
            keyboardType="email-address"
            style={{ color: c.text, borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 10 }}
          />
        </View>
        <View>
          <Text style={{ fontSize: 13, color: c.textSecondary, marginBottom: 6 }}>SMS</Text>
          <TextInput
            value={sms}
            onChangeText={setSms}
            onEndEditing={() => save({ notify_sms_number: sms || null })}
            placeholder="(512) 555-0142"
            placeholderTextColor={c.textMuted}
            keyboardType="phone-pad"
            style={{ color: c.text, borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 10 }}
          />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={{ fontSize: 15, color: c.text }}>Push notifications</Text>
            <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>Alerts on this device</Text>
          </View>
          <Switch value={push} onValueChange={onTogglePush} trackColor={{ true: c.accent }} />
        </View>
      </AppCard>

      <SectionHeader>Events</SectionHeader>
      {EVENTS.map((e) => (
        <AppCard key={e.key} style={{ marginBottom: 8 }}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: c.text, marginBottom: 10 }}>{e.label}</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            {CHANNELS.map((ch) => {
              const disabled = 'noSms' in e && e.noSms && ch === 'sms';
              return (
                <View key={ch} style={{ alignItems: 'center', gap: 6, flex: 1 }}>
                  <Text style={{ fontSize: 12, color: c.textMuted, textTransform: 'capitalize' }}>{ch}</Text>
                  {disabled ? (
                    <Text style={{ color: c.textMuted }}>—</Text>
                  ) : (
                    <Switch
                      value={Boolean(prefs[e.key]?.[ch as keyof (typeof prefs)[string]])}
                      onValueChange={() => toggleCell(e.key, ch)}
                      trackColor={{ true: c.accent }}
                    />
                  )}
                </View>
              );
            })}
          </View>
        </AppCard>
      ))}
      <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2, marginBottom: 8 }}>
        Push goes to your registered devices. Slack alerts route only to CaseLift&apos;s internal channel.
      </Text>

      <SectionHeader>Reminders & digest</SectionHeader>
      <AppCard style={{ gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={{ fontSize: 15, color: c.text }}>Pre-consult recording reminder</Text>
            <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>Remind me to record before consults</Text>
          </View>
          <Switch value={recording} onValueChange={(v) => { setRecording(v); save({ recording_reminders_enabled: v }); }} trackColor={{ true: c.accent }} />
        </View>
        <View style={{ height: 1, backgroundColor: c.border }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={{ fontSize: 15, color: c.text }}>Weekly digest</Text>
            <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>A weekly performance summary by email</Text>
          </View>
          <Switch value={digest} onValueChange={(v) => { setDigest(v); save({ weekly_digest_enabled: v }); }} trackColor={{ true: c.accent }} />
        </View>
      </AppCard>
    </ScrollView>
  );
}
