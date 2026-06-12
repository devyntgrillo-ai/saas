import { Redirect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppButton } from '@/components/ui/AppButton';
import { AppCard } from '@/components/ui/AppCard';
import { AppInput } from '@/components/ui/AppInput';
import { useAuth } from '@/lib/auth-context';
import { useAppColors } from '@/lib/color-scheme-context';
import {
  clearRememberedLogin,
  getRememberedLogin,
  type RememberedLogin,
} from '@/lib/remembered-login';

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const c = useAppColors();
  const { isLoggedIn, isReady, signIn } = useAuth();
  const scrollRef = useRef<ScrollView>(null);

  const [remembered, setRemembered] = useState<RememberedLogin | null>(null);
  const [rememberedLoading, setRememberedLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  const welcomeBack = Boolean(remembered?.email);

  useEffect(() => {
    void getRememberedLogin().then((stored) => {
      if (stored) {
        setRemembered(stored);
        setEmail(stored.email);
      }
      setRememberedLoading(false);
    });
  }, []);

  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardVisible(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardVisible(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const useAnotherAccount = useCallback(async () => {
    await clearRememberedLogin();
    setRemembered(null);
    setEmail('');
    setPassword('');
    setFormError(null);
    setFieldErrors({});
  }, []);

  const validate = useCallback(() => {
    const e: Record<string, string> = {};
    if (!welcomeBack) {
      if (!email.trim()) e.email = 'Enter your email';
      else if (!emailRegex.test(email.trim())) e.email = 'Enter a valid email';
    }
    if (!password) e.password = 'Enter your password';
    return e;
  }, [email, password, welcomeBack]);

  const handleLogin = useCallback(async () => {
    const loginEmail = (welcomeBack ? remembered?.email ?? '' : email).trim();
    const v = validate();
    setFieldErrors(v);
    setFormError(null);
    if (Object.keys(v).length > 0 || !loginEmail) return;

    setSubmitting(true);
    try {
      const { error } = await signIn(loginEmail, password);
      if (error) setFormError(error.message);
    } finally {
      setSubmitting(false);
    }
  }, [welcomeBack, remembered?.email, email, password, validate, signIn]);

  if (!isReady || rememberedLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.pageBg }}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }
  if (isLoggedIn) return <Redirect href="/(tabs)" />;

  const headline = welcomeBack
    ? remembered?.practiceName || remembered?.displayName || 'Welcome back'
    : 'CaseLift';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.pageBg }} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}>
        <ScrollView
          ref={scrollRef}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{
            flexGrow: 1,
            paddingHorizontal: 24,
            paddingTop: keyboardVisible ? 16 : welcomeBack ? 56 : 48,
            paddingBottom: keyboardVisible ? 32 : 48,
          }}>
          <View style={{ marginBottom: keyboardVisible ? 20 : 28 }}>
            <Image
              source={require('@/assets/images/icon.png')}
              style={{ width: 56, height: 56, borderRadius: 14, marginBottom: 20 }}
            />

            {welcomeBack ? (
              <>
                <Text style={{ fontSize: 32, fontWeight: '700', color: c.text, lineHeight: 38 }}>
                  {headline},
                </Text>
                <Text style={{ fontSize: 15, color: c.textSecondary, marginTop: 12, lineHeight: 22 }}>
                  Enter your password to access CaseLift.{' '}
                  <Text style={{ color: c.textMuted }}>{remembered?.email}</Text>
                </Text>
                <Pressable onPress={() => void useAnotherAccount()} style={{ marginTop: 10, alignSelf: 'flex-start' }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: c.accent }}>
                    Not you? Use another account
                  </Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={{ fontSize: 28, fontWeight: '700', color: c.text }}>CaseLift</Text>
                <Text style={{ fontSize: 15, color: c.textSecondary, marginTop: 6 }}>
                  Sign in to your practice
                </Text>
              </>
            )}
          </View>

          <AppCard variant="tinted" style={{ gap: 0 }}>
            {formError ? (
              <View
                style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.12)',
                  borderRadius: 10,
                  padding: 12,
                  marginBottom: 16,
                }}>
                <Text style={{ color: c.danger, fontSize: 14 }}>{formError}</Text>
              </View>
            ) : null}

            {!welcomeBack ? (
              <AppInput
                label="Email"
                value={email}
                onChangeText={(t) => {
                  setEmail(t);
                  if (fieldErrors.email) setFieldErrors((e) => ({ ...e, email: '' }));
                }}
                error={fieldErrors.email}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                textContentType="username"
                returnKeyType="next"
              />
            ) : null}

            <View style={{ marginTop: welcomeBack ? 0 : 16 }}>
              <AppInput
                label="Password"
                value={password}
                onChangeText={(t) => {
                  setPassword(t);
                  if (fieldErrors.password) setFieldErrors((e) => ({ ...e, password: '' }));
                }}
                error={fieldErrors.password}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoComplete="password"
                textContentType="password"
                autoFocus={welcomeBack}
                onSubmitEditing={() => void handleLogin()}
                returnKeyType="go"
              />
              <Pressable onPress={() => setShowPassword((p) => !p)} style={{ alignSelf: 'flex-end', marginTop: 4 }}>
                <Text style={{ fontSize: 13, color: c.textMuted }}>{showPassword ? 'Hide' : 'Show'}</Text>
              </Pressable>
            </View>

            <View style={{ marginTop: 24 }}>
              <AppButton
                label={submitting ? 'Signing in…' : 'Sign In'}
                onPress={() => void handleLogin()}
                disabled={submitting}
              />
            </View>
          </AppCard>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
