import { Stack } from 'expo-router';
import { useAppColors } from '@/lib/color-scheme-context';

export default function MoreLayout() {
  const c = useAppColors();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: c.surface },
        headerTintColor: c.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: c.pageBg },
      }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      <Stack.Screen name="training" options={{ headerShown: false }} />
      <Stack.Screen name="coaching" options={{ title: 'Coaching' }} />
      <Stack.Screen name="sequences" options={{ title: 'Sequences' }} />
    </Stack>
  );
}
