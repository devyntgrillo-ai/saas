-- ============================================================================
-- Fix: signup blocked by "infinite recursion detected in policy for relation
-- practices" (SQLSTATE 42P17).
--
-- The practices_insert policy's WITH CHECK contained a rate-limit subquery that
-- SELECTs from public.practices — a policy on a table that queries the same
-- table makes Postgres flag the RLS as recursive, so every new practice INSERT
-- (the /signup → createAccount step) failed with 42P17.
--
-- Replace it with a non-recursive check. The anti-spam cap is better enforced
-- by a trigger if needed (no RLS recursion); functionality (signup) comes first.
-- Idempotent — safe to run via CLI or the SQL editor.
-- ============================================================================

drop policy if exists "practices_insert" on public.practices;
create policy "practices_insert" on public.practices
  for insert to authenticated
  with check (auth.uid() is not null);
