import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ban, Check, CheckCircle2, Phone, PhoneCall, PhoneOff, Voicemail } from 'lucide-react-native';
import { useAuth } from '@/lib/auth-context';
import { useAppColors } from '@/lib/color-scheme-context';
import {
  useCompletePowerDialerLead,
  usePowerDialerQueue,
  type DialerLead,
  type Disposition,
} from '@/lib/queries/power-dialer';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { AppCard } from '@/components/ui/AppCard';
import { AppButton } from '@/components/ui/AppButton';

const DISPOSITIONS: Array<Disposition & { icon: typeof Check; color: string }> = [
  { key: 'scheduled', label: 'Reached — Scheduled', log: 'Reached, scheduled appointment', icon: Check, color: '#10B981' },
  { key: 'followup', label: 'Reached — Following up', log: 'Reached, will follow up', icon: PhoneCall, color: '#0EA5E9' },
  { key: 'no_answer', label: 'No answer', log: 'No answer', icon: PhoneOff, color: '#64748B' },
  { key: 'voicemail', label: 'Left voicemail', log: 'Left voicemail', icon: Voicemail, color: '#64748B' },
  { key: 'dnc', label: 'Do not contact', log: 'Do not contact', icon: Ban, color: '#EF4444' },
];

function ContextRow({ label, value }: { label: string; value?: string | null }) {
  const c = useAppColors();
  if (!value) return null;
  return (
    <View style={{ marginTop: 10 }}>
      <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 0.5, color: c.textMuted, textTransform: 'uppercase' }}>
        {label}
      </Text>
      <Text style={{ fontSize: 14, color: c.text, marginTop: 2, lineHeight: 20 }}>{value}</Text>
    </View>
  );
}

export default function PowerDialerScreen() {
  const c = useAppColors();
  const { practiceId, profile } = useAuth();
  const tcName = (profile?.display_name || profile?.full_name || 'You').split(' ')[0];
  const { data: queue = [], isLoading, refetch, isRefetching } = usePowerDialerQueue(practiceId);
  const complete = useCompletePowerDialerLead();

  const [session, setSession] = useState<DialerLead[] | null>(null);
  const [index, setIndex] = useState(0);
  const [note, setNote] = useState('');

  const lead = session?.[index] ?? null;
  const consult = lead?.consults ?? null;

  function start() {
    setSession(queue);
    setIndex(0);
    setNote('');
  }

  function advance() {
    setNote('');
    setIndex((i) => i + 1);
  }

  function callNow() {
    if (consult?.patient_phone) void Linking.openURL(`tel:${consult.patient_phone}`);
  }

  function logOutcome(dispo: Disposition) {
    if (!practiceId || !lead || !consult) return;
    complete.mutate({ practiceId, lead, consult, dispo, noteText: note.trim() || undefined, tcName });
    advance();
  }

  // ---- Loading ----
  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: c.pageBg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }

  // ---- Empty queue ----
  if (queue.length === 0) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: c.pageBg }} contentContainerStyle={{ padding: 16 }}>
        <AppCard style={{ alignItems: 'center', paddingVertical: 36, gap: 10 }}>
          <CheckCircle2 size={40} color="#10B981" />
          <Text style={{ fontSize: 18, fontWeight: '700', color: c.text }}>You&apos;re all caught up</Text>
          <Text style={{ fontSize: 14, color: c.textSecondary, textAlign: 'center' }}>
            No follow-up calls are due right now.
          </Text>
          <AppButton label="Refresh" variant="outline" onPress={() => void refetch()} />
        </AppCard>
      </ScrollView>
    );
  }

  // ---- Idle (not started) ----
  if (!session) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: c.pageBg }} contentContainerStyle={{ padding: 16, gap: 12 }}>
        <AppCard style={{ alignItems: 'center', paddingVertical: 32, gap: 8 }}>
          <View
            style={{
              width: 56, height: 56, borderRadius: 28, backgroundColor: c.accentPill,
              alignItems: 'center', justifyContent: 'center',
            }}>
            <PhoneCall size={26} color={c.accent} />
          </View>
          <Text style={{ fontSize: 28, fontWeight: '800', color: c.text }}>{queue.length}</Text>
          <Text style={{ fontSize: 15, color: c.textSecondary }}>
            follow-up call{queue.length === 1 ? '' : 's'} due today
          </Text>
          <View style={{ width: '100%', marginTop: 8 }}>
            <AppButton label="Start calling" onPress={start} />
          </View>
        </AppCard>
      </ScrollView>
    );
  }

  // ---- Session complete ----
  if (!lead || !consult) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: c.pageBg }} contentContainerStyle={{ padding: 16 }}>
        <AppCard style={{ alignItems: 'center', paddingVertical: 36, gap: 10 }}>
          <CheckCircle2 size={40} color="#10B981" />
          <Text style={{ fontSize: 18, fontWeight: '700', color: c.text }}>Session complete</Text>
          <Text style={{ fontSize: 14, color: c.textSecondary, textAlign: 'center' }}>
            You worked through all {session.length} call{session.length === 1 ? '' : 's'}.
          </Text>
          <AppButton
            label="Reload queue"
            variant="outline"
            onPress={() => { setSession(null); void refetch(); }}
          />
        </AppCard>
      </ScrollView>
    );
  }

  // ---- Active dialer ----
  const firstName = (consult.patient_name || 'Patient').split(' ')[0];
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.pageBg }} contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }}>
      <Text style={{ fontSize: 13, color: c.textMuted }}>
        Lead {index + 1} of {session.length}
      </Text>

      <AppCard style={{ gap: 2 }}>
        <Text style={{ fontSize: 20, fontWeight: '800', color: c.text }}>{consult.patient_name || 'Patient'}</Text>
        {consult.exit_intent_level ? (
          <Text style={{ fontSize: 13, color: c.textSecondary, marginTop: 2 }}>
            Exit intent: {consult.exit_intent_level}
          </Text>
        ) : null}
        <ContextRow label="Objection" value={consult.objection_type} />
        <ContextRow label="Personal detail" value={consult.personal_detail} />
        <ContextRow label="Next step" value={consult.tc_action} />
      </AppCard>

      <Pressable
        onPress={callNow}
        style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
          backgroundColor: c.accent, borderRadius: 16, paddingVertical: 18,
        }}>
        <Phone size={22} color="#fff" />
        <Text style={{ fontSize: 18, fontWeight: '800', color: '#fff' }}>Call {firstName}</Text>
      </Pressable>
      <Text style={{ fontSize: 12, color: c.textMuted, textAlign: 'center' }}>
        Opens your phone dialer. After the call, log the outcome below.
      </Text>

      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder="Add a note (optional)"
        placeholderTextColor={c.textMuted}
        style={{ color: c.text, borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 12, marginTop: 4 }}
      />

      <SectionHeader>Log outcome</SectionHeader>
      <View style={{ gap: 8 }}>
        {DISPOSITIONS.map((d) => (
          <Pressable
            key={d.key}
            onPress={() => logOutcome(d)}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 12,
              backgroundColor: c.surface, borderWidth: 1, borderColor: c.border,
              borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16,
            }}>
            <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: d.color + '22', alignItems: 'center', justifyContent: 'center' }}>
              <d.icon size={18} color={d.color} />
            </View>
            <Text style={{ fontSize: 16, fontWeight: '600', color: c.text }}>{d.label}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable onPress={advance} style={{ alignItems: 'center', paddingVertical: 14, marginTop: 4 }}>
        <Text style={{ fontSize: 15, color: c.textSecondary }}>Skip for now</Text>
      </Pressable>
      {isRefetching ? <ActivityIndicator color={c.accent} /> : null}
    </ScrollView>
  );
}
