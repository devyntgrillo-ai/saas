import { Stack } from 'expo-router';
import { useAppColors } from '@/lib/color-scheme-context';

export default function TrainingLayout() {
  const c = useAppColors();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: c.surface },
        headerTintColor: c.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: c.pageBg },
      }}>
      <Stack.Screen name="index" options={{ title: 'Training' }} />
      <Stack.Screen name="[id]" options={{ title: 'Module' }} />
    </Stack>
  );
}
