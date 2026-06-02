-- Monthly cron schedule for the referral payout calculator (hosted Supabase).
-- Requires pg_cron + pg_net and database settings app.supabase_url /
-- app.service_role_key (see supabase/apply_cron.sql). Safe to re-run.
--
-- Runs at 06:00 UTC on the 1st of every month: snapshots active referrals into
-- the referral_payouts ledger as `pending` rows for the just-started month.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

do $$ begin perform cron.unschedule('calculate-referral-payouts'); exception when others then null; end $$;

select cron.schedule(
  'calculate-referral-payouts',
  '0 6 1 * *',
  $$
  select net.http_post(
    url     := current_setting('app.supabase_url', true) || '/functions/v1/calculate-referral-payouts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
    ),
    body    := jsonb_build_object('tick', true)
  );
  $$
);
