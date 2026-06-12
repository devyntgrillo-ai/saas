import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Bell, ChevronDown, Settings } from 'lucide-react-native';
import { useAppColors } from '@/lib/color-scheme-context';
import { useAuth } from '@/lib/auth-context';
import { PracticeSwitcher } from '@/components/practice-switcher';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { useState } from 'react';

function cityState(practice: { city?: string | null; state?: string | null }) {
  return [practice.city, practice.state].filter(Boolean).join(', ');
}

export function AppHeader({ title, showActions = true }: { title?: string; showActions?: boolean }) {
  const c = useAppColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { practice, profile, isMultiPractice, accessiblePractices } = useAuth();
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const canSwitch = isMultiPractice || accessiblePractices.length > 1;
  const displayName = practice?.name || 'CaseLift';
  const subtitle = practice ? cityState(practice) : undefined;

  return (
    <>
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingBottom: 12,
          paddingHorizontal: 16,
          backgroundColor: c.pageBg,
          borderBottomWidth: 1,
          borderBottomColor: c.border,
        }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <UserAvatar name={displayName} size={40} />

          <Pressable
            style={{ flex: 1 }}
            onPress={() => canSwitch && setSwitcherOpen(true)}
            disabled={!canSwitch}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: c.text, flexShrink: 1 }} numberOfLines={1}>
                {title || displayName}
              </Text>
              {canSwitch ? <ChevronDown size={16} color={c.textSecondary} /> : null}
            </View>
            {subtitle && !title ? (
              <Text style={{ fontSize: 12, color: c.textSecondary, marginTop: 2 }} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
            {profile?.display_name || profile?.full_name ? (
              <Text style={{ fontSize: 11, color: c.textMuted, marginTop: 1 }} numberOfLines={1}>
                {profile.display_name || profile.full_name}
              </Text>
            ) : null}
          </Pressable>

          {showActions ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Pressable
                onPress={() => router.push('/more/settings')}
                style={{ padding: 8 }}
                hitSlop={8}>
                <Settings size={22} color={c.textSecondary} />
              </Pressable>
              <Pressable style={{ padding: 8 }} hitSlop={8}>
                <Bell size={22} color={c.textSecondary} />
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>
      <PracticeSwitcher open={switcherOpen} onClose={() => setSwitcherOpen(false)} />
    </>
  );
}
