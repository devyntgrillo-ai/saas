-- ============================================================================
-- Message scheduling: per-message day offset so the activation/rescheduled
-- logic and the sender are exact. scheduled_for already exists on messages.
-- Run in the Supabase SQL editor (project eymgqjeudrmeofytnwgs).
-- ============================================================================
alter table public.messages add column if not exists send_day int;

-- Sender lookup: due, not-yet-sent messages.
create index if not exists idx_messages_due on public.messages(status, scheduled_for);
