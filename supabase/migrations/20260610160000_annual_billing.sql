-- ============================================================================
-- Annual billing upgrade. A practice on monthly billing can pay 10× the monthly
-- rate once (2 months free) to be covered for 12 months. We track the interval
-- and the annual amount; next_billing_date moves out 12 months. Idempotent.
-- ============================================================================
alter table public.practices add column if not exists billing_interval text not null default 'monthly';
alter table public.practices add column if not exists annual_amount    numeric(10,2);
alter table public.practices add column if not exists annual_started_at timestamptz;
