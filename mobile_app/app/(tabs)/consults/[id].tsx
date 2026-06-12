import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useAuth } from '@/lib/auth-context';
import { OutcomeControls } from '@/components/outcome-controls';
import { useAppColors } from '@/lib/color-scheme-context';
import { usePermissions } from '@/lib/permissions';
import { useQueryClient } from '@tanstack/react-query';
import { useConsultDetail, useUpdateConsultOutcome } from '@/lib/queries/consult-detail';
import { queryKeys } from '@/lib/queries/keys';
import {
  consultTranscript,
  formatDate,
  formatDuration,
  isConsultAnalyzing,
  isConsultStillProcessing,
  isConsultTranscribing,
  statusMeta,
} from '@/lib/consults';
import { RecordingPlayer } from '@/components/recording-player';
import { AppCard } from '@/components/ui/AppCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { GateScreen } from '@/components/gate-screen';
import { requestAnalysis } from '@/lib/recording';

function AnalysisRow({ label, value }: { label: string; value?: string | null }) {
  const c = useAppColors();
  if (!value) return null;
  return (
    <View style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.border }}>
      <Text style={{ fontSize: 12, fontWeight: '600', color: c.textMuted, textTransform: 'uppercase' }}>
        {label}
      </Text>
      <Text style={{ fontSize: 15, color: c.text, marginTop: 4, lineHeight: 22 }}>{value}</Text>
    </View>
  );
}

export default function ConsultDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useAppColors();
  const { practiceId, user } = useAuth();
  const { canViewConsultDetail } = usePermissions();
  const queryClient = useQueryClient();
  const { data, isLoading, refetch } = useConsultDetail(id || null);
  const updateOutcome = useUpdateConsultOutcome();
  const analysisTriggeredFor = useRef<string | null>(null);
  const [pullRefreshing, setPullRefreshing] = useState(false);

  const consultStatus = data && !data.notFound ? data.consult.status : null;
  const analysisPending = isConsultAnalyzing(consultStatus);

  const onPullRefresh = useCallback(async () => {
    setPullRefreshing(true);
    try {
      await refetch();
    } finally {
      setPullRefreshing(false);
    }
  }, [refetch]);

  useEffect(() => {
    if (!analysisPending || !id) return;
    if (analysisTriggeredFor.current === id) return;
    analysisTriggeredFor.current = id;
    void requestAnalysis(id).catch((e) => {
      console.warn('[analyze] trigger failed:', e);
    });
  }, [analysisPending, id]);

  useEffect(() => {
    if (consultStatus === 'analyzed' && practiceId && id) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.processingConsults(practiceId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(practiceId) });
    }
  }, [consultStatus, practiceId, id, queryClient]);

  if (!canViewConsultDetail) {
    return (
      <GateScreen
        title="Access restricted"
        message="Your account role cannot view consult details with patient information."
      />
    );
  }

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.pageBg }}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }

  if (!data || data.notFound) {
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: 'center', backgroundColor: c.pageBg }}>
        <Text style={{ color: c.textSecondary, textAlign: 'center' }}>Consult not found.</Text>
      </View>
    );
  }

  const consult = data.consult;
  const transcript = consultTranscript(consult);
  const transcribing = isConsultTranscribing(consult.status);
  const analyzing = isConsultAnalyzing(consult.status);
  const patientName =
    consult.patient_name ||
    [consult.patient_first, consult.patient_last].filter(Boolean).join(' ') ||
    'Patient';

  const outcomeLabels: Record<string, string> = {
    accepted: 'accepted treatment',
    pending: 'start follow-up sequence',
    not_converting: 'not a fit',
  };

  function setOutcome(outcome: string) {
    if (!practiceId || !id) return;
    if (outcome === 'pending' && consult.outcome === 'pending' && consult.outcome_set_at) return;

    const label = outcomeLabels[outcome] || outcome.replace(/_/g, ' ');
    Alert.alert('Update outcome', `Mark this consult as "${label}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm',
        onPress: () => {
          void updateOutcome.mutateAsync({
            consultId: id,
            outcome,
            practiceId,
            userId: user?.id,
            followupApprovedAt: consult.followup_approved_at,
          });
        },
      },
    ]);
  }

  function stopSequence() {
    if (!practiceId || !id) return;
    void updateOutcome.mutateAsync({
      consultId: id,
      outcome: consult.outcome || 'pending',
      practiceId,
      pauseOnly: true,
      patch: { sequence_status: 'paused', sequence_paused_reason: 'manual' },
    });
  }

  const scheduledCount = data.messages.filter((m) =>
    ['draft', 'scheduled', 'pending'].includes(m.status || ''),
  ).length;

  const status = statusMeta(consult.status);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.pageBg }}
      contentContainerStyle={{ padding: 16, gap: 4, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={pullRefreshing} onRefresh={() => void onPullRefresh()} />}>
      <AppCard variant="tinted">
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          <View style={{ width: 4, alignSelf: 'stretch', backgroundColor: c.accent, borderRadius: 2 }} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 22, fontWeight: '700', color: c.text }}>{patientName}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <View
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 12,
                  backgroundColor: c.accentPill,
                }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: c.accent }}>{status.label}</Text>
              </View>
              {consult.recording_date ? (
                <Text style={{ fontSize: 13, color: c.textSecondary }}>{formatDate(consult.recording_date)}</Text>
              ) : null}
              {consult.duration ? (
                <Text style={{ fontSize: 13, color: c.textSecondary }}>{formatDuration(consult.duration)}</Text>
              ) : null}
            </View>
            {consult.patient_phone ? (
              <Text style={{ fontSize: 14, color: c.textSecondary, marginTop: 8 }}>{consult.patient_phone}</Text>
            ) : null}
          </View>
        </View>
      </AppCard>

      <SectionHeader>Recording</SectionHeader>
      <RecordingPlayer
        consultId={consult.id}
        hasAudio={Boolean(consult.audio_storage_path)}
        processing={transcribing && !consult.audio_storage_path}
      />

      {!transcript && isConsultStillProcessing(consult.status) ? (
        <>
          <SectionHeader>Transcript</SectionHeader>
          <AppCard variant="tinted">
            <Text style={{ color: c.accent, fontWeight: '600' }}>Transcript is being generated…</Text>
            <Text style={{ color: c.textSecondary, fontSize: 13, marginTop: 6 }}>
              This updates automatically — pull to refresh if needed.
            </Text>
          </AppCard>
        </>
      ) : transcript ? (
        <>
          <SectionHeader>Transcript</SectionHeader>
          <AppCard variant="tinted">
            <Text style={{ fontSize: 14, color: c.text, lineHeight: 22 }}>{transcript}</Text>
          </AppCard>
        </>
      ) : null}

      {analyzing && !consult.coaching_insight ? (
        <AppCard variant="tinted" style={{ marginTop: 8 }}>
          <Text style={{ color: c.accent, fontWeight: '600' }}>AI analysis in progress…</Text>
          <Text style={{ color: c.textSecondary, fontSize: 13, marginTop: 6 }}>
            Coaching insights and follow-up messages will appear shortly.
          </Text>
        </AppCard>
      ) : null}

      {(consult.coaching_insight || consult.what_happened || consult.primary_objection) && (
        <>
          <SectionHeader>AI Analysis</SectionHeader>
          <AppCard variant="tinted">
            <AnalysisRow label="What happened" value={consult.what_happened} />
            <AnalysisRow label="Primary objection" value={consult.primary_objection || consult.objection_type} />
            <AnalysisRow label="Exit intent" value={consult.exit_intent} />
            <AnalysisRow label="Coaching insight" value={consult.coaching_insight} />
            <AnalysisRow label="TC action" value={consult.tc_action} />
          </AppCard>
        </>
      )}

      <SectionHeader>Outcome</SectionHeader>
      <AppCard variant="tinted">
        <OutcomeControls
          consult={consult}
          scheduledCount={scheduledCount}
          pending={updateOutcome.isPending}
          onSelect={setOutcome}
          onStopSequence={stopSequence}
          onResumeSequence={() => setOutcome('pending')}
        />
      </AppCard>

      {data.messages.length > 0 ? (
        <>
          <SectionHeader>Sequence Messages</SectionHeader>
          <AppCard variant="tinted">
          {data.messages.slice(0, 5).map((msg) => (
            <View key={msg.id} style={{ marginBottom: 8 }}>
              <Text style={{ fontSize: 12, color: c.textMuted }}>
                {msg.channel} · {msg.status}
              </Text>
              <Text style={{ fontSize: 14, color: c.text }} numberOfLines={2}>
                {msg.body || msg.subject || '—'}
              </Text>
            </View>
          ))}
          <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 4 }}>
            Full sequence editing is available on desktop.
          </Text>
          </AppCard>
        </>
      ) : null}
    </ScrollView>
  );
}
