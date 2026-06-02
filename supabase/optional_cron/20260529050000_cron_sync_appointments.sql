-- ============================================================================
-- Scheduled PMS sync every 15 minutes via pg_cron + pg_net.
-- Run in the Supabase SQL editor. REQUIRES the pg_cron and pg_net extensions
-- (Dashboard → Database → Extensions) and the app settings below.
--
-- Set these once (replace with your values; service_role key is sensitive):
--   alter database postgres set app.supabase_url = 'https://eymgqjeudrmeofytnwgs.supabase.co';
--   alter database postgres set app.service_role_key = '<SERVICE_ROLE_KEY>';
--
-- Then schedule:
-- ============================================================================
select cron.schedule(
  'sync-pms-appointments',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/sync-appointments',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := jsonb_build_object('sync_all', true)
  );
  $$
);

-- To remove later: select cron.unschedule('sync-pms-appointments');
