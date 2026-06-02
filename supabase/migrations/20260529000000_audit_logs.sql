-- ============================================================================
-- audit_logs - HIPAA access trail. Idempotent: safe to run whether the table
-- is missing or already exists with a different column shape.
--
-- The frontend (src/pages/AuditLog.jsx) reads: id, created_at, user_email,
-- action, resource_type, resource_id. The log_audit_event() RPC and
-- logImpersonation() write here. This ensures all read columns exist + RLS.
--
-- Run in the Supabase SQL editor (project eymgqjeudrmeofytnwgs).
-- (Could not run from the agent session - no DB connection available.)
-- ============================================================================

create table if not exists public.audit_logs (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  practice_id  uuid references public.practices(id) on delete cascade,
  user_id      uuid,
  user_email   text,
  action       text,
  resource_type text,
  resource_id  text,
  ip_address   text
);

-- Backfill columns if an older audit_logs table predates this migration.
alter table public.audit_logs add column if not exists practice_id  uuid;
alter table public.audit_logs add column if not exists user_id      uuid;
alter table public.audit_logs add column if not exists user_email   text;
alter table public.audit_logs add column if not exists action       text;
alter table public.audit_logs add column if not exists resource_type text;
alter table public.audit_logs add column if not exists resource_id  text;
alter table public.audit_logs add column if not exists ip_address   text;

create index if not exists idx_audit_logs_practice on public.audit_logs(practice_id);
create index if not exists idx_audit_logs_created  on public.audit_logs(created_at desc);

-- RLS: an authenticated user may read only their own practice's audit logs.
alter table public.audit_logs enable row level security;

drop policy if exists "audit_logs_select_own_practice" on public.audit_logs;
create policy "audit_logs_select_own_practice" on public.audit_logs
  for select to authenticated
  using (practice_id = public.current_practice_id());

-- Inserts are performed by the SECURITY DEFINER log_audit_event() function and
-- service-role calls, so no authenticated INSERT policy is granted here.
