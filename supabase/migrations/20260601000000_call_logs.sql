-- ============================================================================
-- Power Dialer: in-app Twilio voice calls + recordings. `call_logs` is the
-- source of truth for each placed call (sid, status, duration, recording URL).
-- The TwiML webhook inserts a row keyed by the Twilio CallSid; the recording
-- callback fills in the recording; the dialer UI sets disposition/notes.
-- Idempotent. Run in the Supabase SQL editor (project eymgqjeudrmeofytnwgs).
-- ============================================================================

-- Caller ID for outbound calls (also used by SMS). The voice TwiML falls back to
-- TWILIO_CALLER_ID when a practice has no number of its own.
alter table public.practices add column if not exists twilio_phone_number text;

create table if not exists public.call_logs (
  id                 uuid primary key default gen_random_uuid(),
  practice_id        uuid not null references public.practices(id) on delete cascade,
  consult_id         uuid references public.consults(id) on delete set null,
  conversation_id    uuid references public.conversations(id) on delete set null,
  user_id            uuid,
  twilio_call_sid    text unique,
  direction          text not null default 'outbound',
  to_number          text,
  from_number        text,
  status             text not null default 'initiated', -- initiated | in_progress | completed | failed | no_answer
  disposition        text,
  notes              text,
  duration_seconds   int,
  recording_url      text,
  recording_sid      text,
  recording_duration int,
  started_at         timestamptz,
  ended_at           timestamptz,
  created_at         timestamptz not null default now()
);
create index if not exists idx_call_logs_practice on public.call_logs(practice_id, created_at desc);
create index if not exists idx_call_logs_consult  on public.call_logs(consult_id);

alter table public.call_logs enable row level security;
-- Practice members read their own call logs; the webhooks write via service role.
drop policy if exists "call_logs_select_own_practice" on public.call_logs;
create policy "call_logs_select_own_practice" on public.call_logs
  for select to authenticated using (practice_id = public.current_practice_id());
-- Authenticated TCs may set disposition/notes on their practice's calls.
drop policy if exists "call_logs_update_own_practice" on public.call_logs;
create policy "call_logs_update_own_practice" on public.call_logs
  for update to authenticated using (practice_id = public.current_practice_id());
