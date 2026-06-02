-- ============================================================================
-- Conversation messages: structured `meta` (used by the call/voice render) and
-- a `call_log_id` link so call entries in the thread can play their recording.
-- Idempotent. Run in the Supabase SQL editor (project eymgqjeudrmeofytnwgs).
-- ============================================================================
alter table public.conversation_messages add column if not exists meta jsonb;
alter table public.conversation_messages
  add column if not exists call_log_id uuid references public.call_logs(id) on delete set null;
