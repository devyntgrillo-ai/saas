-- ============================================================================
-- Audit-log archival (HIPAA 6-year retention — 45 CFR 164.316(b)(2)(i)).
--
-- Supabase does not guarantee 6-year row retention natively, so we:
--   1. Keep an append-only archive table (audit_logs_archive).
--   2. Run a monthly pg_cron job that COPIES audit_logs rows older than 6 years
--      into the archive and FLAGS the source (archived_at) — it never deletes,
--      preserving the append-only integrity of audit_logs.
--   3. Require a documented MANUAL annual export of the archive to long-term
--      storage (S3 / Google Drive). See supabase/HIPAA_AUDIT_RETENTION.md.
--
-- The archive holds historical PHI-access records, so it carries the same RLS
-- as audit_logs (own-practice + super-admin SELECT) and is append-only.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- Flag column on the source so a row is only archived once.
alter table public.audit_logs add column if not exists archived_at timestamptz;
create index if not exists idx_audit_logs_archived on public.audit_logs(archived_at) where archived_at is null;

-- Archive mirrors audit_logs exactly (columns, defaults, PK, indexes), including
-- the archived_at column added above. INCLUDING ALL copies the PK on id so the
-- "already archived?" check below is fast and de-duped.
create table if not exists public.audit_logs_archive (like public.audit_logs including all);

alter table public.audit_logs_archive enable row level security;

drop policy if exists "audit_archive_select_own_practice" on public.audit_logs_archive;
create policy "audit_archive_select_own_practice" on public.audit_logs_archive
  for select to authenticated
  using (practice_id = public.current_practice_id());

drop policy if exists "audit_archive_select_super_admin" on public.audit_logs_archive;
create policy "audit_archive_select_super_admin" on public.audit_logs_archive
  for select to authenticated
  using (public.is_super_admin());
-- No INSERT/UPDATE/DELETE policies (append-only; writes via the function below).

-- Copy + flag rows older than the retention window. Returns the number archived.
create or replace function public.archive_old_audit_logs(p_older_than interval default interval '6 years')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  -- Flag the source first so the copy carries the same archived_at timestamp.
  update public.audit_logs
     set archived_at = now()
   where created_at < now() - p_older_than
     and archived_at is null;

  insert into public.audit_logs_archive
  select a.*
  from public.audit_logs a
  where a.archived_at is not null
    and not exists (select 1 from public.audit_logs_archive z where z.id = a.id);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.archive_old_audit_logs(interval) from public, anon;
grant execute on function public.archive_old_audit_logs(interval) to service_role;

-- Monthly cron: 03:00 UTC on the 1st. Pure SQL (no service key needed).
create extension if not exists pg_cron;
do $$ begin perform cron.unschedule('archive-audit-logs'); exception when others then null; end $$;
select cron.schedule('archive-audit-logs', '0 3 1 * *', $$select public.archive_old_audit_logs()$$);
