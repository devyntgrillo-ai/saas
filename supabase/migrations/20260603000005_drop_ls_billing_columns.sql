-- ============================================================================
-- Drop Lemon Squeezy billing columns. Idempotent.
-- These were added by the reverted 20260603000001 migration. Lifecycle
-- columns and Chargebee columns are untouched.
-- ============================================================================

drop index if exists idx_practices_ls_customer;
drop index if exists idx_practices_ls_subscription;

alter table public.practices drop column if exists ls_customer_id;
alter table public.practices drop column if exists ls_subscription_id;
alter table public.practices drop column if exists ls_order_id;
alter table public.practices drop column if exists ls_product_id;
alter table public.practices drop column if exists ls_variant_id;
