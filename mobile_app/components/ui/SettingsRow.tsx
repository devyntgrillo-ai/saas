import { Pressable, Text, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { ChevronRight } from 'lucide-react-native';
import { useAppColors } from '@/lib/color-scheme-context';

export function SettingsRow({
  icon: Icon,
  label,
  trailing,
  onPress,
  showChevron = true,
  children,
}: {
  icon?: LucideIcon;
  label: string;
  trailing?: string;
  onPress?: () => void;
  showChevron?: boolean;
  children?: React.ReactNode;
}) {
  const c = useAppColors();
  const content = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 14,
        gap: 12,
        backgroundColor: c.cardTint,
        borderRadius: 12,
      }}>
      {Icon ? (
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            backgroundColor: c.iconBox,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: c.border,
          }}>
          <Icon size={18} color={c.accent} strokeWidth={2} />
        </View>
      ) : null}
      <Text style={{ flex: 1, fontSize: 16, fontWeight: '500', color: c.text }}>{label}</Text>
      {children}
      {trailing ? <Text style={{ fontSize: 14, color: c.textMuted }}>{trailing}</Text> : null}
      {showChevron && onPress ? <ChevronRight size={18} color={c.textMuted} /> : null}
    </View>
  );

  if (onPress) return <Pressable onPress={onPress}>{content}</Pressable>;
  return content;
}
