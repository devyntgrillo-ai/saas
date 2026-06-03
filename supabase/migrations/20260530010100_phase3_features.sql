-- ============================================================================
-- Phase-3 feature columns + tables (Integrations, Notifications, Reactivation).
-- Idempotent. Run in the Supabase SQL editor (project eymgqjeudrmeofytnwgs).
-- ============================================================================

-- ── #7 Integrations: Slack incoming webhook + channel ───────────────────────
alter table public.practices add column if not exists slack_webhook_url text;
alter table public.practices add column if not exists slack_channel     text;
-- Reseller white-label + practice avg case value (used by dashboard pipeline KPI).
alter table public.practices add column if not exists avg_case_value numeric default 30000;

-- ── #8 Notifications ────────────────────────────────────────────────────────
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid,
  practice_id uuid references public.practices(id) on delete cascade,
  type        text,                       -- positive | action | info
  event       text,                       -- patient_replied | case_converted | ...
  title       text not null,
  message     text,
  link        text,
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists idx_notifications_practice on public.notifications(practice_id, created_at desc);
create index if not exists idx_notifications_unread   on public.notifications(practice_id) where not read;
alter table public.notifications enable row level security;
drop policy if exists "notifications_select_own_practice" on public.notifications;
create policy "notifications_select_own_practice" on public.notifications
  for select to authenticated using (practice_id = public.current_practice_id());
drop policy if exists "notifications_update_own_practice" on public.notifications;
create policy "notifications_update_own_practice" on public.notifications
  for update to authenticated using (practice_id = public.current_practice_id());

-- Per-practice notification preferences + reminders + digest settings.
alter table public.practices add column if not exists notification_prefs jsonb;
alter table public.practices add column if not exists notify_email_address text;
alter table public.practices add column if not exists notify_sms_number    text;
alter table public.practices add column if not exists recording_reminders_enabled boolean not null default false;
alter table public.practices add column if not exists recording_reminder_minutes  int not null default 5;
alter table public.practices add column if not exists recording_reminder_channel  text default 'push';
alter table public.practices add column if not exists weekly_digest_enabled boolean not null default true;
alter table public.practices add column if not exists weekly_digest_day     text default 'monday';
alter table public.practices add column if not exists weekly_digest_time    text default '9am';
alter table public.practices add column if not exists digest_owner_email    text;
alter table public.practices add column if not exists digest_tc_email       text;

-- ── #11 Knowledge base structured content ───────────────────────────────────
alter table public.practices add column if not exists knowledge_base_sections jsonb;
alter table public.practices add column if not exists knowledge_base_stories  jsonb;
alter table public.practices add column if not exists knowledge_base_updated_at timestamptz;
alter table public.practices add column if not exists knowledge_base_ai_updated_at timestamptz;

-- ── #16 Reactivation campaigns ──────────────────────────────────────────────
create table if not exists public.reactivation_campaigns (
  id               uuid primary key default gen_random_uuid(),
  practice_id      uuid not null references public.practices(id) on delete cascade,
  campaign_name    text,
  angle_type       text,                  -- price_lock | personal | new_option
  message_1_sms          text,
  message_1_email_subject text,
  message_1_email_body    text,
  message_2_sms          text,
  filter_date_min  timestamptz,
  filter_date_max  timestamptz,
  total_recipients int default 0,
  messages_per_day int default 20,
  status           text not null default 'draft', -- draft | scheduled | active | paused | completed
  scheduled_start  timestamptz,
  started_at       timestamptz,
  completed_at     timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists idx_react_campaigns_practice on public.reactivation_campaigns(practice_id, created_at desc);
alter table public.reactivation_campaigns enable row level security;
drop policy if exists "react_campaigns_all_own_practice" on public.reactivation_campaigns;
create policy "react_campaigns_all_own_practice" on public.reactivation_campaigns
  for all to authenticated using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());

create table if not exists public.reactivation_enrollments (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references public.reactivation_campaigns(id) on delete cascade,
  practice_id   uuid not null references public.practices(id) on delete cascade,
  consult_id    uuid references public.consults(id) on delete set null,
  patient_first text,
  patient_last  text,
  patient_phone text,
  patient_email text,
  status        text not null default 'pending', -- pending | sending | sent | replied | stopped
  messages_sent int not null default 0,
  last_sent_at  timestamptz,
  replied_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists idx_react_enroll_campaign on public.reactivation_enrollments(campaign_id);
create index if not exists idx_react_enroll_practice on public.reactivation_enrollments(practice_id, status);
alter table public.reactivation_enrollments enable row level security;
drop policy if exists "react_enroll_all_own_practice" on public.reactivation_enrollments;
create policy "react_enroll_all_own_practice" on public.reactivation_enrollments
  for all to authenticated using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());

-- Attribution status on consults (reporting): caselift_recovered etc.
alter table public.consults add column if not exists attribution_status text;
alter table public.consults add column if not exists conversion_source  text;
alter table public.consults add column if not exists closed_at          timestamptz;
