import { ScrollView, Text, View } from 'react-native';
import { Monitor } from 'lucide-react-native';
import { useAppColors } from '@/lib/color-scheme-context';
import { AppCard } from '@/components/ui/AppCard';

export default function SequencesScreen() {
  const c = useAppColors();

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      <AppCard style={{ alignItems: 'center', paddingVertical: 32 }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            backgroundColor: c.accentSubtle,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 16,
          }}>
          <Monitor size={28} color={c.accent} />
        </View>
        <Text style={{ fontSize: 17, fontWeight: '600', color: c.text, textAlign: 'center' }}>
          Open on desktop to view & edit
        </Text>
        <Text style={{ fontSize: 14, color: c.textSecondary, marginTop: 8, textAlign: 'center', lineHeight: 22 }}>
          Follow-up sequences — timing, pauses, and reactivation campaigns — are managed on the desktop app.
        </Text>
      </AppCard>
    </ScrollView>
  );
}
