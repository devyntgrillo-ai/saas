import { ScrollView, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { Info, KeyRound } from 'lucide-react-native';
import { useAppColors } from '@/lib/color-scheme-context';
import { useAuth } from '@/lib/auth-context';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { SettingsRow } from '@/components/ui/SettingsRow';
import { ThemeSegmentedControl } from '@/components/ui/ThemeSegmentedControl';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { AppButton } from '@/components/ui/AppButton';

export default function SettingsScreen() {
  const c = useAppColors();
  const { profile, user, practice, signOut } = useAuth();
  const version = Constants.expoConfig?.version || '1.0.0';

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.pageBg }}
      contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 40 }}>
      <SectionHeader>General</SectionHeader>
      <View style={{ backgroundColor: c.cardTint, borderRadius: 14, padding: 14, gap: 12, marginBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <UserAvatar name={profile?.display_name || profile?.full_name || user?.email || '?'} size={48} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: c.text }}>
              {profile?.display_name || profile?.full_name || 'User'}
            </Text>
            <Text style={{ fontSize: 14, color: c.textSecondary, marginTop: 2 }}>{user?.email}</Text>
            {practice?.name ? (
              <Text style={{ fontSize: 13, color: c.textMuted, marginTop: 2 }}>{practice.name}</Text>
            ) : null}
          </View>
        </View>
      </View>
      <SettingsRow icon={KeyRound} label="Change Password" onPress={() => {}} />

      <SectionHeader>Appearance</SectionHeader>
      <View style={{ marginBottom: 8 }}>
        <ThemeSegmentedControl />
      </View>

      <SectionHeader>Support</SectionHeader>
      <SettingsRow icon={Info} label="App Version" trailing={`v${version}`} showChevron={false} />

      <Text style={{ fontSize: 13, color: c.textMuted, lineHeight: 20, marginTop: 12, paddingHorizontal: 4 }}>
        Team management, billing, integrations, and messaging setup are available on the CaseLift desktop app.
      </Text>

      <View style={{ marginTop: 16 }}>
        <AppButton label="Sign Out" variant="outline" onPress={() => void signOut()} />
      </View>
    </ScrollView>
  );
}
