-- ============================================================================
-- Run the sequence activation engine every 5 minutes. Requires pg_cron + pg_net
-- and the app.supabase_url / app.service_role_key settings (see the
-- sync-appointments cron migration). Run in the Supabase SQL editor.
-- ============================================================================
select cron.schedule(
  'process-sequences',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/process-sequences',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := jsonb_build_object('tick', true)
  );
  $$
);
-- Remove later: select cron.unschedule('process-sequences');
