import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Award, Calendar, ClipboardList, Clock, DollarSign, RefreshCw } from 'lucide-react-native';
import { useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useAppColors } from '@/lib/color-scheme-context';
import { useDashboard } from '@/lib/queries/dashboard';
import { useProcessingConsults } from '@/lib/queries/consults';
import { computeAttributedProduction, countSentMessages, formatMoney } from '@/lib/dashboard-metrics';
import { AppHeader } from '@/components/app-header';
import { StatCard } from '@/components/stat-card';
import { AppCard } from '@/components/ui/AppCard';
import { SectionHeader } from '@/components/ui/SectionHeader';

export default function DashboardScreen() {
  const c = useAppColors();
  const { practiceId, practice, profile } = useAuth();
  const { data, isLoading, error, refetch, isRefetching } = useDashboard(practiceId);
  const { data: processing = [] } = useProcessingConsults(practiceId);

  const firstName = (profile?.display_name || profile?.full_name || '').trim().split(/\s+/)[0] || null;
  const greeting = firstName ? `Welcome back, ${firstName}` : 'Welcome back';

  const metrics = useMemo(() => {
    const consults = data?.consults ?? [];
    const messages = data?.messages ?? [];
    const dashExtras = data?.dashExtras ?? {
      sentConsultIds: new Set<string>(),
      repliedConsultIds: new Set<string>(),
    };
    // Mirrors the web dashboard KPI grid (src/pages/Dashboard.jsx).
    const prod = computeAttributedProduction(consults, practice, {
      sentSet: dashExtras.sentConsultIds,
      repliedSet: dashExtras.repliedConsultIds,
    });
    const unscheduledPlans = consults.filter((row) => row.outcome === 'pending');
    const unscheduledTxValue = unscheduledPlans.reduce(
      (sum, row) => sum + (Number(row.tx_plan_value) || Number(row.case_value) || 0),
      0,
    );
    const messagesSent = countSentMessages(messages);
    const hoursSaved = Math.round((messagesSent * 5) / 60 * 10) / 10;

    return {
      productionRecovered: prod.confirmed,
      roi: prod.roi,
      unscheduledTxValue,
      unscheduledTxPlans: unscheduledPlans.length,
      hoursSaved,
      messagesSent,
      unreadConvos: data?.unreadConvos ?? 0,
      implantApptsWeek: data?.implantApptsWeek ?? 0,
    };
  }, [data, practice]);

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
              <StatCard
                label="Production Recovered"
                value={formatMoney(metrics.productionRecovered)}
                sub="CaseLift-assisted"
                icon={DollarSign}
                tone="green"
              />
              <StatCard
                label="Pipeline Value"
                value={formatMoney(metrics.unscheduledTxValue)}
                sub={`${metrics.unscheduledTxPlans} unscheduled tx plans`}
                icon={ClipboardList}
                tone="blue"
              />
              <StatCard
                label="Hours Saved"
                value={`${metrics.hoursSaved}h`}
                sub={`${metrics.messagesSent} auto follow-ups`}
                icon={Clock}
                tone="violet"
              />
              <StatCard
                label="ROI This Month"
                value={metrics.roi ? `${metrics.roi}x ROI` : '-'}
                sub="Production ÷ Subscription"
                icon={Award}
                tone="green"
              />
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
          </>
        )}
      </ScrollView>
    </View>
  );
}
