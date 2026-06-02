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
