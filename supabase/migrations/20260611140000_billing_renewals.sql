-- ============================================================================
-- Self-managed recurring billing support + daily renewal cron.
--
-- Context: monthly subscriptions are auto-billed by Helcim (recurring
-- subscription). This adds OUR-side renewal for practices Helcim is NOT billing
-- (annual customers — upgrade_annual cancels the monthly sub — and any active
-- practice whose subscription enrollment didn't take). The
-- process-billing-renewals edge function only charges practices where
-- helcim_subscription_id IS NULL, so Helcim-managed customers are never
-- double-charged.
--
-- Idempotent; safe to re-run. Run in the Supabase SQL editor (project
-- eymgqjeudrmeofytnwgs).
-- ============================================================================

-- Retry counter for the renewal job. The other billing columns already exist:
-- next_billing_date, helcim_card_token, billing_status, helcim_* — see
-- 20260610120000_helcim_billing_columns.sql.
alter table public.practices add column if not exists billing_retry_count integer not null default 0;
alter table public.practices alter column billing_status set default 'active';

-- Legacy Chargebee columns are DEPRECATED (billing moved to Helcim). Kept to
-- avoid data-migration risk; do not read or write them.
comment on column public.practices.chargebee_customer_id     is 'DEPRECATED: legacy Chargebee billing, migrated to Helcim. Do not use.';
comment on column public.practices.chargebee_subscription_id is 'DEPRECATED: legacy Chargebee billing, migrated to Helcim. Do not use.';

-- Daily renewal cron (hosted Supabase). Requires pg_cron + pg_net and the DB
-- settings app.supabase_url / app.service_role_key (see supabase/apply_cron.sql).
-- Runs at 08:00 UTC daily; the function is a no-op on days with nothing due.
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

do $$ begin perform cron.unschedule('billing-renewals'); exception when others then null; end $$;

select cron.schedule(
  'billing-renewals',
  '0 8 * * *',
  $$
  select net.http_post(
    url     := current_setting('app.supabase_url', true) || '/functions/v1/process-billing-renewals',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
    ),
    body    := jsonb_build_object('tick', true)
  );
  $$
);
