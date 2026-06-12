import { useEffect, useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { Video, ResizeMode, type AVPlaybackStatus } from 'expo-av';
import { useAuth } from '@/lib/auth-context';
import { useAppColors } from '@/lib/color-scheme-context';
import { useMarkTrainingComplete, useTrainingCatalog } from '@/lib/queries/training';
import { AppButton } from '@/components/ui/AppButton';
import { AppCard } from '@/components/ui/AppCard';

export default function TrainingPlayerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useAppColors();
  const { user } = useAuth();
  const videoRef = useRef<Video>(null);
  const [completed, setCompleted] = useState(false);

  const { data: catalog, isLoading } = useTrainingCatalog(user?.id);
  const markComplete = useMarkTrainingComplete();

  const module = catalog?.modules.find((m) => m.id === id);
  const alreadyDone = Boolean(id && catalog?.progress[id]?.completed_at);

  useEffect(() => {
    if (alreadyDone) setCompleted(true);
  }, [alreadyDone]);

  function onPlaybackStatus(status: AVPlaybackStatus) {
    if (!status.isLoaded || !user?.id || !id || completed || alreadyDone) return;
    if (status.durationMillis && status.positionMillis / status.durationMillis > 0.9) {
      setCompleted(true);
      void markComplete.mutateAsync({ userId: user.id, moduleId: id });
    }
  }

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.pageBg }}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }

  if (!module) {
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: 'center', backgroundColor: c.pageBg }}>
        <Text style={{ color: c.textSecondary, textAlign: 'center' }}>Module not found.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.pageBg }} contentContainerStyle={{ padding: 16, gap: 12 }}>
      {module.video_url ? (
        <View style={{ borderRadius: 12, overflow: 'hidden', backgroundColor: '#000' }}>
          <Video
            ref={videoRef}
            source={{ uri: module.video_url }}
            useNativeControls
            resizeMode={ResizeMode.CONTAIN}
            style={{ width: '100%', height: 220 }}
            onPlaybackStatusUpdate={onPlaybackStatus}
          />
        </View>
      ) : (
        <AppCard>
          <Text style={{ color: c.textSecondary }}>No video URL for this module.</Text>
        </AppCard>
      )}

      <AppCard>
        <Text style={{ fontSize: 20, fontWeight: '700', color: c.text }}>{module.title}</Text>
        {module.description ? (
          <Text style={{ fontSize: 15, color: c.textSecondary, marginTop: 8, lineHeight: 22 }}>
            {module.description}
          </Text>
        ) : null}
      </AppCard>

      {completed || alreadyDone ? (
        <AppCard style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', borderColor: c.success }}>
          <Text style={{ color: c.success, fontWeight: '600' }}>Module completed</Text>
        </AppCard>
      ) : user?.id ? (
        <AppButton
          label={markComplete.isPending ? 'Saving…' : 'Mark as complete'}
          variant="outline"
          disabled={markComplete.isPending}
          onPress={() => void markComplete.mutateAsync({ userId: user.id, moduleId: module.id })}
        />
      ) : null}
    </ScrollView>
  );
}
