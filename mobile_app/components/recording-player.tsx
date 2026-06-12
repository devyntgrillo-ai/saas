import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  LayoutChangeEvent,
  Pressable,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { Audio, type AVPlaybackStatus } from 'expo-av';
import { Pause, Play } from 'lucide-react-native';
import { useAppColors } from '@/lib/color-scheme-context';
import { supabase } from '@/lib/supabase';
import { AppCard } from '@/components/ui/AppCard';

const SPEEDS = [1, 1.25, 1.5, 2] as const;

function fmtMs(ms: number) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function RecordingPlayerInner({
  consultId,
  hasAudio = true,
  processing = false,
}: {
  consultId: string;
  hasAudio?: boolean;
  processing?: boolean;
}) {
  const c = useAppColors();
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(hasAudio);
  const [error, setError] = useState('');
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [speed, setSpeed] = useState(1);
  const trackWidthRef = useRef(0);
  const loadedConsultRef = useRef<string | null>(null);

  const onPlaybackStatus = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    setPositionMs(status.positionMillis);
    if (status.durationMillis != null) setDurationMs(status.durationMillis);
    setPlaying(status.isPlaying);
    if (status.didJustFinish) {
      setPlaying(false);
      setPositionMs(status.durationMillis ?? 0);
    }
  }, []);

  useEffect(() => {
    if (loadedConsultRef.current !== consultId) {
      loadedConsultRef.current = null;
      setUrl(null);
      setSound(null);
      setPlaying(false);
      setPositionMs(0);
      setDurationMs(0);
    }
  }, [consultId]);

  useEffect(() => {
    if (!hasAudio) return;
    if (loadedConsultRef.current === consultId) return;
    let active = true;
    setLoading(true);
    setError('');
    void supabase.functions
      .invoke('get-recording-url', { body: { consult_id: consultId } })
      .then(async ({ data, error: err, response }) => {
        if (!active) return;
        if (err) {
          let msg = err.message || 'Recording unavailable.';
          if (response && typeof response.json === 'function') {
            try {
              const body = await response.json();
              if (body?.error) msg = body.error;
            } catch {
              /* ignore */
            }
          }
          setError(msg);
        } else if (data?.error || !data?.url) {
          setError(data?.error || 'Recording unavailable.');
        } else {
          loadedConsultRef.current = consultId;
          setUrl(data.url);
        }
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Recording unavailable.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [consultId, hasAudio]);

  useEffect(() => {
    if (!url) return;
    let active = true;
    let loaded: Audio.Sound | null = null;
    void Audio.Sound.createAsync({ uri: url }, { shouldPlay: false, shouldCorrectPitch: true })
      .then(({ sound: s }) => {
        if (!active) {
          void s.unloadAsync();
          return;
        }
        loaded = s;
        s.setOnPlaybackStatusUpdate(onPlaybackStatus);
        setSound(s);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Could not load recording.');
      });
    return () => {
      active = false;
      void loaded?.unloadAsync();
      setSound(null);
      setPlaying(false);
      setPositionMs(0);
      setDurationMs(0);
    };
  }, [url, onPlaybackStatus]);

  useEffect(() => {
    if (!sound) return;
    void sound.setRateAsync(speed, true);
  }, [sound, speed]);

  async function togglePlayback() {
    if (!sound) return;
    const status = await sound.getStatusAsync();
    if (!status.isLoaded) return;
    if (status.isPlaying) {
      await sound.pauseAsync();
    } else {
      if (status.didJustFinish || (status.durationMillis && status.positionMillis >= status.durationMillis - 100)) {
        await sound.setPositionAsync(0);
      }
      await sound.playAsync();
    }
  }

  function seekFromEvent(e: GestureResponderEvent) {
    if (!sound || !durationMs || !trackWidthRef.current) return;
    const x = e.nativeEvent.locationX;
    const ratio = Math.max(0, Math.min(1, x / trackWidthRef.current));
    void sound.setPositionAsync(ratio * durationMs);
  }

  function onTrackLayout(e: LayoutChangeEvent) {
    trackWidthRef.current = e.nativeEvent.layout.width;
  }

  const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;

  if (!hasAudio) {
    return (
      <AppCard>
        <Text style={{ color: c.textSecondary }}>
          {processing ? 'The recording is being processed…' : 'No recording on file for this consult.'}
        </Text>
      </AppCard>
    );
  }

  return (
    <AppCard>
      {loading ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <ActivityIndicator color={c.accent} />
          <Text style={{ color: c.textSecondary, fontSize: 14 }}>Loading recording…</Text>
        </View>
      ) : error ? (
        <Text style={{ color: c.danger, fontSize: 14 }}>{error}</Text>
      ) : (
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Pressable
              onPress={() => void togglePlayback()}
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                backgroundColor: c.accent,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              {playing ? (
                <Pause size={22} color="#FFFFFF" fill="#FFFFFF" />
              ) : (
                <Play size={22} color="#FFFFFF" fill="#FFFFFF" style={{ marginLeft: 2 }} />
              )}
            </Pressable>

            <View style={{ flex: 1, gap: 6 }}>
              <Pressable
                onPress={seekFromEvent}
                onLayout={onTrackLayout}
                style={{
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: c.border,
                  overflow: 'hidden',
                }}>
                <View
                  style={{
                    height: '100%',
                    width: `${progress * 100}%`,
                    backgroundColor: c.accent,
                    borderRadius: 3,
                  }}
                />
              </Pressable>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 11, color: c.textMuted, fontVariant: ['tabular-nums'] }}>
                  {fmtMs(positionMs)}
                </Text>
                <Text style={{ fontSize: 11, color: c.textMuted, fontVariant: ['tabular-nums'] }}>
                  {fmtMs(durationMs)}
                </Text>
              </View>
            </View>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text style={{ fontSize: 12, color: c.textMuted }}>Speed</Text>
            {SPEEDS.map((rate) => {
              const active = speed === rate;
              return (
                <Pressable
                  key={rate}
                  onPress={() => setSpeed(rate)}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: active ? c.accent : c.border,
                    backgroundColor: active ? c.accentPill : c.surfaceHi,
                  }}>
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: '600',
                      color: active ? c.accent : c.textSecondary,
                    }}>
                    {rate}×
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
    </AppCard>
  );
}

export const RecordingPlayer = memo(RecordingPlayerInner);
