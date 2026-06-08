-- User profile: an editable display name + avatar that show throughout the app
-- (sidebar, team list, chat sender/presence) instead of the raw email.

alter table public.users add column if not exists display_name text;
alter table public.users add column if not exists avatar_url   text;

-- Safe self-service update: a user can set ONLY their own display name + avatar
-- (can't touch role/practice_id). SECURITY DEFINER so no broad UPDATE policy on
-- public.users is needed.
create or replace function public.update_my_profile(p_display_name text, p_avatar_url text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.users
     set display_name = nullif(btrim(coalesce(p_display_name, '')), ''),
         avatar_url   = nullif(btrim(coalesce(p_avatar_url, '')), '')
   where id = auth.uid();
end $$;
grant execute on function public.update_my_profile(text, text) to authenticated;

-- Public bucket for avatars (served via public URL).
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- A user manages only their own avatar folder (<uid>/…); anyone can read.
drop policy if exists avatars_insert on storage.objects;
create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_update on storage.objects;
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects for select to public
  using (bucket_id = 'avatars');
