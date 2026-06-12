import { Pressable, Text, type PressableProps, type ViewStyle } from 'react-native';
import { useAppColors } from '@/lib/color-scheme-context';

type Variant = 'primary' | 'outline' | 'ghost' | 'danger' | 'record';
type Size = 'sm' | 'default' | 'lg';

interface AppButtonProps extends PressableProps {
  variant?: Variant;
  size?: Size;
  label: string;
}

const sizeStyles: Record<Size, { height: number; px: number; fontSize: number }> = {
  sm: { height: 36, px: 14, fontSize: 14 },
  default: { height: 44, px: 18, fontSize: 15 },
  lg: { height: 52, px: 22, fontSize: 16 },
};

export function AppButton({
  variant = 'primary',
  size = 'default',
  label,
  style,
  disabled,
  ...props
}: AppButtonProps) {
  const c = useAppColors();
  const sz = sizeStyles[size];

  const variantStyle = (pressed: boolean): ViewStyle => {
    switch (variant) {
      case 'primary':
        return {
          backgroundColor: disabled ? c.textMuted : pressed ? c.accentHover : c.accent,
          borderWidth: 0,
        };
      case 'record':
        return {
          backgroundColor: disabled ? c.textMuted : pressed ? '#DC2626' : c.record,
          borderWidth: 0,
        };
      case 'outline':
        return {
          backgroundColor: pressed ? c.accentSubtle : 'transparent',
          borderColor: c.borderStrong,
          borderWidth: 1,
        };
      case 'ghost':
        return { backgroundColor: pressed ? c.surfaceHi : 'transparent', borderWidth: 0 };
      case 'danger':
        return {
          backgroundColor: pressed ? c.danger : 'transparent',
          borderColor: c.danger,
          borderWidth: 1,
        };
    }
  };

  const textColor = (): string => {
    switch (variant) {
      case 'primary':
      case 'record':
        return '#FFFFFF';
      case 'outline':
      case 'ghost':
        return c.text;
      case 'danger':
        return c.danger;
    }
  };

  return (
    <Pressable
      disabled={disabled}
      style={({ pressed }) => [
        {
          height: sz.height,
          paddingHorizontal: sz.px,
          borderRadius: 10,
          alignItems: 'center',
          justifyContent: 'center',
        },
        variantStyle(pressed),
        style as ViewStyle,
      ]}
      {...props}>
      <Text style={{ fontSize: sz.fontSize, fontWeight: '600', color: textColor() }}>{label}</Text>
    </Pressable>
  );
}
