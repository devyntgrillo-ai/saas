-- ============================================================================
-- apply_cron.sql - schedule the four background jobs that drive CaseLift:
--   • sync-pms-appointments       every 15 min → /functions/v1/sync-appointments
--   • process-sequences           every  5 min → /functions/v1/process-sequences
--   • send-due-messages           every  5 min → /functions/v1/send-due-messages
--   • process-reactivation-drip   every 15 min → /functions/v1/process-reactivation-drip
--
-- Run in the Supabase SQL editor (project eymgqjeudrmeofytnwgs) AFTER the edge
-- functions are deployed and after apply_all.sql.
--
-- ┌─ BEFORE YOU RUN ──────────────────────────────────────────────────────────┐
-- │ 1. Replace <SERVICE_ROLE_KEY> below with your project's service_role key.  │
-- │    (Dashboard → Project Settings → API → service_role secret.)             │
-- │    This key is sensitive - do not commit the filled-in copy.               │
-- │ 2. That's it. The rest is idempotent and safe to re-run.                   │
-- └────────────────────────────────────────────────────────────────────────────┘
-- ============================================================================

-- 1) Extensions (no-ops if already enabled; same as the Dashboard toggles).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2) Connection settings the cron bodies read via current_setting().
alter database postgres set app.supabase_url     = 'https://eymgqjeudrmeofytnwgs.supabase.co';
alter database postgres set app.service_role_key = '<SERVICE_ROLE_KEY>';
-- Make the new settings visible to this session immediately (so a Verify in the
-- same run doesn't read the old/empty value).
select set_config('app.supabase_url',     'https://eymgqjeudrmeofytnwgs.supabase.co', false);
select set_config('app.service_role_key', '<SERVICE_ROLE_KEY>', false);

-- 3) Idempotent (re)schedule. Unschedule first, ignoring "job not found" so this
--    file can be run repeatedly without duplicate-name errors.
do $$
begin
  perform cron.unschedule('sync-pms-appointments');
exception when others then null;
end $$;
do $$
begin
  perform cron.unschedule('process-sequences');
exception when others then null;
end $$;
do $$
begin
  perform cron.unschedule('send-due-messages');
exception when others then null;
end $$;
do $$
begin
  perform cron.unschedule('process-reactivation-drip');
exception when others then null;
end $$;
do $$
begin
  perform cron.unschedule('check-unrecorded-streak');
exception when others then null;
end $$;

-- PMS appointment sync - every 15 minutes.
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

-- Sequence activation engine - every 5 minutes.
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

-- Scheduled message sender - every 5 minutes.
select cron.schedule(
  'send-due-messages',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/send-due-messages',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := jsonb_build_object('tick', true)
  );
  $$
);

-- Reactivation drip sender - every 15 minutes (enforces its own send window + cap).
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

-- Consecutive-unrecorded adoption alert - once daily at 14:00 UTC (~9–10am ET).
select cron.schedule(
  'check-unrecorded-streak',
  '0 14 * * *',
  $$
  select net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/check-unrecorded-streak',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := jsonb_build_object('tick', true)
  );
  $$
);

-- Verify:
-- select jobname, schedule, active from cron.job order by jobname;
-- To remove a job:  select cron.unschedule('process-sequences');
