-- ============================================================================
-- 20260605120000 (history name: inbound_call_settings)
-- Recovered from supabase_migrations.schema_migrations. This migration was
-- applied directly to the database via the dashboard and was missing from the
-- repo, which blocked `supabase db push` for everyone. This file restores
-- repo/prod parity. Matched by version prefix, so it's a no-op against prod.
-- ============================================================================

-- Two-way calling: when a patient calls the practice Twilio number back, ring
-- the browser (Twilio Client) and/or forward to a staff mobile number.
alter table public.practices
  add column if not exists inbound_call_forward_phone text,
  add column if not exists inbound_call_ring_browser boolean not null default true;
