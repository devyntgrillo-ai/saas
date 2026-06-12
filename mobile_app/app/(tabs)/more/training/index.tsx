import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { CheckCircle2, Play } from 'lucide-react-native';
import { useAuth } from '@/lib/auth-context';
import { useAppColors } from '@/lib/color-scheme-context';
import { useTrainingCatalog } from '@/lib/queries/training';
import { AppCard } from '@/components/ui/AppCard';

export default function TrainingScreen() {
  const c = useAppColors();
  const router = useRouter();
  const { user } = useAuth();
  const { data: catalog, isLoading } = useTrainingCatalog(user?.id);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);

  const modules = catalog?.modules ?? [];
  const groups = catalog?.groups ?? [];
  const progress = catalog?.progress ?? {};

  const currentGroup = activeGroup || groups[0]?.key || null;
  const visible = useMemo(
    () => modules.filter((m) => (m.module_group || '') === currentGroup),
    [modules, currentGroup],
  );

  const completedCount = useMemo(
    () => Object.values(progress).filter((p) => p.completed_at).length,
    [progress],
  );

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}>
      {isLoading ? (
        <ActivityIndicator color={c.accent} />
      ) : (
        <>
          <AppCard>
            <Text style={{ fontSize: 15, fontWeight: '600', color: c.text }}>Your progress</Text>
            <Text style={{ fontSize: 14, color: c.textSecondary, marginTop: 4 }}>
              {completedCount} of {modules.length} modules completed
            </Text>
          </AppCard>

          {groups.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {groups.map((g) => {
                  const active = g.key === currentGroup;
                  return (
                    <Pressable
                      key={g.key}
                      onPress={() => setActiveGroup(g.key)}
                      style={{
                        paddingHorizontal: 14,
                        paddingVertical: 8,
                        borderRadius: 20,
                        backgroundColor: active ? c.accent : c.surfaceHi,
                      }}>
                      <Text style={{ fontWeight: '600', color: active ? '#FFF' : c.textSecondary }}>
                        {g.title || g.key}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          ) : null}

          {visible.map((mod) => {
            const done = Boolean(progress[mod.id]?.completed_at);
            return (
              <Pressable key={mod.id} onPress={() => router.push(`/more/training/${mod.id}` as const)}>
                <AppCard style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 10,
                      backgroundColor: done ? 'rgba(16, 185, 129, 0.15)' : c.accentSubtle,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                    {done ? <CheckCircle2 size={20} color={c.success} /> : <Play size={18} color={c.accent} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, fontWeight: '600', color: c.text }}>{mod.title}</Text>
                    {mod.description ? (
                      <Text style={{ fontSize: 13, color: c.textSecondary, marginTop: 2 }} numberOfLines={2}>
                        {mod.description}
                      </Text>
                    ) : null}
                    {mod.duration_minutes ? (
                      <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 4 }}>
                        {mod.duration_minutes} min
                      </Text>
                    ) : null}
                  </View>
                </AppCard>
              </Pressable>
            );
          })}

          {visible.length === 0 ? (
            <AppCard>
              <Text style={{ color: c.textSecondary }}>No modules in this group.</Text>
            </AppCard>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}
