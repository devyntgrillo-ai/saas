-- Chat attachments: a message can carry one uploaded file (image preview or a
-- downloadable file chip), Slack-style.
alter table public.support_messages add column if not exists attachment_url  text;
alter table public.support_messages add column if not exists attachment_name text;
alter table public.support_messages add column if not exists attachment_type text;

-- Public bucket for chat attachments (served via public URL; access to the file
-- list is still gated by the message rows' RLS).
insert into storage.buckets (id, name, public) values ('chat-attachments', 'chat-attachments', true)
on conflict (id) do nothing;

drop policy if exists chat_attach_insert on storage.objects;
create policy chat_attach_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-attachments');

drop policy if exists chat_attach_read on storage.objects;
create policy chat_attach_read on storage.objects for select to public
  using (bucket_id = 'chat-attachments');
