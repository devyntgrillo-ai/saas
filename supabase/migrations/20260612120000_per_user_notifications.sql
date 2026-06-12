-- Per-user notification preferences + push device tokens.
--
-- Moves notification settings from account-level (practices.notification_prefs +
-- a single notify_email_address/notify_sms_number) to PER USER, and adds device
-- token storage for mobile push. Practice-level columns are kept as a legacy
-- fallback (not dropped) during the transition.
--
-- Per-user channels are email / sms / push. Slack stays CaseLift-internal/global
-- (server-side SLACK_WEBHOOK_URL), never per-user.

-- ---------------------------------------------------------------------------
-- 1. Per-user notification settings (1:1 with a user)
-- ---------------------------------------------------------------------------
create table if not exists public.user_notification_settings (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  practice_id uuid references public.practices(id) on delete set null,
  -- { event: { email: bool, sms: bool, push: bool } }
  notification_prefs jsonb,
  notify_email_address text,
  notify_sms_number    text,
  notify_push          boolean not null default true,
  recording_reminders_enabled boolean not null default false,
  recording_reminder_minutes  int     not null default 5,
  recording_reminder_channel  text    not null default 'push',
  weekly_digest_enabled boolean not null default true,
  weekly_digest_day     text    not null default 'monday',
  weekly_digest_time    text    not null default '9am',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_user_notif_settings_practice
  on public.user_notification_settings(practice_id);

alter table public.user_notification_settings enable row level security;

-- A user reads/writes only their own row; super-admin can read all (mirrors the
-- practices policies — see public.is_super_admin()).
drop policy if exists "uns_select_own" on public.user_notification_settings;
create policy "uns_select_own" on public.user_notification_settings
  for select to authenticated using (user_id = auth.uid() or public.is_super_admin());
drop policy if exists "uns_insert_own" on public.user_notification_settings;
create policy "uns_insert_own" on public.user_notification_settings
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "uns_update_own" on public.user_notification_settings;
create policy "uns_update_own" on public.user_notification_settings
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. Push device tokens (per user / per device)
-- ---------------------------------------------------------------------------
create table if not exists public.user_devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  practice_id  uuid references public.practices(id) on delete set null,
  expo_push_token text not null unique,
  platform     text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists idx_user_devices_user on public.user_devices(user_id);
create index if not exists idx_user_devices_practice on public.user_devices(practice_id);

alter table public.user_devices enable row level security;

drop policy if exists "user_devices_select_own" on public.user_devices;
create policy "user_devices_select_own" on public.user_devices
  for select to authenticated using (user_id = auth.uid() or public.is_super_admin());
drop policy if exists "user_devices_insert_own" on public.user_devices;
create policy "user_devices_insert_own" on public.user_devices
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "user_devices_update_own" on public.user_devices;
create policy "user_devices_update_own" on public.user_devices
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "user_devices_delete_own" on public.user_devices;
create policy "user_devices_delete_own" on public.user_devices
  for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. Behavior-preserving backfill
-- ---------------------------------------------------------------------------
-- Today exactly ONE contact per practice receives alerts. To avoid suddenly
-- emailing/texting every team member, we seed one settings row per user but only
-- the practice's PRIMARY recipient inherits email/sms = ON (from the practice's
-- saved prefs); everyone else gets email/sms = OFF. push defaults ON but only
-- fires once a device is registered.
--
-- Primary recipient per practice = the user whose email matches
-- notify_email_address (falling back to practice.email), else the owner, else
-- the earliest-created member.
with members as (
  select
    u.id           as user_id,
    u.email        as u_email,
    u.role         as u_role,
    u.created_at   as u_created,
    p.id           as practice_id,
    p.email        as p_email,
    p.notify_email_address as p_notify_email,
    p.notify_sms_number    as p_notify_sms,
    p.notification_prefs   as p_prefs
  from public.users u
  join public.practices p on p.id = u.practice_id
  where u.practice_id is not null
),
ranked as (
  select m.*,
    row_number() over (
      partition by m.practice_id
      order by
        (lower(coalesce(m.u_email,'')) = lower(coalesce(m.p_notify_email, m.p_email, ''))) desc,
        (m.u_role = 'owner') desc,
        m.u_created asc
    ) as rn
  from members m
)
insert into public.user_notification_settings
  (user_id, practice_id, notification_prefs, notify_email_address, notify_sms_number, notify_push)
select
  r.user_id,
  r.practice_id,
  case when r.rn = 1 then
    jsonb_build_object(
      'patient_replied',    jsonb_build_object('email', coalesce((r.p_prefs->'patient_replied'->>'email')::bool, true),   'sms', coalesce((r.p_prefs->'patient_replied'->>'sms')::bool, true),   'push', true),
      'case_converted',     jsonb_build_object('email', coalesce((r.p_prefs->'case_converted'->>'email')::bool, true),    'sms', coalesce((r.p_prefs->'case_converted'->>'sms')::bool, true),    'push', true),
      'daily_calls_due',    jsonb_build_object('email', coalesce((r.p_prefs->'daily_calls_due'->>'email')::bool, true),   'sms', coalesce((r.p_prefs->'daily_calls_due'->>'sms')::bool, false),  'push', true),
      'low_recording_rate', jsonb_build_object('email', coalesce((r.p_prefs->'low_recording_rate'->>'email')::bool, true),'sms', false,                                                       'push', true)
    )
  else
    jsonb_build_object(
      'patient_replied',    jsonb_build_object('email', false, 'sms', false, 'push', true),
      'case_converted',     jsonb_build_object('email', false, 'sms', false, 'push', true),
      'daily_calls_due',    jsonb_build_object('email', false, 'sms', false, 'push', true),
      'low_recording_rate', jsonb_build_object('email', false, 'sms', false, 'push', true)
    )
  end as notification_prefs,
  case when r.rn = 1 then coalesce(r.p_notify_email, r.u_email) else r.u_email end as notify_email_address,
  case when r.rn = 1 then r.p_notify_sms else null end as notify_sms_number,
  true as notify_push
from ranked r
on conflict (user_id) do nothing;
