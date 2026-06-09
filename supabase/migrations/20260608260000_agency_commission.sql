-- Replace the reseller WHOLESALE model with a flat REFERRAL COMMISSION.
--
-- Old model: an agency set a client price, CaseLift billed the agency a wholesale
-- fee per active client, the agency kept the margin and collected from clients.
-- New model: every practice bills CaseLift $997/mo directly. An agency that
-- refers a practice earns a flat monthly commission per ACTIVE referred practice
-- (default $200). The agency→practice hierarchy IS the attribution.
--
-- commission_rate is the single source of truth read by both the admin payout
-- tally and the "new referral" notification email, so they can never drift.

alter table public.agency_accounts
  add column if not exists commission_rate numeric(10,2) not null default 200;

update public.agency_accounts set commission_rate = 200 where commission_rate is null;

alter table public.agency_accounts drop constraint if exists agency_commission_rate_nonneg;
alter table public.agency_accounts add constraint agency_commission_rate_nonneg
  check (commission_rate >= 0);

-- The old wholesale floor is meaningless now that agencies don't set price.
alter table public.agency_accounts drop constraint if exists reseller_client_price_min;

-- Stop the monthly wholesale reseller-billing cron (the bill-resellers function
-- is removed). Wrapped so it's a no-op if pg_cron/the job isn't present.
do $$
begin
  perform cron.unschedule('bill-resellers');
exception when others then
  null;
end $$;
