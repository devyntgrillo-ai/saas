-- ============================================================================
-- Hope AI - Database Schema
-- AI-powered sales recovery for dental implant practices.
--
-- Run this in the Supabase SQL editor (or via the CLI / MCP apply_migration).
-- It creates the core tables, enables Row Level Security, and scopes every
-- row to the authenticated user's practice.
-- ============================================================================

-- Extensions ----------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ============================================================================
-- practices
-- One row per dental practice (the tenant boundary).
-- ============================================================================
create table if not exists public.practices (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  doctor_first      text,
  doctor_last       text,
  email             text,
  phone             text,
  ghl_subaccount_id text,            -- GoHighLevel sub-account id
  ghl_api_key       text,            -- GoHighLevel API key (store encrypted in prod)
  plaud_webhook_url text,            -- Plaud recorder webhook target
  created_at        timestamptz not null default now()
);

-- ============================================================================
-- users
-- App users belonging to a practice. id mirrors auth.users.id.
-- ============================================================================
create table if not exists public.users (
  id          uuid primary key references auth.users(id) on delete cascade,
  practice_id uuid references public.practices(id) on delete set null,
  email       text not null,
  role        text not null default 'member',  -- 'owner' | 'admin' | 'member'
  created_at  timestamptz not null default now()
);

create index if not exists idx_users_practice on public.users(practice_id);

-- ============================================================================
-- consults
-- A recorded treatment-coordinator consult + its AI analysis.
-- ============================================================================
create table if not exists public.consults (
  id                   uuid primary key default gen_random_uuid(),
  practice_id          uuid not null references public.practices(id) on delete cascade,
  recording_time       time,
  recording_date       date,
  duration             integer,            -- seconds
  transcript           text,
  status               text not null default 'new', -- new | analyzing | analyzed | followed_up | recovered | lost
  primary_objection    text,
  secondary_objection  text,
  exit_intent          text,
  personal_detail      text,
  coaching_insight     text,
  downsell_opportunity text,
  tc_action            text,               -- recommended treatment-coordinator action
  created_at           timestamptz not null default now()
);

create index if not exists idx_consults_practice on public.consults(practice_id);
create index if not exists idx_consults_status   on public.consults(status);
create index if not exists idx_consults_date      on public.consults(recording_date desc);

-- ============================================================================
-- messages
-- AI-drafted / scheduled follow-up messages tied to a consult.
-- ============================================================================
create table if not exists public.messages (
  id            uuid primary key default gen_random_uuid(),
  consult_id    uuid not null references public.consults(id) on delete cascade,
  practice_id   uuid not null references public.practices(id) on delete cascade,
  type          text,                       -- followup | downsell | reminder | nurture
  channel       text,                       -- sms | email
  subject       text,
  body          text,
  status        text not null default 'draft', -- draft | scheduled | sent | failed
  scheduled_for timestamptz,
  sent_at       timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists idx_messages_consult  on public.messages(consult_id);
create index if not exists idx_messages_practice on public.messages(practice_id);
create index if not exists idx_messages_status   on public.messages(status);

-- ============================================================================
-- conversations
-- A two-way patient thread (SMS/email) optionally linked to a consult.
-- ============================================================================
create table if not exists public.conversations (
  id            uuid primary key default gen_random_uuid(),
  practice_id   uuid not null references public.practices(id) on delete cascade,
  patient_first text,
  patient_last  text,
  patient_phone text,
  patient_email text,
  consult_id    uuid references public.consults(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_conversations_practice on public.conversations(practice_id);

-- ============================================================================
-- conversation_messages
-- Individual inbound/outbound messages inside a conversation.
-- ============================================================================
create table if not exists public.conversation_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  direction       text not null,            -- inbound | outbound
  channel         text,                     -- sms | email
  body            text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists idx_convmsgs_conversation on public.conversation_messages(conversation_id);

-- ============================================================================
-- training_modules
-- Sales-training content (global library, not practice-scoped).
-- ============================================================================
create table if not exists public.training_modules (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  category    text,
  description text,
  video_url   text,
  duration    integer,                       -- seconds
  order_index integer default 0,
  created_at  timestamptz not null default now()
);

-- ============================================================================
-- Helper: the practice_id of the currently authenticated user.
-- ============================================================================
create or replace function public.current_practice_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select practice_id from public.users where id = auth.uid()
$$;

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.practices             enable row level security;
alter table public.users                  enable row level security;
alter table public.consults               enable row level security;
alter table public.messages               enable row level security;
alter table public.conversations          enable row level security;
alter table public.conversation_messages  enable row level security;
alter table public.training_modules       enable row level security;

-- practices: members can see/update their own practice ----------------------
drop policy if exists "practices_select" on public.practices;
create policy "practices_select" on public.practices
  for select using (id = public.current_practice_id());

drop policy if exists "practices_update" on public.practices;
create policy "practices_update" on public.practices
  for update using (id = public.current_practice_id());

-- Allow an authenticated user to create a practice during signup.
drop policy if exists "practices_insert" on public.practices;
create policy "practices_insert" on public.practices
  for insert to authenticated
  with check (auth.uid() is not null);

-- users: a user can read rows in their practice, manage their own row --------
drop policy if exists "users_select" on public.users;
create policy "users_select" on public.users
  for select using (practice_id = public.current_practice_id() or id = auth.uid());

drop policy if exists "users_insert_self" on public.users;
create policy "users_insert_self" on public.users
  for insert with check (id = auth.uid());

drop policy if exists "users_update_self" on public.users;
create policy "users_update_self" on public.users
  for update using (id = auth.uid());

-- Generic practice-scoped policy generator for the data tables ---------------
do $$
declare t text;
begin
  foreach t in array array['consults','messages','conversations'] loop
    execute format('drop policy if exists "%s_all" on public.%I;', t, t);
    execute format($f$
      create policy "%1$s_all" on public.%1$I
        for all
        using (practice_id = public.current_practice_id())
        with check (practice_id = public.current_practice_id());
    $f$, t);
  end loop;
end $$;

-- conversation_messages: scoped via parent conversation ----------------------
drop policy if exists "conversation_messages_all" on public.conversation_messages;
create policy "conversation_messages_all" on public.conversation_messages
  for all
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and c.practice_id = public.current_practice_id()
    )
  )
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and c.practice_id = public.current_practice_id()
    )
  );

-- training_modules: readable by any authenticated user -----------------------
drop policy if exists "training_select" on public.training_modules;
create policy "training_select" on public.training_modules
  for select using (auth.role() = 'authenticated');

-- ============================================================================
-- Trigger: auto-provision a public.users row when an auth user is created.
-- The practice_id is set client-side after signup (or via metadata).
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, role)
  values (new.id, new.email, 'owner')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- Lock down SECURITY DEFINER functions so they can't be abused via the API.
-- The trigger function never needs to be callable directly; current_practice_id
-- is only needed during RLS evaluation for signed-in users.
-- ============================================================================
revoke execute on function public.handle_new_user()   from public, anon, authenticated;
revoke execute on function public.current_practice_id() from public, anon;
grant  execute on function public.current_practice_id() to authenticated;

-- ============================================================================
-- Onboarding, sequence config, and AI knowledge-base timestamp
-- ============================================================================
alter table public.practices
  add column if not exists onboarding_completed boolean not null default false,
  add column if not exists sequence_config jsonb,
  add column if not exists kb_updated_at timestamptz;

-- ============================================================================
-- notifications
-- Real-time, practice-scoped notifications (consult analyzed, patient replied,
-- sequence started / paused). Streamed to clients via Supabase Realtime.
-- ============================================================================
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete cascade,
  type        text not null default 'info',
  title       text not null,
  message     text,
  read        boolean not null default false,
  link        text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_notifications_practice on public.notifications(practice_id);
create index if not exists idx_notifications_unread   on public.notifications(practice_id, read);
create index if not exists idx_notifications_created  on public.notifications(created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "notifications_select" on public.notifications;
create policy "notifications_select" on public.notifications
  for select using (
    practice_id = public.current_practice_id()
    and (user_id is null or user_id = auth.uid())
  );

drop policy if exists "notifications_insert" on public.notifications;
create policy "notifications_insert" on public.notifications
  for insert to authenticated
  with check (practice_id = public.current_practice_id());

drop policy if exists "notifications_update" on public.notifications;
create policy "notifications_update" on public.notifications
  for update using (
    practice_id = public.current_practice_id()
    and (user_id is null or user_id = auth.uid())
  );

-- Stream notification changes to subscribed clients.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ============================================================================
-- AI LEARNING & OPTIMIZATION SYSTEM
-- Outcome tracking + cross-practice network insights + performance snapshots.
-- ============================================================================

-- Per-message outcome tracking (written by triggers; practice-scoped reads).
create table if not exists public.message_outcomes (
  id                  uuid primary key default gen_random_uuid(),
  practice_id         uuid not null references public.practices(id) on delete cascade,
  consult_id          uuid references public.consults(id) on delete cascade,
  message_id          uuid references public.messages(id) on delete cascade,
  conversation_id     uuid references public.conversations(id) on delete set null,
  objection_primary   text,
  objection_secondary text,
  exit_intent         text,
  message_position    int,
  message_channel     text,
  cta_type            text,
  tone_type           text,
  sent_at             timestamptz,
  opened_at           timestamptz,
  replied_at          timestamptz,
  booked_at           timestamptz,
  closed_at           timestamptz,
  opened              boolean not null default false,
  replied             boolean not null default false,
  booked_after        boolean not null default false,
  closed_after        boolean not null default false,
  days_since_consult  int,
  treatment_value     numeric,
  created_at          timestamptz not null default now()
);
create index if not exists idx_mo_practice on public.message_outcomes(practice_id);
create index if not exists idx_mo_consult on public.message_outcomes(consult_id);
create index if not exists idx_mo_message on public.message_outcomes(message_id);
create index if not exists idx_mo_group on public.message_outcomes(objection_primary, exit_intent, message_position, cta_type);

-- Cross-practice learnings (global; readable by all authenticated users).
create table if not exists public.network_insights (
  id               uuid primary key default gen_random_uuid(),
  insight_type     text,
  objection_type   text,
  exit_intent      text,
  message_position int,
  message_channel  text,
  finding          text,
  recommendation   text,
  confidence_score double precision,
  sample_size      int,
  avg_reply_rate   double precision,
  avg_close_rate   double precision,
  last_updated     timestamptz default now(),
  created_at       timestamptz not null default now()
);
create index if not exists idx_ni_objection on public.network_insights(objection_type, exit_intent);

create table if not exists public.practice_performance_snapshots (
  id                               uuid primary key default gen_random_uuid(),
  practice_id                      uuid not null references public.practices(id) on delete cascade,
  snapshot_date                    date not null default current_date,
  total_consults                   int default 0,
  total_sequences_started          int default 0,
  total_replies                    int default 0,
  total_booked                     int default 0,
  total_closed                     int default 0,
  total_production_recovered        numeric default 0,
  avg_reply_rate                   double precision default 0,
  avg_close_rate                   double precision default 0,
  best_performing_message_position int,
  created_at                       timestamptz not null default now()
);
create index if not exists idx_pps_practice on public.practice_performance_snapshots(practice_id, snapshot_date desc);

create table if not exists public.message_optimizations (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid references public.messages(id) on delete cascade,
  practice_id uuid not null references public.practices(id) on delete cascade,
  before_body text,
  after_body  text,
  explanation text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_msgopt_practice on public.message_optimizations(practice_id);

alter table public.message_outcomes              enable row level security;
alter table public.network_insights              enable row level security;
alter table public.practice_performance_snapshots enable row level security;
alter table public.message_optimizations         enable row level security;

drop policy if exists "message_outcomes_select" on public.message_outcomes;
create policy "message_outcomes_select" on public.message_outcomes
  for select using (practice_id = public.current_practice_id());

drop policy if exists "network_insights_select" on public.network_insights;
create policy "network_insights_select" on public.network_insights
  for select to authenticated using (true);

drop policy if exists "pps_select" on public.practice_performance_snapshots;
create policy "pps_select" on public.practice_performance_snapshots
  for select using (practice_id = public.current_practice_id());

drop policy if exists "msgopt_select" on public.message_optimizations;
create policy "msgopt_select" on public.message_optimizations
  for select using (practice_id = public.current_practice_id());
drop policy if exists "msgopt_insert" on public.message_optimizations;
create policy "msgopt_insert" on public.message_optimizations
  for insert to authenticated with check (practice_id = public.current_practice_id());

-- CTA / tone extraction from a message body. -------------------------------
create or replace function public.extract_cta_type(body text)
returns text language plpgsql immutable as $$
declare b text := lower(coalesce(body, ''));
begin
  if b ~ 'reply\s+yes' then return 'reply_yes';
  elsif b ~ '(give us a call|call us|give me a call|call our)' then return 'call';
  elsif b ~ 'book\s+online' then return 'book_online';
  elsif b ~ 'come\s+in' then return 'come_in';
  elsif b ~ 'reply\s+to\s+this' then return 'reply_to_this';
  elsif b ~ '\?' then return 'question';
  elsif b ~ 'reply' then return 'reply';
  else return 'other';
  end if;
end $$;

create or replace function public.extract_tone_type(body text)
returns text language plpgsql immutable as $$
declare b text := lower(coalesce(body, ''));
begin
  if b ~ '(story|patient (with|like)|wish they|changed everything)' then return 'story';
  elsif b ~ '(today|spot|limited|don.t wait|right now|hold a spot|act now)' then return 'urgency';
  elsif b ~ '(many of our|other patients|patients tell us|most patients|join the)' then return 'social_proof';
  elsif b ~ '(financing|how it works|options|explain|breakdown|monthly payment)' then return 'educational';
  else return 'check_in';
  end if;
end $$;

-- Triggers: create on send, mark on reply, propagate on close. --------------
create or replace function public.track_message_sent()
returns trigger language plpgsql security definer set search_path = public as $$
declare c record; pos int; conv_id uuid; sent timestamptz;
begin
  if NEW.status <> 'sent' then return NEW; end if;
  if TG_OP = 'UPDATE' and OLD.status = 'sent' then return NEW; end if;
  if exists (select 1 from public.message_outcomes where message_id = NEW.id) then return NEW; end if;
  select * into c from public.consults where id = NEW.consult_id;
  select count(*) into pos from public.messages m where m.consult_id = NEW.consult_id and m.created_at <= NEW.created_at;
  select id into conv_id from public.conversations where consult_id = NEW.consult_id limit 1;
  sent := coalesce(NEW.sent_at, now());
  insert into public.message_outcomes (
    practice_id, consult_id, message_id, conversation_id,
    objection_primary, objection_secondary, exit_intent,
    message_position, message_channel, cta_type, tone_type,
    sent_at, days_since_consult
  ) values (
    NEW.practice_id, NEW.consult_id, NEW.id, conv_id,
    c.objection_type, c.secondary_objection, c.exit_intent_level,
    least(pos, 6), NEW.channel, extract_cta_type(NEW.body), extract_tone_type(NEW.body),
    sent, case when c.recording_date is not null then (sent::date - c.recording_date) else null end
  );
  return NEW;
end $$;
drop trigger if exists trg_track_message_sent on public.messages;
create trigger trg_track_message_sent after insert or update of status on public.messages
  for each row execute function public.track_message_sent();

create or replace function public.track_patient_reply()
returns trigger language plpgsql security definer set search_path = public as $$
declare cid uuid; target uuid;
begin
  if NEW.direction <> 'inbound' then return NEW; end if;
  select consult_id into cid from public.conversations where id = NEW.conversation_id;
  if cid is null then return NEW; end if;
  select id into target from public.message_outcomes
    where consult_id = cid and replied = false order by sent_at desc nulls last limit 1;
  if target is not null then
    update public.message_outcomes set replied = true, replied_at = coalesce(NEW.sent_at, now()) where id = target;
  end if;
  return NEW;
end $$;
drop trigger if exists trg_track_patient_reply on public.conversation_messages;
create trigger trg_track_patient_reply after insert on public.conversation_messages
  for each row execute function public.track_patient_reply();

create or replace function public.track_consult_closed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.status = OLD.status then return NEW; end if;
  if NEW.status = 'closed_won' then
    update public.message_outcomes
      set closed_after = true, booked_after = true, closed_at = now(),
          booked_at = coalesce(booked_at, now()), treatment_value = NEW.case_value
      where consult_id = NEW.id;
  elsif NEW.status = 'closed_lost' then
    update public.message_outcomes set closed_after = false, closed_at = now() where consult_id = NEW.id;
  end if;
  return NEW;
end $$;
drop trigger if exists trg_track_consult_closed on public.consults;
create trigger trg_track_consult_closed after update of status on public.consults
  for each row execute function public.track_consult_closed();

-- Aggregation for generate-network-insights (groups with sample >= min_sample).
create or replace function public.get_network_aggregates(min_sample int default 10)
returns table(
  objection_type text, exit_intent text, message_position int, message_channel text, cta_type text,
  sample_size bigint, avg_reply_rate numeric, avg_close_rate numeric, avg_open_rate numeric
)
language sql stable security definer set search_path = public as $$
  select objection_primary, exit_intent, message_position, message_channel, cta_type,
    count(*),
    round(avg(case when replied then 1 else 0 end)::numeric, 3),
    round(avg(case when closed_after then 1 else 0 end)::numeric, 3),
    round(avg(case when opened then 1 else 0 end)::numeric, 3)
  from public.message_outcomes
  where objection_primary is not null and message_position is not null
  group by 1, 2, 3, 4, 5
  having count(*) >= min_sample
  order by count(*) desc
$$;
revoke all on function public.get_network_aggregates(int) from public, anon;
grant execute on function public.get_network_aggregates(int) to authenticated, service_role;

-- Weekly schedules (pg_cron + pg_net) live as a separate migration; they call
-- generate-network-insights (Mon 07:00 UTC) and weekly-intelligence-digest (08:00).

-- ============================================================================
-- CANCELLATION / RETENTION FLOW
-- ============================================================================
alter table public.practices
  add column if not exists pause_ends_at timestamptz,
  add column if not exists downsell_accepted_at timestamptz;
-- subscription_status also supports the value 'paused' (text column).

create table if not exists public.cancellation_feedback (
  id                   uuid primary key default gen_random_uuid(),
  practice_id          uuid not null references public.practices(id) on delete cascade,
  reason               text,
  elaboration          text,
  mrr_at_cancellation  numeric,
  production_recovered numeric,
  consults_analyzed    int,
  created_at           timestamptz not null default now()
);
create index if not exists idx_cancel_fb_practice on public.cancellation_feedback(practice_id);

alter table public.cancellation_feedback enable row level security;
drop policy if exists "cancel_fb_select" on public.cancellation_feedback;
create policy "cancel_fb_select" on public.cancellation_feedback
  for select using (practice_id = public.current_practice_id());
drop policy if exists "cancel_fb_insert" on public.cancellation_feedback;
create policy "cancel_fb_insert" on public.cancellation_feedback
  for insert to authenticated with check (practice_id = public.current_practice_id());

-- ============================================================================
-- DUAL RECORDING SYSTEM (browser recording + Plaud AutoFlow)
-- ============================================================================
alter table public.consults
  add column if not exists recording_source text; -- browser | plaud_autoflow | plaud_device

alter table public.practices
  add column if not exists recording_method text not null default 'browser',
  add column if not exists audio_quality text not null default 'standard',
  add column if not exists auto_analyze boolean not null default true,
  add column if not exists auto_start_followup boolean not null default false;

-- Private storage bucket for raw audio (read server-side by analyze-consult,
-- deleted after de-identified text is extracted).
insert into storage.buckets (id, name, public)
values ('consult-recordings', 'consult-recordings', false)
on conflict (id) do nothing;

drop policy if exists "consult_recordings_insert" on storage.objects;
create policy "consult_recordings_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'consult-recordings');
drop policy if exists "consult_recordings_select" on storage.objects;
create policy "consult_recordings_select" on storage.objects
  for select to authenticated using (bucket_id = 'consult-recordings');
drop policy if exists "consult_recordings_delete" on storage.objects;
create policy "consult_recordings_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'consult-recordings');

-- ============================================================================
-- PMS (SIKKA) INTEGRATION + ATTRIBUTION MODEL
-- ============================================================================
alter table public.practices
  add column if not exists sikka_practice_id text,
  add column if not exists pms_type text,
  add column if not exists pms_connected boolean not null default false,
  add column if not exists pms_status text,
  add column if not exists pms_last_sync timestamptz,
  add column if not exists pms_sync_enabled boolean not null default true;

alter table public.consults
  add column if not exists pms_appointment_id text,
  add column if not exists pms_synced boolean not null default false,
  add column if not exists attribution_model text; -- consultiq_recovered | practice_recovered | unknown

alter table public.cancellation_feedback
  add column if not exists messages_sent int;

create table if not exists public.pms_appointments (
  id                 uuid primary key default gen_random_uuid(),
  practice_id        uuid not null references public.practices(id) on delete cascade,
  pms_appointment_id text,
  patient_first      text,
  patient_last       text,
  patient_phone      text,
  patient_email      text,
  appointment_time   timestamptz,
  appointment_type   text,
  provider           text,
  is_implant_consult boolean not null default false,
  -- Deferrable so any in-transaction back-link to a just-inserted consult is
  -- checked at commit, not mid-statement. (Linking is done AFTER INSERT below.)
  consult_id         uuid references public.consults(id) on delete set null deferrable initially deferred,
  created_at         timestamptz not null default now()
);
create index if not exists idx_pms_appts_practice on public.pms_appointments(practice_id, appointment_time);

create table if not exists public.pms_sync_log (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id) on delete cascade,
  sync_type text, records_synced int default 0, errors text,
  created_at timestamptz not null default now()
);
create index if not exists idx_pms_synclog_practice on public.pms_sync_log(practice_id, created_at desc);

create table if not exists public.pms_sync (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id) on delete cascade,
  consult_id uuid references public.consults(id) on delete cascade,
  pms_patient_id text, pms_appointment_id text, pms_treatment_status text,
  pms_production_amount numeric, last_synced timestamptz default now()
);
create index if not exists idx_pms_sync_practice on public.pms_sync(practice_id);

alter table public.pms_appointments enable row level security;
alter table public.pms_sync_log     enable row level security;
alter table public.pms_sync         enable row level security;

drop policy if exists "pms_appts_all" on public.pms_appointments;
create policy "pms_appts_all" on public.pms_appointments for all
  using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());
drop policy if exists "pms_synclog_select" on public.pms_sync_log;
create policy "pms_synclog_select" on public.pms_sync_log for select using (practice_id = public.current_practice_id());
drop policy if exists "pms_synclog_insert" on public.pms_sync_log;
create policy "pms_synclog_insert" on public.pms_sync_log for insert to authenticated with check (practice_id = public.current_practice_id());
drop policy if exists "pms_sync_all" on public.pms_sync;
create policy "pms_sync_all" on public.pms_sync for all
  using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());

-- Auto-match a new consult to a PMS appointment within a 2-hour window.
-- BEFORE INSERT only populates the new consult's patient fields from the
-- matched appointment. It must NOT write to pms_appointments here: NEW.id does
-- not yet reference a committed consults row, so setting
-- pms_appointments.consult_id = NEW.id would violate
-- pms_appointments_consult_id_fkey. The back-link is done AFTER INSERT below.
create or replace function public.match_consult_to_pms()
returns trigger language plpgsql security definer set search_path = public as $$
declare appt record; ts timestamptz;
begin
  if NEW.patient_name is not null or NEW.pms_appointment_id is not null then return NEW; end if;
  ts := coalesce((NEW.recording_date + coalesce(NEW.recording_time, '00:00:00'::time))::timestamptz, NEW.created_at, now());
  select * into appt from public.pms_appointments a
    where a.practice_id = NEW.practice_id and a.consult_id is null and a.appointment_time is not null
      and abs(extract(epoch from (a.appointment_time - ts))) <= 7200
    order by abs(extract(epoch from (a.appointment_time - ts))) asc limit 1;
  if found then
    NEW.patient_name := nullif(trim(coalesce(appt.patient_first,'')||' '||coalesce(appt.patient_last,'')), '');
    NEW.patient_phone := appt.patient_phone; NEW.patient_email := appt.patient_email;
    NEW.pms_appointment_id := coalesce(appt.pms_appointment_id, appt.id::text);
  end if;
  return NEW;
end $$;
drop trigger if exists trg_match_consult_to_pms on public.consults;
create trigger trg_match_consult_to_pms before insert on public.consults
  for each row execute function public.match_consult_to_pms();

-- Back-link the matched PMS appointment to the consult AFTER the consult row
-- exists, so the consult_id FK is satisfied. Idempotent; only links an
-- appointment that is still unclaimed.
create or replace function public.link_consult_to_pms()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.pms_appointment_id is null then return NEW; end if;
  update public.pms_appointments
    set consult_id = NEW.id
    where practice_id = NEW.practice_id
      and consult_id is null
      and (pms_appointment_id = NEW.pms_appointment_id or id::text = NEW.pms_appointment_id);
  return NEW;
end $$;
drop trigger if exists trg_link_consult_to_pms on public.consults;
create trigger trg_link_consult_to_pms after insert on public.consults
  for each row execute function public.link_consult_to_pms();

-- Conservative attribution when a consult is closed.
create or replace function public.set_consult_attribution()
returns trigger language plpgsql security definer set search_path = public as $$
declare engaged boolean;
begin
  if NEW.status = OLD.status then return NEW; end if;
  if NEW.status = 'closed_won' then
    select exists (select 1 from public.message_outcomes mo where mo.consult_id = NEW.id and (mo.replied or mo.booked_after)) into engaged;
    NEW.attribution_model := case when engaged then 'consultiq_recovered' else 'practice_recovered' end;
  elsif NEW.status = 'closed_lost' then
    NEW.attribution_model := coalesce(NEW.attribution_model, 'unknown');
  end if;
  return NEW;
end $$;
drop trigger if exists trg_set_consult_attribution on public.consults;
create trigger trg_set_consult_attribution before update of status on public.consults
  for each row execute function public.set_consult_attribution();

-- ============================================================================
-- ATTRIBUTION MODEL v2 + auditable attribution_events trail
-- (mirrors migration 20260530010000_attribution_events.sql)
-- ============================================================================
alter table public.consults
  add column if not exists attribution_status text,        -- consultiq_assisted | consultiq_recovered | practice_direct | unknown
  add column if not exists attribution_confirmed_at timestamptz,
  add column if not exists attribution_source text;        -- pms_sync | manual | webhook

alter table public.consults drop constraint if exists consults_attribution_status_check;
alter table public.consults add constraint consults_attribution_status_check
  check (attribution_status is null or attribution_status in
    ('consultiq_assisted', 'consultiq_recovered', 'practice_direct', 'unknown'));

create table if not exists public.attribution_events (
  id          uuid primary key default gen_random_uuid(),
  consult_id  uuid not null references public.consults(id) on delete cascade,
  practice_id uuid not null references public.practices(id) on delete cascade,
  event_type  text not null,                     -- message_sent | patient_replied | treatment_accepted
  event_date  timestamptz not null default now(),
  source      text not null default 'consultiq', -- consultiq | pms | manual
  created_at  timestamptz not null default now()
);
create index if not exists idx_attr_events_consult  on public.attribution_events(consult_id);
create index if not exists idx_attr_events_practice on public.attribution_events(practice_id);
create index if not exists idx_attr_events_type     on public.attribution_events(consult_id, event_type);

alter table public.attribution_events enable row level security;
drop policy if exists "attr_events_select" on public.attribution_events;
create policy "attr_events_select" on public.attribution_events
  for select using (practice_id = public.current_practice_id());
drop policy if exists "attr_events_insert" on public.attribution_events;
create policy "attr_events_insert" on public.attribution_events
  for insert to authenticated with check (practice_id = public.current_practice_id());

create or replace function public.derive_attribution_status(p_consult_id uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare replied boolean; sent boolean;
begin
  select exists (
    select 1 from public.conversation_messages cm
    join public.conversations cv on cv.id = cm.conversation_id
    where cv.consult_id = p_consult_id and cm.direction = 'inbound'
  ) or exists (
    select 1 from public.attribution_events ae
    where ae.consult_id = p_consult_id and ae.event_type = 'patient_replied'
  ) into replied;
  select exists (
    select 1 from public.messages m where m.consult_id = p_consult_id and m.status = 'sent'
  ) or exists (
    select 1 from public.attribution_events ae
    where ae.consult_id = p_consult_id and ae.event_type = 'message_sent'
  ) into sent;
  if replied then return 'consultiq_recovered'; end if;
  if sent then return 'consultiq_assisted'; end if;
  return 'practice_direct';
end $$;
grant execute on function public.derive_attribution_status(uuid) to authenticated, service_role;

create or replace function public.log_message_sent_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.status = 'sent' and (TG_OP = 'INSERT' or OLD.status is distinct from 'sent')
     and NEW.consult_id is not null then
    insert into public.attribution_events (consult_id, practice_id, event_type, event_date, source)
    values (NEW.consult_id, NEW.practice_id, 'message_sent', coalesce(NEW.sent_at, now()), 'consultiq');
  end if;
  return NEW;
end $$;
drop trigger if exists trg_log_message_sent on public.messages;
create trigger trg_log_message_sent after insert or update of status on public.messages
  for each row execute function public.log_message_sent_event();

create or replace function public.log_patient_replied_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare cv_consult uuid; cv_practice uuid;
begin
  if NEW.direction = 'inbound' then
    select consult_id, practice_id into cv_consult, cv_practice
      from public.conversations where id = NEW.conversation_id;
    if cv_consult is not null then
      insert into public.attribution_events (consult_id, practice_id, event_type, event_date, source)
      values (cv_consult, cv_practice, 'patient_replied', coalesce(NEW.sent_at, NEW.created_at, now()), 'consultiq');
    end if;
  end if;
  return NEW;
end $$;
drop trigger if exists trg_log_patient_replied on public.conversation_messages;
create trigger trg_log_patient_replied after insert on public.conversation_messages
  for each row execute function public.log_patient_replied_event();

create or replace function public.set_attribution_on_close()
returns trigger language plpgsql security definer set search_path = public as $$
declare became_won boolean; new_status text;
begin
  became_won :=
       (NEW.status  = 'closed_won' and OLD.status  is distinct from 'closed_won')
    or (NEW.outcome = 'closed_won' and OLD.outcome is distinct from 'closed_won')
    or (NEW.outcome = 'accepted'   and OLD.outcome is distinct from 'accepted');
  if not became_won then return NEW; end if;
  new_status := public.derive_attribution_status(NEW.id);
  NEW.attribution_status       := new_status;
  NEW.attribution_confirmed_at := now();
  NEW.attribution_source       := coalesce(NEW.attribution_source, 'manual');
  NEW.attribution_model := case
    when new_status in ('consultiq_recovered', 'consultiq_assisted') then 'consultiq_recovered'
    else 'practice_recovered' end;
  insert into public.attribution_events (consult_id, practice_id, event_type, event_date, source)
  values (NEW.id, NEW.practice_id, 'treatment_accepted', now(), coalesce(NEW.attribution_source, 'manual'));
  return NEW;
end $$;
drop trigger if exists trg_set_consult_attribution on public.consults;
drop trigger if exists trg_set_attribution_on_close on public.consults;
create trigger trg_set_attribution_on_close before update of status, outcome on public.consults
  for each row execute function public.set_attribution_on_close();
