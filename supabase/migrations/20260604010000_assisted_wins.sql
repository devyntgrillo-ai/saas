-- ============================================================================
-- ASSISTED WINS — tracks treatment plans closed with CaseLift follow-up help.
--
-- A row is recorded by the record-win edge function only when a consult is
-- marked won/accepted AND at least one sequence message was actually sent for
-- it (assisted close). consult_id is unique so a consult can only be counted
-- once. Practices see their own wins; the super admin sees all.
--
-- Run in the Supabase SQL editor (project eymgqjeudrmeofytnwgs) if not applied
-- via the CLI. Safe to run repeatedly.
-- ============================================================================

create table if not exists public.assisted_wins (
  id                    uuid default gen_random_uuid() primary key,
  practice_id           uuid references public.practices(id) on delete set null,
  consult_id            uuid references public.consults(id) on delete set null,
  patient_name          text,
  patient_id            text,
  treatment_type        text,
  case_value            numeric,
  messages_sent         integer,
  first_message_sent_at timestamptz,
  won_at                timestamptz default now(),
  won_by                text,           -- 'pms_webhook' | 'manual'
  created_at            timestamptz default now()
);

-- One win per consult (dedupe re-fires from PMS + manual).
create unique index if not exists assisted_wins_consult_uniq
  on public.assisted_wins (consult_id) where consult_id is not null;
create index if not exists assisted_wins_practice_idx on public.assisted_wins (practice_id);
create index if not exists assisted_wins_won_at_idx   on public.assisted_wins (won_at);

alter table public.assisted_wins enable row level security;

-- A practice reads its own wins; the super admin reads all. Inserts come from
-- the record-win edge function (service role) which bypasses RLS.
drop policy if exists "assisted_wins_select" on public.assisted_wins;
create policy "assisted_wins_select" on public.assisted_wins
  for select using (
    practice_id = public.current_practice_id()
    or auth.jwt() ->> 'email' = 'devyntgrillo@gmail.com'
  );

drop policy if exists "assisted_wins_admin" on public.assisted_wins;
create policy "assisted_wins_admin" on public.assisted_wins
  for all
  using (auth.jwt() ->> 'email' = 'devyntgrillo@gmail.com')
  with check (auth.jwt() ->> 'email' = 'devyntgrillo@gmail.com');
