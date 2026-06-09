-- ============================================================================
-- Make attachment buckets PRIVATE (HIPAA: PHI must not be served over an
-- unauthenticated public CDN URL).
--
-- conversation-attachments — MMS/email attachments (patient photos, docs)
-- chat-attachments         — support-chat file uploads
--
-- The app now stores the bare object PATH and reads via short-lived signed URLs
-- (src/lib/storage.js, src/hooks/useAttachmentUrl.js). Outbound MMS hands Twilio
-- a signed URL. Legacy rows that stored a full public URL still resolve, because
-- the client extracts the path and re-signs it.
--
-- ORDER OF OPERATIONS: deploy the app code FIRST, then run this. Signed URLs
-- work on public buckets too, so there is no break window — this only removes
-- the unauthenticated public-CDN fallback.
--
-- The SELECT policies on storage.objects are tightened to `authenticated` (a
-- signed URL is itself the capability; this removes anonymous object reads).
-- Idempotent. Safe to run in the SQL editor (project eymgqjeudrmeofytnwgs).
-- ============================================================================

update storage.buckets set public = false where id in ('conversation-attachments', 'chat-attachments');

-- conversation-attachments: authenticated read only (was: to public)
drop policy if exists "conv_attach_read" on storage.objects;
create policy "conv_attach_read" on storage.objects
  for select to authenticated using (bucket_id = 'conversation-attachments');

-- chat-attachments: authenticated read only (was: to public)
drop policy if exists chat_attach_read on storage.objects;
create policy chat_attach_read on storage.objects
  for select to authenticated using (bucket_id = 'chat-attachments');
