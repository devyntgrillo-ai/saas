-- ============================================================================
-- Reactivation campaigns: targeted drip outreach to patients with accepted
-- treatment plans who never scheduled. Two tables (campaigns + per-patient
-- enrollments), RLS scoped to the practice, plus a conversations back-link so
-- reactivation replies surface with a badge. Run in the Supabase SQL editor
-- (project eymgqjeudrmeofytnwgs).
-- ============================================================================

-- ---- campaigns -------------------------------------------------------------
create table if not exists public.reactivation_campaigns (
  id                    uuid primary key default gen_random_uuid(),
  practice_id           uuid not null references public.practices(id) on delete cascade,
  campaign_name         text not null,
  angle_type            text not null,                 -- price_lock | check_in | new_option

  -- Ordered message steps. The drip walks the non-empty slots in this canonical
  -- order: sms1, email1, sms2, (email2), (sms3). The 3 built-in angles fill the
  -- first three (SMS 1, Email 1, SMS 2); the rest are optional spares.
  message_1_sms           text,
  message_1_email_subject text,
  message_1_email_body    text,
  message_2_sms           text,
  message_2_email_subject text,
  message_2_email_body    text,
  message_3_sms           text,

  -- Audience window: consult-date boundaries (min = most recent allowed,
  -- max = oldest allowed). Never blast patients newer than ~2 weeks.
  filter_date_min       timestamptz,
  filter_date_max       timestamptz,

  total_recipients      int not null default 0,
  messages_per_day      int not null default 20,
  send_window_start     int not null default 9,        -- hour, 24h
  send_window_end       int not null default 17,        -- hour, 24h
  send_days             text not null default 'mon_fri', -- mon_fri | mon_sat

  status                text not null default 'draft',  -- draft | scheduled | active | paused | completed
  scheduled_start       timestamptz,
  started_at            timestamptz,
  completed_at          timestamptz,
  created_at            timestamptz not null default now()
);
create index if not exists idx_reactivation_campaigns_practice
  on public.reactivation_campaigns(practice_id, status);

-- ---- enrollments -----------------------------------------------------------
create table if not exists public.reactivation_enrollments (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references public.reactivation_campaigns(id) on delete cascade,
  practice_id   uuid not null references public.practices(id) on delete cascade,
  consult_id    uuid references public.consults(id) on delete set null,
  patient_first text,
  patient_last  text,
  patient_phone text,
  patient_email text,
  status        text not null default 'pending',        -- pending | sending | completed | opted_out | replied
  messages_sent int not null default 0,
  last_sent_at  timestamptz,
  replied_at    timestamptz,
  reply_content text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_reactivation_enrollments_campaign
  on public.reactivation_enrollments(campaign_id, status);
create index if not exists idx_reactivation_enrollments_practice
  on public.reactivation_enrollments(practice_id);

-- ---- self-heal: patch columns the earlier phase3_features.sql variant of these
-- tables (same migration timestamp, runs first) created without. `create table
-- if not exists` above is a no-op when that ran, so add the deltas explicitly.
alter table public.reactivation_campaigns
  add column if not exists message_2_email_subject text,
  add column if not exists message_2_email_body    text,
  add column if not exists message_3_sms           text,
  add column if not exists send_window_start        int  not null default 9,
  add column if not exists send_window_end          int  not null default 17,
  add column if not exists send_days                text not null default 'mon_fri';
alter table public.reactivation_enrollments
  add column if not exists reply_content text;

-- A consult can only be enrolled in a given campaign once.
create unique index if not exists uq_reactivation_enrollment_consult
  on public.reactivation_enrollments(campaign_id, consult_id)
  where consult_id is not null;

-- ---- conversations back-link (badge + reporting) ---------------------------
alter table public.conversations
  add column if not exists reactivation_campaign_id uuid
    references public.reactivation_campaigns(id) on delete set null;

-- ---- RLS -------------------------------------------------------------------
alter table public.reactivation_campaigns   enable row level security;
alter table public.reactivation_enrollments enable row level security;

do $$
declare t text;
begin
  foreach t in array array['reactivation_campaigns','reactivation_enrollments'] loop
    execute format('drop policy if exists "%s_all" on public.%I;', t, t);
    execute format($f$
      create policy "%1$s_all" on public.%1$I
        for all
        using (practice_id = public.current_practice_id())
        with check (practice_id = public.current_practice_id());
    $f$, t);
  end loop;
end $$;
