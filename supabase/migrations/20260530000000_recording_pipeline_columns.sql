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
