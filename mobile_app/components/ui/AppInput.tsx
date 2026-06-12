import { Text, TextInput, View, type TextInputProps } from 'react-native';
import { useAppColors } from '@/lib/color-scheme-context';

interface AppInputProps extends TextInputProps {
  label?: string;
  error?: string;
}

export function AppInput({ label, error, style, ...props }: AppInputProps) {
  const c = useAppColors();
  return (
    <View>
      {label ? (
        <Text style={{ fontSize: 13, fontWeight: '500', color: c.textSecondary, marginBottom: 6 }}>
          {label}
        </Text>
      ) : null}
      <TextInput
        placeholderTextColor={c.textMuted}
        style={[
          {
            height: 48,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: error ? c.danger : c.border,
            backgroundColor: c.surfaceHi,
            paddingHorizontal: 14,
            fontSize: 16,
            color: c.text,
          },
          style,
        ]}
        {...props}
      />
      {error ? (
        <Text style={{ fontSize: 12, color: c.danger, marginTop: 4 }}>{error}</Text>
      ) : null}
    </View>
  );
}
