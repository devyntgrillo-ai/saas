-- ============================================================================
-- Fix consult-recordings storage bucket: add practice_id path isolation.
--
-- Audio files are stored as <practice_id>/<consult_id>.<ext> (or
-- <practice_id>/doxyme-<stamp>.<ext> for Doxy.me recordings).
--
-- Previously the policies only checked bucket_id, meaning any authenticated
-- user could read/list/delete another practice's PHI audio.
--
-- New policies use name LIKE (practice_id || '/%') to scope access to the
-- caller's practice folder. Super admins see all. This pattern is compatible
-- with both PostgreSQL RLS enforcement and the Supabase Storage Go service's
-- policy evaluator.
--
-- Edge functions (transcribe-consult, doxyme-webhook) use the service_role
-- key and are unaffected by RLS changes.
-- ============================================================================

-- ── consult-recordings: SELECT ───────────────────────────────────────────────

drop policy if exists "consult_recordings_select" on storage.objects;
create policy "consult_recordings_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'consult-recordings'
    and (
      name like (public.current_practice_id()::text || '/%')
      or public.is_super_admin()
    )
  );

-- ── consult-recordings: INSERT ───────────────────────────────────────────────

drop policy if exists "consult_recordings_insert" on storage.objects;
create policy "consult_recordings_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'consult-recordings'
    and name like (public.current_practice_id()::text || '/%')
  );

-- ── consult-recordings: DELETE ───────────────────────────────────────────────

drop policy if exists "consult_recordings_delete" on storage.objects;
create policy "consult_recordings_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'consult-recordings'
    and (
      name like (public.current_practice_id()::text || '/%')
      or public.is_super_admin()
    )
  );
