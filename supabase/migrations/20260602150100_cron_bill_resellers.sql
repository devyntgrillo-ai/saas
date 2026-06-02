-- Monthly cron schedule for reseller wholesale billing (hosted Supabase).
-- Requires pg_cron + pg_net and database settings app.supabase_url /
-- app.service_role_key (see supabase/apply_cron.sql). Safe to re-run.
--
-- Runs at 07:00 UTC on the 1st of every month: counts each reseller's active
-- subaccounts and invoices them via Chargebee at $297/subaccount (see the
-- bill-resellers edge function). Scheduled an hour after the referral payout
-- job so the two monthly cron tasks don't fire simultaneously.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

do $$ begin perform cron.unschedule('bill-resellers'); exception when others then null; end $$;

select cron.schedule(
  'bill-resellers',
  '0 7 1 * *',
  $$
  select net.http_post(
    url     := current_setting('app.supabase_url', true) || '/functions/v1/bill-resellers',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
    ),
    body    := jsonb_build_object('tick', true)
  );
  $$
);
