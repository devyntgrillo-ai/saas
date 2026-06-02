-- ============================================================================
-- storage_consult_recordings.sql
-- Ensures the "consult-recordings" storage bucket exists and that authenticated
-- users can upload/read their practice's recordings. The browser uploads the
-- audio BEFORE analyze-consult runs, so this must exist for recording to work.
--
-- Run in the Supabase SQL editor (project eymgqjeudrmeofytnwgs). Idempotent.
-- (Could not be run from the agent session - no DB connection available.)
-- ============================================================================

-- 1) Create the (private) bucket if missing.
insert into storage.buckets (id, name, public)
values ('consult-recordings', 'consult-recordings', false)
on conflict (id) do nothing;

-- 2) Policies on storage.objects scoped to this bucket.
--    Frontend uploads to `<practice_id>/<consult_id>.<ext>` with the user JWT;
--    the edge function reads/deletes with the service role (bypasses RLS).
--    For dev this allows any authenticated user; tighten later by checking the
--    first path segment against the caller's practice_id if desired.

drop policy if exists "consult_recordings_insert" on storage.objects;
create policy "consult_recordings_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'consult-recordings');

drop policy if exists "consult_recordings_select" on storage.objects;
create policy "consult_recordings_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'consult-recordings');

drop policy if exists "consult_recordings_update" on storage.objects;
create policy "consult_recordings_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'consult-recordings')
  with check (bucket_id = 'consult-recordings');

drop policy if exists "consult_recordings_delete" on storage.objects;
create policy "consult_recordings_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'consult-recordings');
