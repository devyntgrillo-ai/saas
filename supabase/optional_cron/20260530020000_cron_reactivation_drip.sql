-- ============================================================================
-- Run the reactivation drip every 15 minutes. The function itself enforces the
-- per-campaign send window (business hours) and daily cap, so a frequent tick is
-- fine. Requires pg_cron + pg_net and the app.supabase_url / app.service_role_key
-- settings (see the sync-appointments cron migration). Run in the SQL editor.
-- ============================================================================
select cron.schedule(
  'process-reactivation-drip',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/process-reactivation-drip',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := jsonb_build_object('tick', true)
  );
  $$
);
-- Remove later: select cron.unschedule('process-reactivation-drip');
