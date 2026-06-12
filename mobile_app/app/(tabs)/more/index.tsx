import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  BookOpen,
  ChevronRight,
  GitBranch,
  MessageCircle,
  Settings,
} from 'lucide-react-native';
import { useAuth } from '@/lib/auth-context';
import { useAppColors } from '@/lib/color-scheme-context';
import { AppHeader } from '@/components/app-header';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { UserAvatar } from '@/components/ui/UserAvatar';

function MenuRow({
  icon: Icon,
  label,
  subtitle,
  onPress,
}: {
  icon: typeof Settings;
  label: string;
  subtitle?: string;
  onPress: () => void;
}) {
  const c = useAppColors();
  return (
    <Pressable onPress={onPress}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingVertical: 14,
          paddingHorizontal: 14,
          backgroundColor: c.cardTint,
          borderRadius: 12,
          marginBottom: 8,
        }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            backgroundColor: c.iconBox,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: c.border,
          }}>
          <Icon size={18} color={c.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: c.text }}>{label}</Text>
          {subtitle ? (
            <Text style={{ fontSize: 13, color: c.textSecondary, marginTop: 2 }}>{subtitle}</Text>
          ) : null}
        </View>
        <ChevronRight size={18} color={c.textMuted} />
      </View>
    </Pressable>
  );
}

export default function MoreIndexScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const c = useAppColors();

  return (
    <View style={{ flex: 1, backgroundColor: c.pageBg }}>
      <AppHeader title="More" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <SectionHeader>Account</SectionHeader>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            backgroundColor: c.cardTint,
            borderRadius: 14,
            padding: 14,
            marginBottom: 16,
          }}>
          <UserAvatar name={profile?.display_name || profile?.full_name || 'User'} size={48} />
          <View>
            <Text style={{ fontSize: 17, fontWeight: '700', color: c.text }}>
              {profile?.display_name || profile?.full_name || 'User'}
            </Text>
            <Text style={{ fontSize: 13, color: c.textSecondary, marginTop: 2 }}>Practice mobile app</Text>
          </View>
        </View>

        <SectionHeader>Learning</SectionHeader>
        <MenuRow
          icon={BookOpen}
          label="Training"
          subtitle="Video modules and progress"
          onPress={() => router.push('/more/training')}
        />
        <MenuRow
          icon={MessageCircle}
          label="Coaching"
          subtitle="Chat with your CaseLift coach"
          onPress={() => router.push('/more/coaching')}
        />

        <SectionHeader>Practice</SectionHeader>
        <MenuRow
          icon={GitBranch}
          label="Sequences"
          subtitle="Desktop only"
          onPress={() => router.push('/more/sequences')}
        />
        <MenuRow icon={Settings} label="Settings" onPress={() => router.push('/more/settings')} />
      </ScrollView>
    </View>
  );
}
