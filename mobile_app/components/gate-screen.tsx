import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppColors } from '@/lib/color-scheme-context';
import { AppButton } from '@/components/ui/AppButton';
import { useAuth } from '@/lib/auth-context';

export function GateScreen({
  title,
  message,
  showLogout = true,
}: {
  title: string;
  message: string;
  showLogout?: boolean;
}) {
  const c = useAppColors();
  const { signOut } = useAuth();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.pageBg }}>
      <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontSize: 24, fontWeight: '700', color: c.text, marginBottom: 12 }}>{title}</Text>
        <Text style={{ fontSize: 16, lineHeight: 24, color: c.textSecondary, marginBottom: 32 }}>{message}</Text>
        {showLogout ? <AppButton label="Sign Out" variant="outline" onPress={() => void signOut()} /> : null}
      </View>
    </SafeAreaView>
  );
}
