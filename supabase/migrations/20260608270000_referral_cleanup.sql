-- Tidy-up after the referral-model switch + the SQL-editor column applies.
-- Idempotent and safe.

-- The bill-resellers function was removed (no wholesale billing anymore). Stop
-- its monthly cron so it doesn't keep firing against a deleted function.
do $$ begin perform cron.unschedule('bill-resellers'); exception when others then null; end $$;

-- Guard rail the SQL-editor apply skipped: commission can't go negative.
alter table public.agency_accounts drop constraint if exists agency_commission_rate_nonneg;
alter table public.agency_accounts add constraint agency_commission_rate_nonneg check (commission_rate >= 0);
