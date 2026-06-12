import { deviceGetItem, deviceSetItem } from '@/lib/device-storage';
import type { ThemePreference } from '@/constants/theme';

const KEY = 'caselift_theme_pref';

export async function getThemePreference(): Promise<ThemePreference> {
  const stored = await deviceGetItem(KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  return 'system';
}

export async function setThemePreference(pref: ThemePreference): Promise<void> {
  await deviceSetItem(KEY, pref);
}
