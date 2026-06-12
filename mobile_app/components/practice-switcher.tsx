import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pin, X } from 'lucide-react-native';
import { useAppColors } from '@/lib/color-scheme-context';
import { useAuth, type Practice } from '@/lib/auth-context';
import { SearchBar } from '@/components/ui/SearchBar';
import { UserAvatar } from '@/components/ui/UserAvatar';

function cityState(p: Practice) {
  const parts = [p.city, p.state].filter(Boolean);
  if (parts.length) return parts.join(', ');
  return p.address || '';
}

export function PracticeSwitcher({ open, onClose }: { open: boolean; onClose: () => void }) {
  const c = useAppColors();
  const insets = useSafeAreaInsets();
  const { accessiblePractices, practiceId, viewPractice } = useAuth();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return accessiblePractices;
    return accessiblePractices.filter(
      (p) =>
        p.name?.toLowerCase().includes(q) ||
        cityState(p).toLowerCase().includes(q),
    );
  }, [accessiblePractices, search]);

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} onPress={onClose} />
      <View
        style={{
          backgroundColor: c.surface,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          maxHeight: '78%',
          paddingBottom: Math.max(insets.bottom, 16),
        }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            paddingVertical: 16,
            borderBottomWidth: 1,
            borderBottomColor: c.border,
          }}>
          <Pressable onPress={onClose} style={{ position: 'absolute', left: 16, padding: 4 }}>
            <X size={22} color={c.textSecondary} />
          </Pressable>
          <Text style={{ fontSize: 17, fontWeight: '700', color: c.text }}>Select Location</Text>
        </View>

        <View style={{ padding: 16, gap: 12 }}>
          <SearchBar
            value={search}
            onChangeText={setSearch}
            placeholder="Search for a sub-account"
          />
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <Text style={{ fontSize: 12, fontWeight: '600', color: c.sectionLabel, marginBottom: 8, letterSpacing: 0.5 }}>
            ALL LOCATIONS
          </Text>
          {filtered.map((p) => {
            const active = p.id === practiceId;
            return (
              <Pressable
                key={p.id}
                onPress={() => {
                  viewPractice(p.id);
                  setSearch('');
                  onClose();
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingVertical: 14,
                  borderBottomWidth: 1,
                  borderBottomColor: c.border,
                }}>
                <UserAvatar name={p.name} size={44} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ fontSize: 16, fontWeight: '600', color: c.text, flex: 1 }} numberOfLines={1}>
                      {p.name}
                    </Text>
                    {active ? (
                      <View
                        style={{
                          backgroundColor: c.accentPill,
                          paddingHorizontal: 8,
                          paddingVertical: 3,
                          borderRadius: 6,
                        }}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: c.accent }}>Current</Text>
                      </View>
                    ) : null}
                  </View>
                  {cityState(p) ? (
                    <Text style={{ fontSize: 13, color: c.textSecondary, marginTop: 3 }} numberOfLines={2}>
                      {cityState(p)}
                    </Text>
                  ) : null}
                </View>
                <Pin size={18} color={c.textMuted} />
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}
