import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Mic, Pause, Play, Square, X } from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { useAppColors } from '@/lib/color-scheme-context';
import { usePermissions } from '@/lib/permissions';
import { queryKeys } from '@/lib/queries/keys';
import {
  cancelRecording,
  pauseRecording,
  requestMicPermission,
  resumeRecording,
  startRecording,
  stopRecording,
} from '@/lib/native-recorder';
import {
  abandonConsult,
  createConsult,
  markTranscriptionError,
  requestAnalysis,
  saveConsultOutcome,
  transcribeRecording,
  uploadRecording,
  type RecordingPatient,
} from '@/lib/recording';
import { supabase } from '@/lib/supabase';
import { AppButton } from '@/components/ui/AppButton';
import { GateScreen } from '@/components/gate-screen';
import { NeuralNet } from '@/components/neural-net';
import { RecordingAssignment } from '@/components/recording-assignment';

type Phase =
  | 'assignment'
  | 'recording'
  | 'paused'
  | 'processing'
  | 'outcome'
  | 'analyzing'
  | 'done'
  | 'error';

const ANALYZE_MESSAGES = [
  'Transcribing the recording…',
  'Identifying treatment type and case value…',
  'Detecting objections raised…',
  'Building your coaching insights…',
  'Preparing your follow-up sequence…',
];

const OUTCOME_OPTIONS = [
  {
    value: 'accepted',
    emoji: '✅',
    title: 'Accepted Treatment',
    desc: 'Patient committed — no follow-up needed',
    color: '#10B981',
  },
  {
    value: 'pending',
    emoji: '📅',
    title: 'Start Follow-Up Sequence',
    desc: "Patient didn't commit today — start AI follow-up",
    color: '#0EA5E9',
  },
  {
    value: 'not_converting',
    emoji: '❌',
    title: 'Not a Fit',
    desc: "Patient won't be moving forward",
    color: '#F43F5E',
  },
] as const;

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const isEmail = (e?: string) => Boolean(e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim()));
const isUSPhone = (p?: string) => {
  const d = (p || '').replace(/\D/g, '');
  return d.length === 10 || (d.length === 11 && d[0] === '1');
};

export default function RecordScreen() {
  const c = useAppColors();
  const router = useRouter();
  const { practiceId, profile, user } = useAuth();
  const { canRecord } = usePermissions();
  const queryClient = useQueryClient();

  const [phase, setPhase] = useState<Phase>('assignment');
  const [selectedPatient, setSelectedPatient] = useState<RecordingPatient | null>(null);
  const [savedConsultId, setSavedConsultId] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const [analyzeMsg, setAnalyzeMsg] = useState(0);
  const [analyzeProgress, setAnalyzeProgress] = useState(8);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analysisTriggeredRef = useRef(false);
  const navDoneRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const beginRecording = useCallback(async () => {
    setError('');
    const granted = await requestMicPermission();
    if (!granted) {
      setError('Microphone permission is required to record consults.');
      setPhase('error');
      return;
    }
    try {
      await startRecording();
      setSeconds(0);
      setPhase('recording');
      clearTimer();
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start recording');
      setPhase('error');
    }
  }, [clearTimer]);

  const handleAssignmentConfirm = useCallback(
    (patient: RecordingPatient) => {
      setSelectedPatient(patient);
      void beginRecording();
    },
    [beginRecording],
  );

  const handleStop = useCallback(async () => {
    if (!practiceId || !selectedPatient) return;
    if (!isUSPhone(selectedPatient.phone) || !isEmail(selectedPatient.email)) {
      setError('Patient phone and email are required.');
      setPhase('error');
      return;
    }

    clearTimer();
    setPhase('processing');
    let consultId: string | null = null;
    let audioPath: string | null = null;
    try {
      const { buffer, contentType } = await stopRecording();
      const patient: RecordingPatient = {
        ...selectedPatient,
        tcName: profile?.display_name || profile?.full_name || selectedPatient.tcName,
      };
      consultId = await createConsult(practiceId, { durationSec: seconds, patient });
      setSavedConsultId(consultId);
      audioPath = await uploadRecording(practiceId, consultId, buffer, contentType);

      // Transcription runs in the background (don't block the outcome prompt). If
      // it fails, persist a recoverable transcription_error so the consult shows
      // an error + Retry on the detail screen instead of spinning on "analyzing"
      // forever (the web RecordingModal does the same).
      const bgConsultId = consultId;
      const bgAudioPath = audioPath;
      void transcribeRecording({ consultId: bgConsultId, audioPath: bgAudioPath, durationSec: seconds, patient }).catch((e) => {
        console.warn('[transcribe] background failed:', e);
        void markTranscriptionError(bgConsultId, bgAudioPath, e instanceof Error ? e.message : String(e)).catch(
          (markErr) => console.warn('[transcribe] could not mark error:', markErr),
        );
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(practiceId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.processingConsults(practiceId) });
      setPhase('outcome');
    } catch (e) {
      if (consultId) {
        try {
          await abandonConsult(practiceId, consultId, audioPath);
          setSavedConsultId(null);
          void queryClient.invalidateQueries({ queryKey: queryKeys.processingConsults(practiceId) });
        } catch (cleanupErr) {
          console.error('[record] cleanup failed', cleanupErr);
        }
      }
      const message = e instanceof Error ? e.message : 'Upload failed';
      console.error('[record]', message, e);
      setError(message);
      setPhase('error');
    }
  }, [practiceId, clearTimer, seconds, selectedPatient, profile, queryClient]);

  const handleCancel = useCallback(async () => {
    clearTimer();
    await cancelRecording();
    setPhase('assignment');
    setSelectedPatient(null);
    setSavedConsultId(null);
    setSeconds(0);
    setError('');
  }, [clearTimer]);

  const chooseOutcome = useCallback(
    async (outcome: string) => {
      if (!savedConsultId) return;
      try {
        await saveConsultOutcome(savedConsultId, outcome, user?.id);
      } catch (e) {
        console.warn('[outcome] save failed', e);
      }
      setPhase('analyzing');
    },
    [savedConsultId, user?.id],
  );

  const skipOutcome = useCallback(() => {
    if (!savedConsultId) return;
    setPhase('analyzing');
  }, [savedConsultId]);

  // Analyzing screen: cycle copy, climb a time-based progress bar, and poll the
  // consult until analysis completes — then open the detail page. Mirrors the web
  // ProcessingScreen (src/pages/ProcessingScreen.jsx).
  useEffect(() => {
    if (phase !== 'analyzing') return;
    navDoneRef.current = false;
    analysisTriggeredRef.current = false;
    setAnalyzeMsg(0);
    setAnalyzeProgress(8);
    const consultId = savedConsultId;
    if (!consultId) return;

    const msgTimer = setInterval(() => setAnalyzeMsg((i) => (i + 1) % ANALYZE_MESSAGES.length), 3000);
    const progTimer = setInterval(() => setAnalyzeProgress((p) => (p < 95 ? p + Math.max(1, (95 - p) * 0.06) : p)), 500);

    const goToConsult = () => {
      if (navDoneRef.current) return;
      navDoneRef.current = true;
      router.push(`/consults/${consultId}` as never);
    };

    let active = true;
    const poll = async () => {
      const { data } = await supabase.from('consults').select('status').eq('id', consultId).maybeSingle();
      if (!active || navDoneRef.current || !data) return;
      const status = data.status;
      if (status === 'transcription_error') return goToConsult();
      if (status === 'transcribed' && !analysisTriggeredRef.current) {
        analysisTriggeredRef.current = true;
        void requestAnalysis(consultId).catch(() => {});
      }
      if (status === 'analyzed') goToConsult();
    };
    void poll();
    const pollTimer = setInterval(() => void poll(), 4000);

    return () => {
      active = false;
      clearInterval(msgTimer);
      clearInterval(progTimer);
      clearInterval(pollTimer);
    };
  }, [phase, savedConsultId, router]);

  if (!canRecord) {
    return (
      <GateScreen
        title="Recording unavailable"
        message="Your account role cannot record consults. Ask your practice admin to upgrade your permissions."
      />
    );
  }

  if (phase === 'assignment') {
    return (
      <View style={{ flex: 1, backgroundColor: c.pageBg }}>
        <SafeAreaView edges={['top']} style={{ flex: 1 }}>
          <RecordingAssignment onConfirm={handleAssignmentConfirm} />
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.pageBg }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          {phase === 'analyzing' ? (
            <View style={{ width: '100%', alignItems: 'center' }}>
              <NeuralNet size={300} />
              <Text style={{ fontSize: 20, fontWeight: '700', color: c.text, marginTop: 12 }}>
                Analyzing your consultation
              </Text>
              <Text style={{ fontSize: 14, color: c.textSecondary, marginTop: 6, textAlign: 'center', minHeight: 20 }}>
                {ANALYZE_MESSAGES[analyzeMsg]}
              </Text>
              <View style={{ width: 240, marginTop: 18 }}>
                <View style={{ height: 4, borderRadius: 2, backgroundColor: c.border, overflow: 'hidden' }}>
                  <View style={{ height: 4, borderRadius: 2, width: `${analyzeProgress}%`, backgroundColor: c.accent }} />
                </View>
                <Text style={{ fontSize: 12, color: c.accent, marginTop: 8, fontWeight: '600', textAlign: 'center' }}>
                  {Math.round(analyzeProgress)}% analyzed
                </Text>
              </View>
              <Text style={{ fontSize: 13, color: c.textMuted, marginTop: 18, textAlign: 'center', maxWidth: 320, lineHeight: 19 }}>
                You can leave — we&apos;ll keep working in the background. Your transcript, insights, and
                follow-up will be ready on the consult.
              </Text>
              <View style={{ marginTop: 20, width: '100%', maxWidth: 320, gap: 6 }}>
                <AppButton
                  label="View consult now"
                  variant="outline"
                  onPress={() => { if (savedConsultId) router.push(`/consults/${savedConsultId}` as never); }}
                />
                <Pressable onPress={() => router.push('/' as never)} style={{ alignItems: 'center', paddingVertical: 10 }}>
                  <Text style={{ fontSize: 14, color: c.textSecondary }}>Go to dashboard</Text>
                </Pressable>
              </View>
            </View>
          ) : phase === 'processing' ? (
            <>
              <ActivityIndicator size="large" color={c.accent} />
              <Text style={{ fontSize: 18, fontWeight: '600', color: c.text, marginTop: 20 }}>
                Uploading your consult…
              </Text>
              <Text style={{ fontSize: 14, color: c.textSecondary, marginTop: 8, textAlign: 'center' }}>
                Transcription and AI analysis will continue in the background.
              </Text>
            </>
          ) : phase === 'outcome' ? (
            <View style={{ width: '100%', maxWidth: 400 }}>
              <Text style={{ fontSize: 20, fontWeight: '700', color: c.text, textAlign: 'center' }}>
                How did the consult go?
              </Text>
              <Text style={{ fontSize: 14, color: c.textSecondary, marginTop: 8, textAlign: 'center' }}>
                This determines whether we start the follow-up sequence.
              </Text>
              <View style={{ marginTop: 20, gap: 10 }}>
                {OUTCOME_OPTIONS.map((o) => (
                  <Pressable
                    key={o.value}
                    onPress={() => void chooseOutcome(o.value)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 14,
                      padding: 16,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: c.border,
                      backgroundColor: c.surface,
                    }}>
                    <Text style={{ fontSize: 28 }}>{o.emoji}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontWeight: '600', color: o.color }}>{o.title}</Text>
                      <Text style={{ fontSize: 12, color: c.textSecondary, marginTop: 2 }}>{o.desc}</Text>
                    </View>
                  </Pressable>
                ))}
              </View>
              <Pressable onPress={skipOutcome} style={{ marginTop: 16, alignItems: 'center' }}>
                <Text style={{ fontSize: 13, color: c.textMuted, fontWeight: '500' }}>Skip for now</Text>
              </Pressable>
            </View>
          ) : phase === 'done' ? (
            <>
              <Text style={{ fontSize: 22, fontWeight: '700', color: c.success }}>Recording saved</Text>
              <Text style={{ fontSize: 15, color: c.textSecondary, marginTop: 8, textAlign: 'center' }}>
                Opening consult…
              </Text>
            </>
          ) : phase === 'error' ? (
            <>
              <Text style={{ fontSize: 18, fontWeight: '600', color: c.danger }}>Something went wrong</Text>
              <Text style={{ fontSize: 14, color: c.textSecondary, marginTop: 8, textAlign: 'center' }}>{error}</Text>
              <View style={{ marginTop: 24, width: '100%', gap: 10 }}>
                <AppButton label="Try again" onPress={() => void handleCancel()} />
              </View>
            </>
          ) : (
            <>
              <View
                style={{
                  width: 128,
                  height: 128,
                  borderRadius: 24,
                  backgroundColor: phase === 'paused' ? c.textMuted : c.record,
                  alignItems: 'center',
                  justifyContent: 'center',
                  shadowColor: c.shadow,
                  shadowOpacity: 1,
                  shadowRadius: 16,
                  shadowOffset: { width: 0, height: 6 },
                  elevation: 6,
                }}>
                <Mic size={48} color="#FFFFFF" />
              </View>
              <Text
                style={{
                  fontSize: 48,
                  fontWeight: '700',
                  color: c.text,
                  marginTop: 32,
                  fontVariant: ['tabular-nums'],
                }}>
                {fmt(seconds)}
              </Text>
              <Text style={{ fontSize: 15, color: c.textSecondary, marginTop: 8 }}>
                {[selectedPatient?.firstName, selectedPatient?.lastName].filter(Boolean).join(' ') || 'Patient'}
              </Text>

              <View style={{ flexDirection: 'row', gap: 16, marginTop: 40 }}>
                <Pressable
                  onPress={() => void handleCancel()}
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 28,
                    borderWidth: 1,
                    borderColor: c.border,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                  <X size={24} color={c.textSecondary} />
                </Pressable>

                {phase === 'recording' || phase === 'paused' ? (
                  <Pressable
                    onPress={async () => {
                      if (phase === 'recording') {
                        await pauseRecording();
                        setPhase('paused');
                      } else {
                        await resumeRecording();
                        setPhase('recording');
                      }
                    }}
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 28,
                      backgroundColor: c.surfaceHi,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                    {phase === 'paused' ? (
                      <Play size={24} color={c.text} />
                    ) : (
                      <Pause size={24} color={c.text} />
                    )}
                  </Pressable>
                ) : null}

                <Pressable
                  onPress={() => void handleStop()}
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 28,
                    backgroundColor: c.record,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                  <Square size={22} color="#FFFFFF" fill="#FFFFFF" />
                </Pressable>
              </View>
            </>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}
