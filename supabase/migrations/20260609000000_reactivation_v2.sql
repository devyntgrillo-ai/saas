-- Reactivation v2: redesigned one-off blast — a fixed 3-message drip
-- (SMS Day 1, SMS Day 4, Email Day 10), PMS-style "treatment plan presented
-- between" date filter + treatment-type multi-select, per-message status
-- tracking, manual "reopened" marking, and per-patient notes.
--
-- Extends the existing reactivation_campaigns / reactivation_enrollments tables
-- (reused by the process-reactivation-drip sender) rather than adding parallel
-- tables. New columns are additive + nullable/defaulted, so existing rows and
-- the current sender keep working.

alter table public.reactivation_campaigns
  add column if not exists tx_date_start        date,
  add column if not exists tx_date_end          date,
  add column if not exists treatment_types      text[],
  -- Message 3 is an email in the new design (existing schema only had msg_3 SMS).
  add column if not exists message_3_email_subject text,
  add column if not exists message_3_email_body    text,
  -- Results-tab rollups (kept in sync by the sender / UI actions).
  add column if not exists replies_count        int not null default 0,
  add column if not exists cases_reopened       int not null default 0,
  add column if not exists recovered_estimate   numeric not null default 0,
  add column if not exists launched_at          timestamptz;

-- Per-patient, per-message tracking for the campaign detail view.
alter table public.reactivation_enrollments
  add column if not exists treatment_type text,
  add column if not exists tx_plan_date   date,
  add column if not exists msg_1_status   text not null default 'pending',  -- pending|sent|failed|replied|skipped
  add column if not exists msg_1_sent_at  timestamptz,
  add column if not exists msg_2_status   text not null default 'pending',
  add column if not exists msg_2_sent_at  timestamptz,
  add column if not exists msg_3_status   text not null default 'pending',
  add column if not exists msg_3_sent_at  timestamptz,
  add column if not exists reopened       boolean not null default false,
  add column if not exists reopened_at    timestamptz,
  add column if not exists notes          text;
