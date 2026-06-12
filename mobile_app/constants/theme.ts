import { Platform } from 'react-native';

export const Fonts = Platform.select({
  ios: { sans: 'System', mono: 'Menlo' },
  default: { sans: 'normal', mono: 'monospace' },
  web: { sans: 'Inter, system-ui, sans-serif', mono: 'Menlo, monospace' },
});

export type ThemePreference = 'light' | 'dark' | 'system';

export type AppThemeColors = {
  pageBg: string;
  surface: string;
  surfaceHi: string;
  cardTint: string;
  border: string;
  borderStrong: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  sectionLabel: string;
  accent: string;
  accentSubtle: string;
  accentHover: string;
  accentPill: string;
  record: string;
  success: string;
  warning: string;
  danger: string;
  tabActive: string;
  tabInactive: string;
  navPill: string;
  iconBox: string;
  searchBg: string;
  chipBg: string;
  chipActiveBg: string;
  chipActiveText: string;
  badge: string;
  messageInBg: string;
  messageInText: string;
  messageOutBg: string;
  messageOutText: string;
  statHeaderBg: string;
  shadow: string;
};

export const LightColors: AppThemeColors = {
  pageBg: '#F8F9FB',
  surface: '#FFFFFF',
  surfaceHi: '#F3F5F9',
  cardTint: '#EEF2F8',
  border: '#E5E7EB',
  borderStrong: '#D1D5DB',
  text: '#111827',
  textSecondary: '#6B7280',
  textMuted: '#9CA3AF',
  sectionLabel: '#9CA3AF',
  accent: '#0EA5E9',
  accentSubtle: 'rgba(14, 165, 233, 0.12)',
  accentHover: '#0284C7',
  accentPill: 'rgba(14, 165, 233, 0.14)',
  record: '#EF4444',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  tabActive: '#0EA5E9',
  tabInactive: '#9CA3AF',
  navPill: 'rgba(14, 165, 233, 0.14)',
  iconBox: '#FFFFFF',
  searchBg: '#FFFFFF',
  chipBg: '#F3F4F6',
  chipActiveBg: '#FFFFFF',
  chipActiveText: '#0EA5E9',
  badge: '#10B981',
  messageInBg: '#F0F2FF',
  messageInText: '#2D3B72',
  messageOutBg: '#ECFDF5',
  messageOutText: '#065F46',
  statHeaderBg: '#F3F4F6',
  shadow: 'rgba(15, 23, 42, 0.06)',
};

export const DarkColors: AppThemeColors = {
  pageBg: '#0F1117',
  surface: '#1A1D27',
  surfaceHi: '#222633',
  cardTint: '#252A38',
  border: 'rgba(255, 255, 255, 0.08)',
  borderStrong: 'rgba(255, 255, 255, 0.14)',
  text: '#F3F4F6',
  textSecondary: '#9CA3AF',
  textMuted: '#6B7280',
  sectionLabel: '#6B7280',
  accent: '#38BDF8',
  accentSubtle: 'rgba(56, 189, 248, 0.15)',
  accentHover: '#7DD3FC',
  accentPill: 'rgba(56, 189, 248, 0.18)',
  record: '#F87171',
  success: '#34D399',
  warning: '#FBBF24',
  danger: '#F87171',
  tabActive: '#38BDF8',
  tabInactive: '#6B7280',
  navPill: 'rgba(56, 189, 248, 0.18)',
  iconBox: '#2D3344',
  searchBg: '#222633',
  chipBg: '#252A38',
  chipActiveBg: '#2D3344',
  chipActiveText: '#38BDF8',
  badge: '#34D399',
  messageInBg: '#2A2A3C',
  messageInText: '#E8EAFF',
  messageOutBg: '#064E3B',
  messageOutText: '#D1FAE5',
  statHeaderBg: '#222633',
  shadow: 'rgba(0, 0, 0, 0.35)',
};

export function resolveColors(scheme: 'light' | 'dark'): AppThemeColors {
  return scheme === 'dark' ? DarkColors : LightColors;
}
