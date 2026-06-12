import { TextInput, View } from 'react-native';
import { Search } from 'lucide-react-native';
import { useAppColors } from '@/lib/color-scheme-context';

export function SearchBar({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
}) {
  const c = useAppColors();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: c.searchBg,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: c.border,
        paddingHorizontal: 14,
        height: 46,
        gap: 10,
      }}>
      <Search size={18} color={c.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.textMuted}
        style={{ flex: 1, fontSize: 16, color: c.text, paddingVertical: 0 }}
      />
    </View>
  );
}
