-- ============================================================================
-- Helcim billing columns on practices (Chargebee → Helcim migration).
--
-- Written by the helcim-checkout `record_payment` action AFTER it verifies an
-- APPROVED charge with Helcim. None of these hold card data — `helcim_card_token`
-- is a Helcim vault token and `card_last4` is already masked by Helcim.js.
--
-- Idempotent: safe to re-run.
-- ============================================================================
alter table public.practices add column if not exists helcim_card_token       text;
alter table public.practices add column if not exists helcim_customer_code     text;
alter table public.practices add column if not exists helcim_transaction_id    text;  -- reconcilable Payment-API id (for refunds/reversals)
alter table public.practices add column if not exists helcim_subscription_id   text;
alter table public.practices add column if not exists helcim_invoice_number    text;
alter table public.practices add column if not exists card_last4               text;
alter table public.practices add column if not exists card_type                text;
alter table public.practices add column if not exists billing_status           text;
alter table public.practices add column if not exists next_billing_date        timestamptz;
