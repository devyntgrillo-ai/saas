-- ============================================================================
-- Swap Lemon Squeezy billing columns for Chargebee on practices. Idempotent.
-- Run in the Supabase SQL editor (project eymgqjeudrmeofytnwgs).
--
-- Lifecycle columns (subscription_status, trial_ends_at, current_period_end,
-- next_billing_date) are unchanged - only the provider id columns are swapped.
-- ============================================================================

-- Add Chargebee id columns.
alter table public.practices add column if not exists chargebee_customer_id     text;
alter table public.practices add column if not exists chargebee_subscription_id text;

create index if not exists idx_practices_chargebee_customer     on public.practices(chargebee_customer_id);
create index if not exists idx_practices_chargebee_subscription on public.practices(chargebee_subscription_id);

-- Drop the Lemon Squeezy id columns and their indexes.
drop index if exists public.idx_practices_ls_subscription;
drop index if exists public.idx_practices_ls_customer;

alter table public.practices drop column if exists ls_subscription_id;
alter table public.practices drop column if exists ls_customer_id;
alter table public.practices drop column if exists ls_variant_id;
