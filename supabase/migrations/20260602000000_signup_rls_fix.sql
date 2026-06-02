-- Signup flow fixes for local (and cloud) dev:
-- 1) Practice INSERT must be allowed for any signed-in user creating their tenant.
-- 2) INSERT ... RETURNING (Supabase .insert().select()) needs a SELECT policy that
--    works before users.practice_id is set — otherwise signup fails with 42501.

drop policy if exists "practices_insert" on public.practices;
create policy "practices_insert" on public.practices
  for insert
  with check (auth.uid() is not null);

drop policy if exists "practices_select" on public.practices;
create policy "practices_select" on public.practices
  for select using (
    id = public.current_practice_id()
    or (public.current_practice_id() is null and auth.uid() is not null)
  );

drop policy if exists "users_update_self" on public.users;
create policy "users_update_self" on public.users
  for update using (id = auth.uid())
  with check (id = auth.uid());
