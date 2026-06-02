-- ============================================================================
-- Billing columns on practices (Lemon Squeezy). Idempotent.
-- Run in the Supabase SQL editor (project eymgqjeudrmeofytnwgs).
-- ============================================================================
alter table public.practices add column if not exists subscription_status text default 'trial';
alter table public.practices add column if not exists ls_subscription_id   text;
alter table public.practices add column if not exists ls_customer_id       text;
alter table public.practices add column if not exists ls_variant_id        text;
alter table public.practices add column if not exists trial_ends_at        timestamptz;
alter table public.practices add column if not exists current_period_end   timestamptz;
-- next_billing_date is already written by ls-webhook; keep it for back-compat.
alter table public.practices add column if not exists next_billing_date    date;

create index if not exists idx_practices_ls_subscription on public.practices(ls_subscription_id);
create index if not exists idx_practices_ls_customer     on public.practices(ls_customer_id);
