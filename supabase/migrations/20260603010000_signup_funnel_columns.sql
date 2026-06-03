-- ============================================================================
-- Signup funnel columns on practices. Idempotent / additive.
-- Run in the Supabase SQL editor (project eymgqjeudrmeofytnwgs).
--
-- Reconciled with the EXISTING practices table rather than the simplified spec:
--   - PMS system            → existing `pms_type` column (reused, not duplicated)
--   - subscription status   → existing `subscription_status` column (reused)
-- so only the two genuinely-new fields are added here.
-- ============================================================================
alter table public.practices add column if not exists heard_from  text;
alter table public.practices add column if not exists plan_amount integer default 997;

-- Backfill a sensible default for existing rows so admin MRR math is correct.
update public.practices set plan_amount = 997 where plan_amount is null;
