-- ============================================================================
-- Ensure agency_accounts has the status / active columns the app relies on.
-- Idempotent.
--
-- The live agency_accounts table was created ad-hoc before the migration suite,
-- so the base `CREATE TABLE IF NOT EXISTS` never backfilled these columns. The
-- reseller SaaS suspension model (bill-resellers, /admin/resellers, the client
-- "service paused" banner) reads + writes status/active, so add them here.
-- ============================================================================

alter table public.agency_accounts add column if not exists status text    not null default 'active';
alter table public.agency_accounts add column if not exists active boolean not null default true;
