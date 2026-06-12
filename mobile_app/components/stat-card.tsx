import { Text, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useAppColors } from '@/lib/color-scheme-context';

const ICON_TONES = {
  blue: { bg: 'rgba(14, 165, 233, 0.15)', fg: '#0EA5E9' },
  green: { bg: 'rgba(16, 185, 129, 0.15)', fg: '#10B981' },
  orange: { bg: 'rgba(245, 158, 11, 0.15)', fg: '#F59E0B' },
  violet: { bg: 'rgba(99, 102, 241, 0.15)', fg: '#6366F1' },
} as const;

export function StatCard({
  period,
  label,
  value,
  icon: Icon,
  tone = 'blue',
}: {
  period: string;
  label: string;
  value: string;
  icon: LucideIcon;
  tone?: keyof typeof ICON_TONES;
}) {
  const c = useAppColors();
  const colors = ICON_TONES[tone];

  return (
    <View
      style={{
        flex: 1,
        minWidth: '46%',
        backgroundColor: c.surface,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: c.border,
        overflow: 'hidden',
        shadowColor: c.shadow,
        shadowOpacity: 1,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
        elevation: 1,
      }}>
      <View
        style={{
          backgroundColor: c.statHeaderBg,
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderBottomWidth: 1,
          borderBottomColor: c.border,
        }}>
        <Text style={{ fontSize: 11, fontWeight: '500', color: c.textMuted }}>{period}</Text>
      </View>
      <View style={{ padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, color: c.textSecondary, marginBottom: 6 }}>{label}</Text>
          <Text style={{ fontSize: 26, fontWeight: '700', color: c.text }}>{value}</Text>
        </View>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: colors.bg,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Icon size={20} color={colors.fg} />
        </View>
      </View>
    </View>
  );
}
