import { createClient } from '@supabase/supabase-js';
import { deviceDeleteItem, deviceGetItem, deviceSetItem } from '@/lib/device-storage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

const AUTH_STORAGE_KEY = 'caselift-auth';

const ExpoSecureStoreAdapter = {
  getItem: (key: string) => deviceGetItem(key),
  setItem: (key: string, value: string) => deviceSetItem(key, value),
  removeItem: (key: string) => deviceDeleteItem(key),
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storage: ExpoSecureStoreAdapter,
    storageKey: AUTH_STORAGE_KEY,
  },
});

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
