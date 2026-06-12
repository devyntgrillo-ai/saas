import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Award,
  Calendar,
  ClipboardList,
  Inbox,
  Mic,
  RefreshCw,
} from 'lucide-react-native';
import { useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useAppColors } from '@/lib/color-scheme-context';
import { useDashboard } from '@/lib/queries/dashboard';
import { useProcessingConsults } from '@/lib/queries/consults';
import {
  closeRateForRows,
  computeRecordingRate,
  countUnscheduledTxPlans,
} from '@/lib/dashboard-metrics';
import { AppHeader } from '@/components/app-header';
import { StatCard } from '@/components/stat-card';
import { AppCard } from '@/components/ui/AppCard';
import { SectionHeader } from '@/components/ui/SectionHeader';

const QUICK_ACTIONS = [
  { label: 'Record', icon: Mic, route: '/record', color: '#EF4444' },
  { label: 'Consults', icon: ClipboardList, route: '/consults', color: '#0EA5E9' },
  { label: 'Inbox', icon: Inbox, route: '/inbox', color: '#6366F1' },
  { label: 'Training', icon: Award, route: '/more/training', color: '#10B981' },
] as const;

export default function DashboardScreen() {
  const c = useAppColors();
  const router = useRouter();
  const { practiceId, profile } = useAuth();
  const { data, isLoading, error, refetch, isRefetching } = useDashboard(practiceId);
  const { data: processing = [] } = useProcessingConsults(practiceId);

  const firstName = (profile?.display_name || profile?.full_name || '').trim().split(/\s+/)[0] || null;
  const greeting = firstName ? `Welcome back, ${firstName}` : 'Welcome back';

  const metrics = useMemo(() => {
    const consults = data?.consults ?? [];
    const dashExtras = data?.dashExtras ?? {
      sentConsultIds: new Set<string>(),
      repliedConsultIds: new Set<string>(),
    };
    const monthStart = new Date();
    monthStart.setDate(1);
    const monthConsults = consults.filter((row) => {
      const d = row.created_at ? new Date(row.created_at) : null;
      return d && d >= monthStart;
    });
    const sentCount = dashExtras.sentConsultIds.size;
    const repliedCount = dashExtras.repliedConsultIds.size;
    const replyRate = sentCount ? Math.round((repliedCount / sentCount) * 100) : 0;

    return {
      recordingRate: computeRecordingRate(consults),
      unscheduledPlans: countUnscheduledTxPlans(consults),
      replyRate,
      closeRate: closeRateForRows(monthConsults),
      unreadConvos: data?.unreadConvos ?? 0,
      implantApptsWeek: data?.implantApptsWeek ?? 0,
    };
  }, [data]);

  return (
    <View style={{ flex: 1, backgroundColor: c.pageBg }}>
      <AppHeader />
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 22, fontWeight: '700', color: c.text }}>{greeting}</Text>
          <Pressable onPress={() => void refetch()} style={{ padding: 8 }}>
            <RefreshCw size={20} color={c.accent} />
          </Pressable>
        </View>

        {isLoading ? (
          <ActivityIndicator color={c.accent} style={{ marginTop: 40 }} />
        ) : error ? (
          <AppCard>
            <Text style={{ color: c.danger }}>Could not load dashboard. Pull to refresh.</Text>
          </AppCard>
        ) : (
          <>
            {processing.length > 0 ? (
              <AppCard variant="tinted" style={{ borderColor: c.accent }}>
                <Text style={{ fontWeight: '600', color: c.accent }}>
                  {processing.length} consult{processing.length === 1 ? '' : 's'} in progress
                </Text>
                <Text style={{ fontSize: 13, color: c.textSecondary, marginTop: 4 }}>
                  {processing.some((p) => p.status === 'analyzing')
                    ? 'Transcription and AI analysis running'
                    : 'AI analysis and follow-up sequence drafting'}
                </Text>
              </AppCard>
            ) : null}

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              <StatCard period="Last 30 days" label="Recording rate" value={`${metrics.recordingRate}%`} icon={Mic} tone="blue" />
              <StatCard period="Last 30 days" label="Unscheduled plans" value={String(metrics.unscheduledPlans)} icon={ClipboardList} tone="orange" />
              <StatCard period="Last 30 days" label="Reply rate" value={`${metrics.replyRate}%`} icon={Inbox} tone="violet" />
              <StatCard period="This month" label="Close rate" value={`${metrics.closeRate}%`} icon={Award} tone="green" />
            </View>

            <View>
              <SectionHeader>Today</SectionHeader>
              <AppCard>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Calendar size={18} color={c.accent} />
                    <Text style={{ color: c.textSecondary }}>Unread messages</Text>
                  </View>
                  <Text style={{ fontWeight: '700', color: c.text, fontSize: 17 }}>{metrics.unreadConvos}</Text>
                </View>
                <View style={{ height: 1, backgroundColor: c.border, marginVertical: 10 }} />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                  <Text style={{ color: c.textSecondary }}>Implant consults this week</Text>
                  <Text style={{ fontWeight: '700', color: c.text, fontSize: 17 }}>{metrics.implantApptsWeek}</Text>
                </View>
              </AppCard>
            </View>

            <View>
              <SectionHeader>Quick Actions</SectionHeader>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                {QUICK_ACTIONS.map((action) => (
                  <Pressable
                    key={action.label}
                    onPress={() => router.push(action.route as never)}
                    style={{ flex: 1, alignItems: 'center', gap: 8 }}>
                    <View
                      style={{
                        width: 52,
                        height: 52,
                        borderRadius: 26,
                        borderWidth: 1,
                        borderColor: c.border,
                        backgroundColor: c.surface,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                      <action.icon size={22} color={action.color} />
                    </View>
                    <Text style={{ fontSize: 11, fontWeight: '500', color: c.textSecondary, textAlign: 'center' }}>
                      {action.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}
