-- ============================================================================
-- Add Lemon Squeezy billing columns back to practices. Idempotent.
-- Lifecycle columns (subscription_status, trial_ends_at, current_period_end,
-- next_billing_date, pause_ends_at, downsell_accepted_at) are unchanged.
-- Chargebee columns are kept for historical reference.
-- ============================================================================

alter table public.practices add column if not exists ls_customer_id     text;
alter table public.practices add column if not exists ls_subscription_id text;
alter table public.practices add column if not exists ls_order_id       text;
alter table public.practices add column if not exists ls_product_id     text;
alter table public.practices add column if not exists ls_variant_id     text;

create index if not exists idx_practices_ls_customer     on public.practices(ls_customer_id);
create index if not exists idx_practices_ls_subscription on public.practices(ls_subscription_id);
