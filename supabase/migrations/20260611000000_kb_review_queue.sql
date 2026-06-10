-- ============================================================================
-- Knowledge Base review queue.
--
-- analyze-consult now extracts durable, practice-level facts from each recorded
-- consult and files them as PENDING entries. A human approves or dismisses them
-- in Settings → Knowledge Base before the AI ever uses them.
--
--   source  : 'manual' (hand-entered) | 'consult' (auto-learned)
--   status  : 'approved' (usable by the AI) | 'pending' (awaiting review)
--
-- Existing rows + manual entries default to source='manual', status='approved'.
-- Pending auto-learned rows are inserted is_active=false so the AI-context read
-- (which requires is_active AND status='approved') never sees them until approved.
-- Idempotent.
-- ============================================================================

alter table public.practice_knowledge_base add column if not exists source text not null default 'manual';
alter table public.practice_knowledge_base add column if not exists status text not null default 'approved';
alter table public.practice_knowledge_base add column if not exists source_consult_id uuid references public.consults(id) on delete set null;

create index if not exists idx_pkb_practice_status on public.practice_knowledge_base(practice_id, status);
