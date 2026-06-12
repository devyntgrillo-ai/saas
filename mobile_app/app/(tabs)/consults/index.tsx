import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { format } from 'date-fns';
import { useAuth } from '@/lib/auth-context';
import { useAppColors } from '@/lib/color-scheme-context';
import { useConsultArchive, useProcessingConsults, useTodayAppointments } from '@/lib/queries/consults';
import { AppHeader } from '@/components/app-header';
import { AppCard } from '@/components/ui/AppCard';
import { FilterChip } from '@/components/ui/FilterChip';
import { SearchBar } from '@/components/ui/SearchBar';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { usePermissions } from '@/lib/permissions';

function StatusBadge({ status }: { status?: string }) {
  const c = useAppColors();
  const colors: Record<string, string> = {
    analyzing: c.warning,
    transcribed: c.accent,
    analyzed: c.success,
    active: c.accent,
    closed_won: c.success,
  };
  const color = colors[status || ''] || c.textMuted;
  return (
    <Text style={{ fontSize: 11, fontWeight: '600', color, textTransform: 'capitalize' }}>
      {(status || 'unknown').replace(/_/g, ' ')}
    </Text>
  );
}

function ScheduleEventCard({
  name,
  time,
  subtitle,
  onPress,
}: {
  name: string;
  time: string;
  subtitle?: string;
  onPress?: () => void;
}) {
  const c = useAppColors();
  const content = (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: c.surface,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: c.border,
        overflow: 'hidden',
        marginBottom: 10,
      }}>
      <View style={{ width: 4, backgroundColor: c.accent }} />
      <View style={{ flex: 1, flexDirection: 'row', padding: 14, gap: 12, alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: c.text }} numberOfLines={1}>
            {name}
          </Text>
          {subtitle ? (
            <Text style={{ fontSize: 13, color: c.textSecondary, marginTop: 4 }} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <UserAvatar name={name} size={36} />
        {time ? (
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 12, fontWeight: '600', color: c.text }}>{time}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
  if (onPress) return <Pressable onPress={onPress}>{content}</Pressable>;
  return content;
}

export default function ConsultsScreen() {
  const c = useAppColors();
  const router = useRouter();
  const { practiceId } = useAuth();
  const { canViewPHI, canViewConsultDetail } = usePermissions();
  const [tab, setTab] = useState<'schedule' | 'recordings'>('schedule');
  const [search, setSearch] = useState('');

  const { data: appts = [], isLoading: apptsLoading, refetch: refetchAppts, isRefetching } =
    useTodayAppointments(practiceId);
  const { data: processing = [] } = useProcessingConsults(practiceId);
  const { data: archive, isLoading: archiveLoading, refetch: refetchArchive } = useConsultArchive(
    practiceId,
    search,
    0,
  );

  const todayLabel = format(new Date(), 'EEE, MMM dd, yyyy');

  return (
    <View style={{ flex: 1, backgroundColor: c.pageBg }}>
      <AppHeader title="Consults" />

      <ScrollView
        style={{ flex: 1, marginTop: 16 }}
        stickyHeaderIndices={[0]}
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => {
              void refetchAppts();
              void refetchArchive();
            }}
          />
        }>
        <View
          style={{
            paddingHorizontal: 16,
            paddingBottom: 12,
            backgroundColor: c.pageBg,
          }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <FilterChip label="Schedule" active={tab === 'schedule'} onPress={() => setTab('schedule')} />
            <FilterChip label="Recordings" active={tab === 'recordings'} onPress={() => setTab('recordings')} />
          </View>
        </View>

        <View style={{ paddingHorizontal: 16 }}>
        {!canViewPHI ? (
          <AppCard variant="tinted">
            <Text style={{ color: c.textSecondary }}>
              Your role can view schedule counts only. Contact your practice admin for full access.
            </Text>
          </AppCard>
        ) : null}

        {tab === 'schedule' ? (
          apptsLoading ? (
            <ActivityIndicator color={c.accent} style={{ marginTop: 24 }} />
          ) : (
            <>
              <View style={{ alignItems: 'center', marginVertical: 12 }}>
                <View
                  style={{
                    backgroundColor: c.accentPill,
                    paddingHorizontal: 16,
                    paddingVertical: 8,
                    borderRadius: 20,
                  }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: c.accent }}>{todayLabel}</Text>
                </View>
              </View>

              {processing.map((cst) => (
                <ScheduleEventCard
                  key={cst.id}
                  name={cst.patient_name || 'Processing…'}
                  time=""
                  subtitle={cst.status?.replace(/_/g, ' ')}
                  onPress={() => canViewConsultDetail && router.push(`/consults/${cst.id}`)}
                />
              ))}

              {appts.length === 0 && processing.length === 0 ? (
                <AppCard variant="tinted">
                  <Text style={{ color: c.textSecondary, textAlign: 'center' }}>
                    No appointments scheduled for today.
                  </Text>
                </AppCard>
              ) : (
                appts.map((appt) => {
                  const name = [appt.patient_first, appt.patient_last].filter(Boolean).join(' ') || 'Patient';
                  const time = appt.appointment_time
                    ? format(new Date(appt.appointment_time), 'h:mm a')
                    : '';
                  return (
                    <ScheduleEventCard
                      key={appt.id}
                      name={name}
                      time={time}
                      subtitle={appt.appointment_type || undefined}
                    />
                  );
                })
              )}
            </>
          )
        ) : archiveLoading ? (
          <ActivityIndicator color={c.accent} style={{ marginTop: 24 }} />
        ) : (
          <>
            <View style={{ marginBottom: 12 }}>
              <SearchBar value={search} onChangeText={setSearch} placeholder="Search patients…" />
            </View>
            {(archive?.rows || []).map((row) => {
              const name = canViewPHI
                ? row.patient_name || [row.patient_first, row.patient_last].filter(Boolean).join(' ') || 'Unknown'
                : 'Patient';
              return (
                <Pressable
                  key={row.id}
                  onPress={() => canViewConsultDetail && router.push(`/consults/${row.id}`)}>
                  <AppCard style={{ marginBottom: 10 }}>
                    <Text style={{ fontWeight: '600', color: c.text, fontSize: 16 }}>{name}</Text>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
                      <StatusBadge status={row.status} />
                      <Text style={{ fontSize: 12, color: c.textMuted }}>
                        {row.recording_date || (row.created_at ? format(new Date(row.created_at), 'MMM d') : '')}
                      </Text>
                    </View>
                  </AppCard>
                </Pressable>
              );
            })}
            {(archive?.rows || []).length === 0 ? (
              <AppCard variant="tinted">
                <Text style={{ color: c.textSecondary, textAlign: 'center' }}>No recordings yet.</Text>
              </AppCard>
            ) : null}
          </>
        )}
        </View>
      </ScrollView>
    </View>
  );
}
