import { Pressable, Text, View } from 'react-native';
import { useAppTheme } from '@/lib/color-scheme-context';
import type { ThemePreference } from '@/constants/theme';

const OPTIONS: { id: ThemePreference; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'System' },
];

export function ThemeSegmentedControl() {
  const { themePreference, setThemePreference, colors: c } = useAppTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: c.cardTint,
        borderRadius: 10,
        padding: 4,
        gap: 4,
      }}>
      {OPTIONS.map((opt) => {
        const active = themePreference === opt.id;
        return (
          <Pressable
            key={opt.id}
            onPress={() => setThemePreference(opt.id)}
            style={{
              flex: 1,
              paddingVertical: 10,
              borderRadius: 8,
              backgroundColor: active ? c.surface : 'transparent',
              alignItems: 'center',
            }}>
            <Text
              style={{
                fontSize: 14,
                fontWeight: active ? '600' : '500',
                color: active ? c.accent : c.textSecondary,
              }}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
