import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

import { resolveColors, type AppThemeColors, type ThemePreference } from '@/constants/theme';
import { getThemePreference, setThemePreference } from '@/lib/theme-preference';

type ColorSchemeContextValue = {
  colorScheme: 'light' | 'dark';
  themePreference: ThemePreference;
  setThemePreference: (pref: ThemePreference) => void;
  colors: AppThemeColors;
};

const ColorSchemeContext = createContext<ColorSchemeContextValue | null>(null);

export function ColorSchemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useRNColorScheme();
  const [themePreference, setPrefState] = useState<ThemePreference>('system');
  useEffect(() => {
    void getThemePreference().then(setPrefState);
  }, []);

  const colorScheme: 'light' | 'dark' =
    themePreference === 'system'
      ? systemScheme === 'dark'
        ? 'dark'
        : 'light'
      : themePreference;

  const colors = useMemo(() => resolveColors(colorScheme), [colorScheme]);

  const setThemePreferenceFn = useCallback((pref: ThemePreference) => {
    setPrefState(pref);
    void setThemePreference(pref);
  }, []);

  const value = useMemo(
    (): ColorSchemeContextValue => ({
      colorScheme,
      themePreference,
      setThemePreference: setThemePreferenceFn,
      colors,
    }),
    [colorScheme, themePreference, setThemePreferenceFn, colors],
  );

  return <ColorSchemeContext.Provider value={value}>{children}</ColorSchemeContext.Provider>;
}

export function useAppTheme(): ColorSchemeContextValue {
  const ctx = useContext(ColorSchemeContext);
  if (!ctx) throw new Error('useAppTheme must be used within ColorSchemeProvider');
  return ctx;
}

export function useAppColors(): AppThemeColors {
  return useAppTheme().colors;
}

/** @deprecated use useAppColors */
export function useKLColors(): AppThemeColors {
  return useAppColors();
}
