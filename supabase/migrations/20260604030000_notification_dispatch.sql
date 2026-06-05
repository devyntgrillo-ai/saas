-- ============================================================================
-- Notification dispatch wiring.
--   1. practices.slack_webhook_url - per-practice Slack (dispatcher falls back to
--      the global SLACK_WEBHOOK_URL env when null).
--   2. Case-converted detector: when a consult flips to won, call notify-staff via
--      pg_net (event_name 'case_converted').
--   3. Daily 8am cron for notify-calls-due.
-- Requires pg_cron + pg_net and DB settings app.supabase_url / app.service_role_key
-- (same as the other cron jobs). Idempotent.
-- ============================================================================

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

-- 1) Per-practice Slack webhook.
alter table public.practices add column if not exists slack_webhook_url text;

-- 2) Case-converted -> notify-staff (fires once on the transition to won).
create or replace function public.notify_case_converted()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, net
as $$
declare became_won boolean;
begin
  became_won :=
       (NEW.status  = 'closed_won' and OLD.status  is distinct from 'closed_won')
    or (NEW.outcome = 'closed_won' and OLD.outcome is distinct from 'closed_won')
    or (NEW.outcome = 'accepted'   and OLD.outcome is distinct from 'accepted');
  if not became_won then return NEW; end if;

  perform net.http_post(
    url     := current_setting('app.supabase_url', true) || '/functions/v1/notify-staff',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
    ),
    body    := jsonb_build_object(
      'practice_id', NEW.practice_id,
      'event_name', 'case_converted',
      'payload', jsonb_build_object(
        'patient_name', coalesce(NEW.patient_name, 'A patient'),
        'case_value', NEW.case_value,
        'treatment_type', NEW.treatment_type,
        'consult_id', NEW.id
      )
    )
  );
  return NEW;
end $$;

drop trigger if exists trg_notify_case_converted on public.consults;
create trigger trg_notify_case_converted
  after update of status, outcome on public.consults
  for each row execute function public.notify_case_converted();

-- 3) Daily 8am cron for follow-up calls due today.
do $$ begin perform cron.unschedule('notify-calls-due'); exception when others then null; end $$;
select cron.schedule(
  'notify-calls-due',
  '0 8 * * *',
  $$
  select net.http_post(
    url     := current_setting('app.supabase_url', true) || '/functions/v1/notify-calls-due',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
    ),
    body    := jsonb_build_object('tick', true)
  );
  $$
);
