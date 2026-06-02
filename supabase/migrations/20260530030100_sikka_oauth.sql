-- ============================================================================
-- Sikka OAuth 2.0 per-practice tokens. Each practice completes the Sikka OAuth
-- flow (sikka-oauth-callback) and stores its own request_key + refresh_token +
-- expiry. sync-appointments refreshes the request_key before each call.
-- Idempotent. Run in the Supabase SQL editor (project eymgqjeudrmeofytnwgs).
-- ============================================================================
alter table public.practices add column if not exists sikka_request_key      text;
alter table public.practices add column if not exists sikka_refresh_token    text;
alter table public.practices add column if not exists sikka_token_expires_at timestamptz;

-- Note: sikka_practice_id (the Sikka office_id) and sikka_connected already
-- exist from migration 20260529040000_sikka_pms.sql.
