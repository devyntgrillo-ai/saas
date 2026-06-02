-- Idempotent cron schedules for sequence sender + activation (hosted Supabase).
-- Requires pg_cron + pg_net and database settings app.supabase_url / app.service_role_key
-- (set via supabase/apply_cron.sql or Dashboard). Safe to re-run.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

do $$ begin perform cron.unschedule('process-sequences'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('send-due-messages'); exception when others then null; end $$;

select cron.schedule(
  'process-sequences',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := current_setting('app.supabase_url', true) || '/functions/v1/process-sequences',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
    ),
    body    := jsonb_build_object('tick', true)
  );
  $$
);

select cron.schedule(
  'send-due-messages',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := current_setting('app.supabase_url', true) || '/functions/v1/send-due-messages',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
    ),
    body    := jsonb_build_object('tick', true)
  );
  $$
);
