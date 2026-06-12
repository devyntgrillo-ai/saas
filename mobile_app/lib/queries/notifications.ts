import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { supabase } from '@/lib/supabase';

// Per-user notification settings live in public.user_notification_settings — the
// SAME row the web app reads/writes, so edits here sync to the desktop app.

export type ChannelPrefs = { email?: boolean; sms?: boolean; push?: boolean };
export type NotificationPrefs = Record<string, ChannelPrefs>;

export type NotificationSettings = {
  user_id: string;
  practice_id: string | null;
  notification_prefs: NotificationPrefs | null;
  notify_email_address: string | null;
  notify_sms_number: string | null;
  notify_push: boolean;
  recording_reminders_enabled: boolean;
  recording_reminder_minutes: number;
  recording_reminder_channel: string;
  weekly_digest_enabled: boolean;
  weekly_digest_day: string;
  weekly_digest_time: string;
};

// Show notifications while the app is foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export function useMyNotificationSettings(userId?: string | null) {
  return useQuery({
    queryKey: ['myNotificationSettings', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_notification_settings')
        .select('*')
        .eq('user_id', userId!)
        .maybeSingle();
      if (error) throw error;
      return (data as NotificationSettings | null) ?? null;
    },
  });
}

export function useUpdateMyNotificationSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      userId,
      practiceId,
      patch,
    }: {
      userId: string;
      practiceId?: string | null;
      patch: Record<string, unknown>;
    }) => {
      const { error } = await supabase.from('user_notification_settings').upsert(
        { user_id: userId, practice_id: practiceId ?? null, ...patch, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );
      if (error) throw error;
      return { userId };
    },
    onSuccess: ({ userId }) => {
      void qc.invalidateQueries({ queryKey: ['myNotificationSettings', userId] });
    },
  });
}

type RegisterResult = { ok: boolean; reason?: string; token?: string };

/**
 * Request notification permission, fetch the Expo push token, and upsert it into
 * public.user_devices. No-ops gracefully off-device (simulator) or before an EAS
 * projectId / APNs key is configured — see DEV_BUILD_MAC.md for the EAS steps.
 */
export async function registerForPushNotifications(
  userId: string,
  practiceId?: string | null,
): Promise<RegisterResult> {
  try {
    if (!Device.isDevice) return { ok: false, reason: 'not_a_device' };

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') return { ok: false, reason: 'permission_denied' };

    const projectId =
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
      (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
    if (!projectId) return { ok: false, reason: 'no_eas_project_id' };

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    const { error } = await supabase.from('user_devices').upsert(
      {
        user_id: userId,
        practice_id: practiceId ?? null,
        expo_push_token: token,
        platform: Platform.OS,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'expo_push_token' },
    );
    if (error) throw error;
    return { ok: true, token };
  } catch (e) {
    return { ok: false, reason: String((e as Error)?.message ?? e) };
  }
}
