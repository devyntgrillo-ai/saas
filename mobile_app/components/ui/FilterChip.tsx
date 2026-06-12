import { Pressable, Text } from 'react-native';
import { useAppColors } from '@/lib/color-scheme-context';

export function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
}) {
  const c = useAppColors();
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 20,
        backgroundColor: active ? c.chipActiveBg : c.chipBg,
        borderWidth: 1,
        borderColor: active ? c.accent : c.border,
      }}>
      <Text
        style={{
          fontSize: 13,
          fontWeight: active ? '600' : '500',
          color: active ? c.chipActiveText : c.textSecondary,
        }}>
        {label}
      </Text>
    </Pressable>
  );
}
