import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { format, formatDistanceToNow } from 'date-fns';
import { MessageCircle } from 'lucide-react-native';
import { useAuth } from '@/lib/auth-context';
import { useAppColors } from '@/lib/color-scheme-context';
import { usePermissions } from '@/lib/permissions';
import { useConversationsList } from '@/lib/queries/conversations';
import { AppHeader } from '@/components/app-header';
import { GateScreen } from '@/components/gate-screen';
import { FilterChip } from '@/components/ui/FilterChip';
import { SearchBar } from '@/components/ui/SearchBar';
import { UserAvatar } from '@/components/ui/UserAvatar';

type Filter = 'recent' | 'unread' | 'starred';

export default function InboxScreen() {
  const c = useAppColors();
  const router = useRouter();
  const { practiceId } = useAuth();
  const { canViewConversations } = usePermissions();
  const { data: conversations = [], isLoading, error, refetch, isRefetching } = useConversationsList(practiceId);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('recent');

  const filtered = useMemo(() => {
    let rows = conversations;
    if (filter === 'unread') rows = rows.filter((r) => (r.unread_count || 0) > 0);
    if (filter === 'starred') rows = rows.filter((r) => Boolean(r.starred));
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) =>
        [r.patient_first, r.patient_last].filter(Boolean).join(' ').toLowerCase().includes(q),
      );
    }
    return rows;
  }, [conversations, filter, search]);

  if (!canViewConversations) {
    return (
      <GateScreen
        title="Inbox unavailable"
        message="Your account role cannot access patient conversations. Contact your practice admin."
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.pageBg }}>
      <AppHeader title="Inbox" />
      <View style={{ marginTop: 16, paddingHorizontal: 16, paddingBottom: 12, gap: 12 }}>
        <SearchBar value={search} onChangeText={setSearch} placeholder="Search conversations" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          <FilterChip label="Recent" active={filter === 'recent'} onPress={() => setFilter('recent')} />
          <FilterChip label="Unread" active={filter === 'unread'} onPress={() => setFilter('unread')} />
          <FilterChip label="Starred" active={filter === 'starred'} onPress={() => setFilter('starred')} />
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}>
        {isLoading ? (
          <ActivityIndicator color={c.accent} style={{ marginTop: 24 }} />
        ) : error ? (
          <Text style={{ textAlign: 'center', color: c.danger, marginTop: 40 }}>
            Could not load conversations. Pull to refresh.
          </Text>
        ) : filtered.length === 0 ? (
          <Text style={{ textAlign: 'center', color: c.textSecondary, marginTop: 40 }}>No conversations found.</Text>
        ) : (
          filtered.map((convo) => {
            const name = [convo.patient_first, convo.patient_last].filter(Boolean).join(' ') || 'Patient';
            const unread = (convo.unread_count || 0) > 0;
            return (
              <Pressable key={convo.id} onPress={() => router.push(`/inbox/${convo.id}`)}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    paddingVertical: 14,
                    borderBottomWidth: 1,
                    borderBottomColor: c.border,
                  }}>
                  <UserAvatar
                    name={name}
                    badge={
                      <View
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: 9,
                          backgroundColor: c.success,
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderWidth: 2,
                          borderColor: c.surface,
                        }}>
                        <MessageCircle size={10} color="#FFF" />
                      </View>
                    }
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, fontWeight: unread ? '700' : '600', color: c.text }}>{name}</Text>
                    {convo.last_message_at ? (
                      <Text style={{ fontSize: 13, color: c.textSecondary, marginTop: 3 }} numberOfLines={1}>
                        {formatDistanceToNow(new Date(convo.last_message_at), { addSuffix: true })}
                      </Text>
                    ) : null}
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 6 }}>
                    {convo.last_message_at ? (
                      <Text style={{ fontSize: 11, color: c.textMuted }}>
                        {format(new Date(convo.last_message_at), 'MM/dd/yy')}
                      </Text>
                    ) : null}
                    {unread ? (
                      <View
                        style={{
                          minWidth: 22,
                          height: 22,
                          borderRadius: 11,
                          backgroundColor: c.badge,
                          alignItems: 'center',
                          justifyContent: 'center',
                          paddingHorizontal: 6,
                        }}>
                        <Text style={{ color: '#FFF', fontSize: 11, fontWeight: '700' }}>{convo.unread_count}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}
