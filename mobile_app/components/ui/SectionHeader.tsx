import { Text } from 'react-native';
import { useAppColors } from '@/lib/color-scheme-context';

export function SectionHeader({ children }: { children: string }) {
  const c = useAppColors();
  return (
    <Text
      style={{
        fontSize: 12,
        fontWeight: '600',
        letterSpacing: 0.8,
        textTransform: 'uppercase',
        color: c.sectionLabel,
        marginBottom: 8,
        marginTop: 4,
        paddingHorizontal: 4,
      }}>
      {children}
    </Text>
  );
}
