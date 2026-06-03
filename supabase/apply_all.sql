-- ============================================================================
-- apply_all.sql - bring a CaseLift database fully up to date in one run.
--
-- Bundles every SCHEMA migration (idempotent column/table/RLS additions) in
-- dependency order, wrapped in a single transaction. Safe to re-run.
--
-- Run in the Supabase SQL editor (project eymgqjeudrmeofytnwgs) AFTER schema.sql
-- has been applied (it relies on the base tables practices/users/consults/
-- messages/conversations/pms_appointments and the current_practice_id() helper).
--
-- NOT included here (run separately, on purpose):
--   • Cron jobs: 20260529050000_cron_sync_appointments.sql,
--     20260529070000_cron_process_sequences.sql,
--     20260529100000_cron_send_due_messages.sql
--     → require the pg_cron + pg_net extensions and the app.supabase_url /
--       app.service_role_key database settings (sensitive). Enable the
--       extensions and set those, then run those three files.
--   • Seeds: reseller_practices_seed.sql, admin_seed.sql,
--     20260529030000_seed_pms_appointments.sql, seed_sequences.sql
--     → data, not schema. Run after this, in that order.
-- ============================================================================

begin;


-- ════════════════════════════════════════════════════════════════════════
-- >>> migrations/20260529000000_audit_logs.sql
-- ════════════════════════════════════════════════════════════════════════
-- ============================================================================
-- audit_logs - HIPAA access trail. Idempotent: safe to run whether the table
-- is missing or already exists with a different column shape.
--
-- The frontend (src/pages/AuditLog.jsx) reads: id, created_at, user_email,
-- action, resource_type, resource_id. The log_audit_event() RPC and
-- logImpersonation() write here. This ensures all read columns exist + RLS.
--
-- Run in the Supabase SQL editor (project eymgqjeudrmeofytnwgs).
-- (Could not run from the agent session - no DB connection available.)
-- ============================================================================

create table if not exists public.audit_logs (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  practice_id  uuid references public.practices(id) on delete cascade,
  user_id      uuid,
  user_email   text,
  action       text,
  resource_type text,
  resource_id  text,
  ip_address   text
);

-- Backfill columns if an older audit_logs table predates this migration.
alter table public.audit_logs add column if not exists practice_id  uuid;
alter table public.audit_logs add column if not exists user_id      uuid;
alter table public.audit_logs add column if not exists user_email   text;
alter table public.audit_logs add column if not exists action       text;
alter table public.audit_logs add column if not exists resource_type text;
alter table public.audit_logs add column if not exists resource_id  text;
alter table public.audit_logs add column if not exists ip_address   text;

create index if not exists idx_audit_logs_practice on public.audit_logs(practice_id);
create index if not exists idx_audit_logs_created  on public.audit_logs(created_at desc);

-- RLS: an authenticated user may read only their own practice's audit logs.
alter table public.audit_logs enable row level security;

drop policy if exists "audit_logs_select_own_practice" on public.audit_logs;
create policy "audit_logs_select_own_practice" on public.audit_logs
  for select to authenticated
  using (practice_id = public.current_practice_id());

-- Inserts are performed by the SECURITY DEFINER log_audit_event() function and
-- service-role calls, so no authenticated INSERT policy is granted here.


-- ════════════════════════════════════════════════════════════════════════
-- >>> migrations/20260602010000_chargebee_billing_columns.sql
-- ════════════════════════════════════════════════════════════════════════
-- ============================================================================
-- Billing columns on practices (Chargebee). Idempotent.
-- Run in the Supabase SQL editor (project eymgqjeudrmeofytnwgs).
-- ============================================================================
alter table public.practices add column if not exists subscription_status      text default 'trial';
alter table public.practices add column if not exists chargebee_customer_id     text;
alter table public.practices add column if not exists chargebee_subscription_id text;
alter table public.practices add column if not exists trial_ends_at             timestamptz;
alter table public.practices add column if not exists current_period_end        timestamptz;
-- next_billing_date is written by chargebee-webhook for display.
alter table public.practices add column if not exists next_billing_date         date;

create index if not exists idx_practices_chargebee_customer     on public.practices(chargebee_customer_id);
create index if not exists idx_practices_chargebee_subscription on public.practices(chargebee_subscription_id);


-- ════════════════════════════════════════════════════════════════════════
-- >>> migrations/20260529020000_consult_appointment_link.sql
-- ════════════════════════════════════════════════════════════════════════
-- ============================================================================
-- Link consults to PMS appointments. Idempotent.
--
-- NOTE: pms_appointments uses `appointment_time` (timestamptz), not a separate
-- `appointment_date` column, and is already indexed on
-- (practice_id, appointment_time) - so no extra date index is added here.
-- consults already has patient_name / patient_phone / patient_email /
-- pms_appointment_id (text); this adds the uuid FK the new flow uses.
-- Run in the Supabase SQL editor (project eymgqjeudrmeofytnwgs).
-- ============================================================================
alter table public.consults
  add column if not exists appointment_id uuid references public.pms_appointments(id) on delete set null;

create index if not exists idx_consults_appointment on public.consults(appointment_id);

-- Defensive: ensure the patient columns the flow writes exist (they already do
-- on current schemas, but keep this runnable on older ones).
alter table public.consults add column if not exists patient_name  text;
alter table public.consults add column if not exists patient_phone text;
alter table public.consults add column if not exists patient_email text;


-- ════════════════════════════════════════════════════════════════════════
-- >>> migrations/20260529040000_sikka_pms.sql
-- ════════════════════════════════════════════════════════════════════════
-- ============================================================================
-- Sikka PMS integration columns + supporting tables. Idempotent.
-- Run in the Supabase SQL editor (project eymgqjeudrmeofytnwgs).
-- ============================================================================

-- practices: Sikka linkage. sikka_practice_id is the Sikka office_id.
alter table public.practices add column if not exists sikka_practice_id  text;
alter table public.practices add column if not exists sikka_connected     boolean not null default false;
alter table public.practices add column if not exists pms_type            text;            -- informational (dentrix/eaglesoft/...)
alter table public.practices add column if not exists pms_last_synced_at  timestamptz;
-- Sikka OAuth 2.0 per-practice tokens (see 20260530030000_sikka_oauth.sql).
alter table public.practices add column if not exists sikka_request_key      text;
alter table public.practices add column if not exists sikka_refresh_token    text;
alter table public.practices add column if not exists sikka_token_expires_at timestamptz;

-- pms_appointments: a duration column + a unique key for idempotent upserts on
-- re-sync. (Existing columns: patient_first/last/phone/email, appointment_time,
-- appointment_type, provider, pms_appointment_id, is_implant_consult.)
alter table public.pms_appointments add column if not exists duration_minutes int;

-- Upsert key: (practice_id, pms_appointment_id). NULLs are allowed/distinct, so
-- manual (non-Sikka) rows with a null pms_appointment_id don't collide.
create unique index if not exists uq_pms_appts_practice_extid
  on public.pms_appointments(practice_id, pms_appointment_id);

-- Unlinked Sikka registrations for admin review (when the connect webhook can't
-- match a Sikka practice to a CaseLift practice).
create table if not exists public.sikka_registrations (
  id                uuid primary key default gen_random_uuid(),
  sikka_practice_id text,
  practice_name     text,
  npi               text,
  raw               jsonb,
  matched_practice_id uuid references public.practices(id) on delete set null,
  status            text not null default 'unlinked', -- unlinked | linked | ignored
  created_at        timestamptz not null default now()
);
create index if not exists idx_sikka_registrations_status on public.sikka_registrations(status, created_at desc);

alter table public.sikka_registrations enable row level security;
-- Super-admins read/manage unlinked registrations from the admin panel.
drop policy if exists "sikka_reg_admin_select" on public.sikka_registrations;
create policy "sikka_reg_admin_select" on public.sikka_registrations
  for select to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.access_level = 'super_admin'));
drop policy if exists "sikka_reg_admin_update" on public.sikka_registrations;
create policy "sikka_reg_admin_update" on public.sikka_registrations
  for update to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.access_level = 'super_admin'));
-- Inserts come from the sikka-connect-webhook (service role, bypasses RLS).


-- ════════════════════════════════════════════════════════════════════════
-- >>> migrations/20260529060000_consult_outcome.sql
-- ════════════════════════════════════════════════════════════════════════
-- ============================================================================
-- Consult outcome + sequence-guard columns. Idempotent.
-- A sequence only fires when outcome is 'pending' (after the activation hold)
-- or 'rescheduled' (Day 30+). 'accepted'/'not_converting'/'closed_won' stop it.
-- Run in the Supabase SQL editor (project eymgqjeudrmeofytnwgs).
-- ============================================================================
alter table public.consults add column if not exists outcome text default 'pending';
alter table public.consults drop constraint if exists consults_outcome_check;
alter table public.consults add constraint consults_outcome_check
  check (outcome in ('pending', 'accepted', 'not_converting', 'rescheduled', 'closed_won'));

alter table public.consults add column if not exists outcome_note text;
alter table public.consults add column if not exists outcome_set_at timestamptz;
alter table public.consults add column if not exists outcome_set_by uuid references auth.users(id);
alter table public.consults add column if not exists sequence_activated_at timestamptz;
alter table public.consults add column if not exists sequence_cancelled_at timestamptz;
alter table public.consults add column if not exists sequence_cancelled_reason text;

create index if not exists idx_consults_outcome on public.consults(practice_id, outcome);


-- ════════════════════════════════════════════════════════════════════════
-- >>> migrations/20260529060000_phone_messaging_settings.sql
-- ════════════════════════════════════════════════════════════════════════
-- ============================================================================
-- Phone & Messaging settings columns for the Settings → Phone & Messaging page.
-- Idempotent - safe to re-run. Run in the Supabase SQL editor (project
-- eymgqjeudrmeofytnwgs).
-- ============================================================================

-- practices: per-practice SMS/email follow-up configuration + sequence cadence.
alter table public.practices add column if not exists sms_enabled        boolean not null default true;
alter table public.practices add column if not exists email_enabled      boolean not null default true;
alter table public.practices add column if not exists sms_sender_name     text;
alter table public.practices add column if not exists email_from_name     text;
alter table public.practices add column if not exists email_reply_to      text;
alter table public.practices add column if not exists sequence_day2_delay int not null default 3;
alter table public.practices add column if not exists sequence_day3_delay int not null default 7;

-- conversations: TCPA opt-out flag. Set automatically when a patient replies
-- STOP/UNSUBSCRIBE; the Phone & Messaging page counts these for visibility.
alter table public.conversations add column if not exists opted_out    boolean not null default false;
alter table public.conversations add column if not exists opted_out_at timestamptz;

create index if not exists idx_conversations_opted_out
  on public.conversations(practice_id) where opted_out;


-- ════════════════════════════════════════════════════════════════════════
-- >>> migrations/20260529080000_message_scheduling.sql
-- ════════════════════════════════════════════════════════════════════════
-- ============================================================================
-- Message scheduling: per-message day offset so the activation/rescheduled
-- logic and the sender are exact. scheduled_for already exists on messages.
-- Run in the Supabase SQL editor (project eymgqjeudrmeofytnwgs).
-- ============================================================================
alter table public.messages add column if not exists send_day int;

-- Sender lookup: due, not-yet-sent messages.
create index if not exists idx_messages_due on public.messages(status, scheduled_for);


-- ════════════════════════════════════════════════════════════════════════
-- >>> migrations/20260530000000_recording_pipeline_columns.sql
-- ════════════════════════════════════════════════════════════════════════
-- ============================================================================
-- Recording-pipeline columns. Idempotent. THIS FIXES THE FAILING PIPELINE:
-- transcribe-consult writes `transcript_deidentified` and analyze-consult writes
-- `what_happened` / `exit_intent_level`; none of those columns existed, so every
-- save 400'd. Also adds sequence_timing_preset (smart timing) and the Doxy.me key.
--
-- Run in the Supabase SQL editor (project eymgqjeudrmeofytnwgs).
-- ============================================================================

-- consults: analysis output + de-identified transcript.
alter table public.consults add column if not exists transcript_deidentified text;
alter table public.consults add column if not exists what_happened           text;
alter table public.consults add column if not exists objection_type          text;  -- price|fear|spouse|timing|other
alter table public.consults add column if not exists exit_intent_level        text;  -- hot|warm|long_term
alter table public.consults add column if not exists sequence_timing_preset   text;  -- hot|warm|long_term (smart timing)

alter table public.consults drop constraint if exists consults_timing_preset_check;
alter table public.consults add constraint consults_timing_preset_check
  check (sequence_timing_preset is null or sequence_timing_preset in ('hot', 'warm', 'long_term'));

-- consults: treatment-plan value (used by dashboard KPIs, analytics, attribution).
-- Referenced across the frontend (Dashboard, analytics, pms, ConsultDetail) but
-- the column never existed.
alter table public.consults add column if not exists case_value numeric;

-- conversations: list-display columns the Conversations page reads/orders by.
-- Missing columns made `order by last_message_at` fail.
alter table public.conversations add column if not exists last_message_at      timestamptz;
alter table public.conversations add column if not exists unread_count         int not null default 0;
alter table public.conversations add column if not exists last_message_preview text;
create index if not exists idx_conversations_last_message on public.conversations(practice_id, last_message_at desc);

-- practices: Doxy.me API key for the inbound recording webhook (item #10).
alter table public.practices add column if not exists doxyme_api_key text;


-- ════════════════════════════════════════════════════════════════════════
-- >>> migrations/20260530010000_phase3_features.sql
-- ════════════════════════════════════════════════════════════════════════
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
  message_2_email_subject text,
  message_2_email_body    text,
  message_3_sms          text,
  filter_date_min  timestamptz,
  filter_date_max  timestamptz,
  total_recipients int default 0,
  messages_per_day int default 20,
  send_window_start int  not null default 9,
  send_window_end   int  not null default 17,
  send_days         text not null default 'mon_fri',
  status           text not null default 'draft', -- draft | scheduled | active | paused | completed
  scheduled_start  timestamptz,
  started_at       timestamptz,
  completed_at     timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists idx_react_campaigns_practice on public.reactivation_campaigns(practice_id, created_at desc);
-- Self-heal columns on pre-existing tables (create-table-if-not-exists is a no-op then).
alter table public.reactivation_campaigns
  add column if not exists message_2_email_subject text,
  add column if not exists message_2_email_body    text,
  add column if not exists message_3_sms           text,
  add column if not exists send_window_start        int  not null default 9,
  add column if not exists send_window_end          int  not null default 17,
  add column if not exists send_days                text not null default 'mon_fri';
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
  status        text not null default 'pending', -- pending | sending | completed | opted_out | replied
  messages_sent int not null default 0,
  last_sent_at  timestamptz,
  replied_at    timestamptz,
  reply_content text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_react_enroll_campaign on public.reactivation_enrollments(campaign_id);
create index if not exists idx_react_enroll_practice on public.reactivation_enrollments(practice_id, status);
-- A consult can only be enrolled in a given campaign once.
create unique index if not exists uq_reactivation_enrollment_consult
  on public.reactivation_enrollments(campaign_id, consult_id) where consult_id is not null;
alter table public.reactivation_enrollments add column if not exists reply_content text;
alter table public.reactivation_enrollments enable row level security;
drop policy if exists "react_enroll_all_own_practice" on public.reactivation_enrollments;
create policy "react_enroll_all_own_practice" on public.reactivation_enrollments
  for all to authenticated using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());

-- Conversations back-link so reactivation replies surface with a badge.
alter table public.conversations
  add column if not exists reactivation_campaign_id uuid
    references public.reactivation_campaigns(id) on delete set null;

-- Attribution status on consults (reporting): caselift_recovered etc.
alter table public.consults add column if not exists attribution_status text;
alter table public.consults add column if not exists conversion_source  text;
alter table public.consults add column if not exists closed_at          timestamptz;

-- >>> migrations/20260530030000_sequence_status.sql
-- Per-consult sequence run-state (active|paused|cancelled) + auto-pause on reply.
alter table public.consults add column if not exists sequence_status text not null default 'active';
alter table public.consults drop constraint if exists consults_sequence_status_check;
alter table public.consults add constraint consults_sequence_status_check
  check (sequence_status in ('active', 'paused', 'cancelled'));
alter table public.consults add column if not exists sequence_paused_reason text;

update public.consults
   set sequence_status = 'cancelled'
 where sequence_status = 'active'
   and (outcome in ('accepted', 'not_converting', 'closed_won')
        or (sequence_cancelled_at is not null
            and coalesce(sequence_cancelled_reason, '') <> 'Stopped by TC'));
update public.consults
   set sequence_status = 'paused', sequence_paused_reason = 'manual'
 where sequence_status = 'active'
   and sequence_cancelled_at is not null
   and sequence_cancelled_reason = 'Stopped by TC';

create index if not exists idx_consults_sequence_status on public.consults(practice_id, sequence_status);

create or replace function public.auto_pause_sequence_on_reply()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
  cfg jsonb;
  stop_on_reply boolean := true;
begin
  if NEW.direction <> 'inbound' then return NEW; end if;
  select c.consult_id into cid from public.conversations c where c.id = NEW.conversation_id;
  if cid is null then return NEW; end if;
  begin
    select p.sequence_config into cfg
      from public.consults co join public.practices p on p.id = co.practice_id
     where co.id = cid;
    if cfg is not null and jsonb_typeof(cfg) = 'string' then
      cfg := (cfg #>> '{}')::jsonb;
    end if;
    stop_on_reply := coalesce((cfg -> 'rules' ->> 'stopOnReply')::boolean, true);
  exception when others then
    stop_on_reply := true;
  end;
  if not stop_on_reply then return NEW; end if;
  update public.consults
     set sequence_status = 'paused', sequence_paused_reason = 'reply'
   where id = cid and sequence_status <> 'cancelled';
  return NEW;
end $$;
drop trigger if exists trg_auto_pause_on_reply on public.conversation_messages;
create trigger trg_auto_pause_on_reply after insert on public.conversation_messages
  for each row execute function public.auto_pause_sequence_on_reply();


-- ════════════════════════════════════════════════════════════════════════
-- >>> migrations/20260530040000_pms_entities.sql
-- ════════════════════════════════════════════════════════════════════════
-- PMS entity tables populated by the Sikka webhook: patients, providers,
-- transactions. Keyed by (practice_id, external_id) for idempotent upserts.
create table if not exists public.pms_patients (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id) on delete cascade,
  office_id text, external_id text,
  first_name text, last_name text, phone text, email text, date_of_birth date,
  raw jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists uq_pms_patients_practice_extid on public.pms_patients(practice_id, external_id);
create index if not exists idx_pms_patients_practice on public.pms_patients(practice_id);
create index if not exists idx_pms_patients_phone on public.pms_patients(practice_id, phone);

create table if not exists public.pms_providers (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id) on delete cascade,
  office_id text, external_id text,
  name text, first_name text, last_name text, specialty text,
  raw jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists uq_pms_providers_practice_extid on public.pms_providers(practice_id, external_id);
create index if not exists idx_pms_providers_practice on public.pms_providers(practice_id);

create table if not exists public.pms_transactions (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id) on delete cascade,
  office_id text, external_id text, patient_external_id text,
  amount numeric, transaction_date date, transaction_type text, description text,
  raw jsonb, created_at timestamptz not null default now()
);
create unique index if not exists uq_pms_transactions_practice_extid on public.pms_transactions(practice_id, external_id);
create index if not exists idx_pms_transactions_practice on public.pms_transactions(practice_id, transaction_date desc);

do $$
declare t text;
begin
  foreach t in array array['pms_patients','pms_providers','pms_transactions'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "%s_select_own_practice" on public.%I;', t, t);
    execute format($f$
      create policy "%1$s_select_own_practice" on public.%1$I
        for select to authenticated using (practice_id = public.current_practice_id());
    $f$, t);
  end loop;
end $$;


commit;
