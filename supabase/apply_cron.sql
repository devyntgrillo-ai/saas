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
-- │ 1. Find/replace EVERY <SERVICE_ROLE_KEY> below with your project's          │
-- │    service_role key (Dashboard → Project Settings → API → service_role).    │
-- │    This key is sensitive - do not commit the filled-in copy.                │
-- │ 2. Run the whole file. It is idempotent and safe to re-run.                 │
-- └────────────────────────────────────────────────────────────────────────────┘
--
-- NOTE: the URL + key are inlined directly into each job body. We do NOT use
-- `alter database postgres set app.*` / current_setting() here - on hosted
-- Supabase the SQL-editor role lacks ALTER DATABASE privilege and that errors
-- with "permission denied to set parameter".
-- ============================================================================

-- 1) Extensions (no-ops if already enabled; same as the Dashboard toggles).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2) Idempotent (re)schedule. Unschedule first, ignoring "job not found" so this
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
    url     := 'https://eymgqjeudrmeofytnwgs.supabase.co' || '/functions/v1/sync-appointments',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
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
    url     := 'https://eymgqjeudrmeofytnwgs.supabase.co' || '/functions/v1/process-sequences',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
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
    url     := 'https://eymgqjeudrmeofytnwgs.supabase.co' || '/functions/v1/send-due-messages',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
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
    url     := 'https://eymgqjeudrmeofytnwgs.supabase.co' || '/functions/v1/process-reactivation-drip',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
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
    url     := 'https://eymgqjeudrmeofytnwgs.supabase.co' || '/functions/v1/check-unrecorded-streak',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body    := jsonb_build_object('tick', true)
  );
  $$
);

-- Verify:
-- select jobname, schedule, active from cron.job order by jobname;
-- To remove a job:  select cron.unschedule('process-sequences');
