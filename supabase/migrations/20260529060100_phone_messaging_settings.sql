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
