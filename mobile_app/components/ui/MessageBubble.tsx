import { memo } from 'react';
import { Text, View } from 'react-native';
import { useAppColors } from '@/lib/color-scheme-context';

export const MessageBubble = memo(function MessageBubble({
  body,
  outbound,
  meta,
  senderName,
}: {
  body: string;
  outbound: boolean;
  meta?: string;
  senderName?: string;
}) {
  const c = useAppColors();
  const bg = outbound ? c.messageOutBg : c.messageInBg;
  const fg = outbound ? c.messageOutText : c.messageInText;

  return (
    <View
      style={{
        alignSelf: outbound ? 'flex-end' : 'flex-start',
        maxWidth: '82%',
        backgroundColor: bg,
        borderRadius: 16,
        borderTopLeftRadius: outbound ? 16 : 4,
        borderTopRightRadius: outbound ? 4 : 16,
        paddingHorizontal: 14,
        paddingVertical: 10,
      }}>
      {meta || senderName ? (
        <Text style={{ fontSize: 11, color: c.textMuted, marginBottom: 4 }}>
          {[senderName, meta].filter(Boolean).join(' · ')}
        </Text>
      ) : null}
      <Text style={{ fontSize: 15, lineHeight: 21, color: fg }}>{body}</Text>
    </View>
  );
});
