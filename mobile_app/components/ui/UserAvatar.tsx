import { Text, View } from 'react-native';
import { useAppColors } from '@/lib/color-scheme-context';

export function initials(name: string) {
  return (name || '?')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function UserAvatar({
  name,
  size = 44,
  badge,
}: {
  name: string;
  size?: number;
  badge?: React.ReactNode;
}) {
  const c = useAppColors();
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: c.accentSubtle,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: c.border,
        }}>
        <Text style={{ fontSize: size * 0.34, fontWeight: '700', color: c.accent }}>
          {initials(name)}
        </Text>
      </View>
      {badge ? (
        <View style={{ position: 'absolute', right: -2, bottom: -2 }}>{badge}</View>
      ) : null}
    </View>
  );
}
