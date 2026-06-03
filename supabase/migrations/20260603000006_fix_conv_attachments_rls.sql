-- ============================================================================
-- Fix conversation-attachments bucket: add practice_id scoping on mutate ops.
--
-- This bucket MUST remain publicly readable because attachment URLs are
-- embedded in messages sent to patients via SMS/email (unauthenticated users
-- need to load them).
--
-- INSERT/UPDATE/DELETE are now scoped so that a user can only manage files
-- in conversations that belong to their practice.
--
-- Path format: <conversation_id>/<timestamp>.<ext>
-- Ownership is resolved by joining conversations.practice_id.
-- ============================================================================

-- ── INSERT: only into conversations owned by the caller's practice ───────────

drop policy if exists "conv_attach_insert" on storage.objects;
create policy "conv_attach_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'conversation-attachments'
    and exists (
      select 1 from public.conversations c
      where c.id::text = (storage.foldername(name))[1]
        and c.practice_id = public.current_practice_id()
    )
  );

-- ── UPDATE: only files in conversations owned by the caller's practice ───────

drop policy if exists "conv_attach_update" on storage.objects;
create policy "conv_attach_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'conversation-attachments'
    and exists (
      select 1 from public.conversations c
      where c.id::text = (storage.foldername(name))[1]
        and c.practice_id = public.current_practice_id()
    )
  )
  with check (bucket_id = 'conversation-attachments');

-- ── DELETE: only files in conversations owned by the caller's practice ───────

drop policy if exists "conv_attach_delete" on storage.objects;
create policy "conv_attach_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'conversation-attachments'
    and exists (
      select 1 from public.conversations c
      where c.id::text = (storage.foldername(name))[1]
        and c.practice_id = public.current_practice_id()
    )
  );

-- SELECT remains public (required for patient-facing SMS/email attachment URLs).
