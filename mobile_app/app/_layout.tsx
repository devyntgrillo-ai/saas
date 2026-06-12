import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';
import 'react-native-reanimated';
import '../global.css';

import { AuthProvider, useAuth } from '@/lib/auth-context';
import { ColorSchemeProvider, useAppTheme } from '@/lib/color-scheme-context';
import { ReactQueryProvider } from '@/lib/react-query-provider';
import { GateScreen } from '@/components/gate-screen';
import { isSupabaseConfigured } from '@/lib/supabase';
import { SafeAreaProvider } from 'react-native-safe-area-context';

void SplashScreen.preventAutoHideAsync();

function NavigationTheme({ children }: { children: ReactNode }) {
  const { colorScheme, colors } = useAppTheme();
  const base = colorScheme === 'dark' ? DarkTheme : DefaultTheme;
  const navTheme = useMemo(
    () => ({
      ...base,
      colors: {
        ...base.colors,
        primary: colors.accent,
        background: colors.pageBg,
        card: colors.surface,
        text: colors.text,
        border: colors.border,
        notification: colors.danger,
      },
    }),
    [base, colors],
  );
  return <ThemeProvider value={navTheme}>{children}</ThemeProvider>;
}

function AppShell() {
  const {
    isReady,
    isLoggedIn,
    isMobileSupported,
    isAgencyOnly,
    isAgencyUser,
    canBypassBaa,
    baaAccepted,
    onboardingCompleted,
    practiceContextPending,
    isSuspended,
  } = useAuth();
  const { colors, colorScheme } = useAppTheme();

  const onLayout = useCallback(async () => {
    if (isReady) await SplashScreen.hideAsync();
  }, [isReady]);

  useEffect(() => {
    if (isReady) void SplashScreen.hideAsync();
  }, [isReady]);

  if (!isSupabaseConfigured) {
    return (
      <GateScreen
        title="Configuration needed"
        message="Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in mobile_app/.env.local (copy from the main project)."
        showLogout={false}
      />
    );
  }

  if (!isReady) {
    return (
      <View
        onLayout={onLayout}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.pageBg }}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }} onLayout={onLayout}>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      <RootNavigator
        isLoggedIn={isLoggedIn}
        isMobileSupported={isMobileSupported}
        isAgencyOnly={isAgencyOnly}
        isAgencyUser={isAgencyUser}
        canBypassBaa={canBypassBaa}
        baaAccepted={baaAccepted}
        onboardingCompleted={onboardingCompleted}
        practiceContextPending={practiceContextPending}
        isSuspended={isSuspended}
        pageBg={colors.pageBg}
        accent={colors.accent}
      />
    </View>
  );
}

function RootNavigator({
  isLoggedIn,
  isMobileSupported,
  isAgencyOnly,
  isAgencyUser,
  canBypassBaa,
  baaAccepted,
  onboardingCompleted,
  practiceContextPending,
  isSuspended,
  pageBg,
  accent,
}: {
  isLoggedIn: boolean;
  isMobileSupported: boolean;
  isAgencyOnly: boolean;
  isAgencyUser: boolean;
  canBypassBaa: boolean;
  baaAccepted: boolean;
  onboardingCompleted: boolean;
  practiceContextPending: boolean;
  isSuspended: boolean;
  pageBg: string;
  accent: string;
}) {
  if (isLoggedIn && isMobileSupported && practiceContextPending) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: pageBg }}>
        <ActivityIndicator size="large" color={accent} />
      </View>
    );
  }
  if (isLoggedIn && isSuspended) {
    return (
      <GateScreen
        title="Account suspended"
        message="This practice account has been archived. Contact your administrator for help."
      />
    );
  }

  if (isLoggedIn && isAgencyOnly) {
    return (
      <GateScreen
        title="Desktop required"
        message="Reseller and admin accounts use the CaseLift web portal. Sign in on your computer to manage sub-accounts."
      />
    );
  }

  if (isLoggedIn && isMobileSupported && !canBypassBaa && !baaAccepted) {
    return (
      <GateScreen
        title="Agreement required"
        message="Your practice must accept the Business Associate Agreement before using CaseLift. Please complete this step on the desktop app."
      />
    );
  }

  if (isLoggedIn && isMobileSupported && !isAgencyUser && !onboardingCompleted) {
    return (
      <GateScreen
        title="Setup incomplete"
        message="Finish practice onboarding on the CaseLift desktop app, then return here to record consults and view your dashboard."
      />
    );
  }

  return (
    <NavigationTheme>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }}>
        <Stack.Protected guard={!isLoggedIn}>
          <Stack.Screen name="(guest)" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={isLoggedIn && isMobileSupported}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </NavigationTheme>
  );
}

export default function RootLayout() {
  return (
    <ReactQueryProvider>
      <ColorSchemeProvider>
        <SafeAreaProvider>
          <AuthProvider>
            <AppShell />
          </AuthProvider>
        </SafeAreaProvider>
      </ColorSchemeProvider>
    </ReactQueryProvider>
  );
}
