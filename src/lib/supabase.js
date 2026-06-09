import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  // Surfaced in the console during local dev until .env is filled in.
  console.warn(
    '[CaseLift] Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    // JWTs expire after 1 hour (config.toml: jwt_expiry = 3600). autoRefreshToken
    // silently exchanges the refresh token for a fresh access token before expiry;
    // refresh-token rotation is handled server-side (config.toml:
    // enable_refresh_token_rotation = true), so each refresh issues a new token.
    autoRefreshToken: true,
    // Required so the password-recovery link (/reset-password) is detected and a
    // recovery session is established from the URL hash.
    detectSessionInUrl: true,
  },
})

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)
