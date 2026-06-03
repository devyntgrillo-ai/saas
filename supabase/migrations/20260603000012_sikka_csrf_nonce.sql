-- ============================================================================
-- Sikka OAuth CSRF nonce: add a random nonce column for the OAuth state param
-- (audit finding 6). Generated per-initiation, verified on callback.
-- ============================================================================
alter table public.practices
  add column if not exists sikka_oauth_nonce text;
