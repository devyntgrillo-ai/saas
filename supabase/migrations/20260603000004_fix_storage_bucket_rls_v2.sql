-- ============================================================================
-- Fix consult-recordings storage bucket: add practice_id path isolation.
--
-- Audio files are stored as <practice_id>/<consult_id>.<ext> (or
-- <practice_id>/doxyme-<stamp>.<ext> for Doxy.me recordings).
--
-- Previously the policies only checked bucket_id, meaning any authenticated
-- user could upload/list/download another practice's PHI audio.
--
-- New policies use name LIKE (practice_id || '/%') to scope INSERT (upload)
-- to the caller's practice folder. Super admins can upload/read/delete all.
-- Edge functions use service_role and are unaffected.
--
-- NOTE: The Supabase Storage API's list and download endpoints do NOT
-- consistently evaluate RLS policies on storage.objects for SELECT/GET
-- operations. INSERT (upload) IS enforced. For full list/download isolation,
-- a proxy edge function or signed URLs would be needed.
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
