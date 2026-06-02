-- ============================================================================
-- CONVERSATIONS PAGE ACTIONS. Idempotent.
--
-- Supports the Conversations header/thread actions:
--   • consults.starred  - star a conversation (sorts to top), persists on refresh
--   • consults.archived - archive a conversation (Archived filter tab)
--   • conversation_messages.meta (jsonb) - holds call-event details
--     (direction/outcome/duration/actor) and attachment details
--     (url/name/type) for call + attachment bubbles in the thread.
--
-- Read/unread state reuses the existing conversations.unread_count column.
--
-- Also creates the public "conversation-attachments" storage bucket for MMS /
-- email attachments uploaded from the composer.
--
-- Run in the Supabase SQL editor (project eymgqjeudrmeofytnwgs) if not applied
-- via the CLI. Safe to run repeatedly.
-- ============================================================================

alter table public.consults add column if not exists starred boolean not null default false;
alter table public.consults add column if not exists archived boolean not null default false;

alter table public.conversation_messages add column if not exists meta jsonb not null default '{}'::jsonb;

-- Public bucket so attachment links load without a signed URL.
insert into storage.buckets (id, name, public)
values ('conversation-attachments', 'conversation-attachments', true)
on conflict (id) do update set public = true;

drop policy if exists "conv_attach_insert" on storage.objects;
create policy "conv_attach_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'conversation-attachments');

drop policy if exists "conv_attach_update" on storage.objects;
create policy "conv_attach_update" on storage.objects
  for update to authenticated using (bucket_id = 'conversation-attachments') with check (bucket_id = 'conversation-attachments');

drop policy if exists "conv_attach_delete" on storage.objects;
create policy "conv_attach_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'conversation-attachments');

drop policy if exists "conv_attach_read" on storage.objects;
create policy "conv_attach_read" on storage.objects
  for select to public using (bucket_id = 'conversation-attachments');
