import { View, type ViewProps } from 'react-native';
import { useAppColors } from '@/lib/color-scheme-context';

type Variant = 'default' | 'tinted' | 'flat';

export function AppCard({
  style,
  children,
  variant = 'default',
  ...props
}: ViewProps & { variant?: Variant }) {
  const c = useAppColors();
  const bg = variant === 'tinted' ? c.cardTint : variant === 'flat' ? c.pageBg : c.surface;

  return (
    <View
      style={[
        {
          backgroundColor: bg,
          borderRadius: 14,
          borderWidth: variant === 'flat' ? 0 : 1,
          borderColor: c.border,
          padding: 16,
          shadowColor: c.shadow,
          shadowOpacity: variant === 'default' ? 1 : 0,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 2 },
          elevation: variant === 'default' ? 1 : 0,
        },
        style,
      ]}
      {...props}>
      {children}
    </View>
  );
}
