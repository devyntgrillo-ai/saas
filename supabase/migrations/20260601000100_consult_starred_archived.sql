-- ============================================================================
-- Conversation triage flags on consults. Idempotent.
--   starred  - TC pinned this patient/conversation; sorts to the top of the list.
--   archived - hidden from the active conversation list (record is preserved).
-- Run in the Supabase SQL editor (project eymgqjeudrmeofytnwgs).
-- ============================================================================
alter table public.consults add column if not exists starred  boolean not null default false;
alter table public.consults add column if not exists archived boolean not null default false;

create index if not exists idx_consults_archived on public.consults(practice_id, archived);
create index if not exists idx_consults_starred  on public.consults(practice_id, starred);
