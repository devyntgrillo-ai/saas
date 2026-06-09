import { createClient } from '@supabase/supabase-js'
import { verifySupabaseRegion } from './regionCheck'

// SECURITY (HIPAA): this is the ONLY Supabase client the frontend uses, and it is
// initialized with the *anon* (publishable) key only. The service-role key must
// NEVER be imported into any frontend file — it bypasses RLS. It lives solely in
// edge-function secrets (SUPABASE_SERVICE_ROLE_KEY). Verified: no `service_role`
// reference exists anywhere under src/.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  // Surfaced in the console during local dev until .env is filled in.
  console.warn(
    '[CaseLift] Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.'
  )
}

// Confirm the project is pinned to a US region (HIPAA data-residency). Runs once
// at startup; logs in dev and warns loudly if the configured region is non-US.
verifySupabaseRegion(supabaseUrl)

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
    // Namespaced localStorage key for the persisted session. NOTE: changing this
    // from the SDK default (sb-<ref>-auth-token) invalidates any session stored
    // under the old key, so users are signed out once on the deploy that ships it.
    storageKey: 'caselift-auth',
  },
})

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)
