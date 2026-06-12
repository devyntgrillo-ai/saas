import { Text, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useAppColors } from '@/lib/color-scheme-context';
import { AppCard } from '@/components/ui/AppCard';

const ACCENT_MAP = {
  primary: { bg: 'rgba(14, 165, 233, 0.1)', fg: '#0EA5E9' },
  green: { bg: 'rgba(16, 185, 129, 0.1)', fg: '#10B981' },
  amber: { bg: 'rgba(245, 158, 11, 0.1)', fg: '#F59E0B' },
  violet: { bg: 'rgba(14, 165, 233, 0.1)', fg: '#0EA5E9' },
} as const;

export function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  accent = 'primary',
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  accent?: keyof typeof ACCENT_MAP;
}) {
  const c = useAppColors();
  const tone = ACCENT_MAP[accent];

  return (
    <AppCard style={{ flex: 1, minWidth: '46%' }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Text style={{ fontSize: 13, color: c.textSecondary, flex: 1 }}>{label}</Text>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            backgroundColor: tone.bg,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Icon size={18} color={tone.fg} />
        </View>
      </View>
      <Text style={{ fontSize: 28, fontWeight: '700', color: c.text, marginTop: 8 }}>{value}</Text>
      {sub ? (
        <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 4 }}>{sub}</Text>
      ) : null}
    </AppCard>
  );
}
