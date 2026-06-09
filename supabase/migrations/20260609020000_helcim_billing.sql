-- Helcim payment processing: per-practice customer + transaction references.
-- (Replacing Chargebee; old chargebee_* columns are left in place but unused.)
alter table public.practices add column if not exists helcim_customer_code  text;
alter table public.practices add column if not exists helcim_transaction_id text;
alter table public.practices add column if not exists helcim_invoice_number text;
