-- Drive super-admin RLS off public.users.access_level = 'super_admin' instead of
-- a hardcoded email. The email-based policies broke reseller impersonation when
-- the super-admin logs in with any other address: agency_accounts reads returned
-- null, so the app fell back to the viewer's own agency (wrong reseller's data).

-- Reusable predicate. SECURITY DEFINER so it reads users.access_level reliably
-- regardless of RLS on users; STABLE for planner caching. Keeps the canonical
-- email as a belt-and-suspenders fallback so the platform owner is never locked
-- out if their access_level is ever unset.
create or replace function public.is_platform_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.access_level = 'super_admin'
  ) or coalesce((auth.jwt() ->> 'email') = 'devyntgrillo@gmail.com', false);
$$;

grant execute on function public.is_platform_super_admin() to authenticated;

-- Re-create every super-admin policy to use the predicate.
drop policy if exists "super_admin can read all" on public.practices;
create policy "super_admin can read all" on public.practices
  for select using (public.is_platform_super_admin());

drop policy if exists "super_admin can read all agencies" on public.agency_accounts;
create policy "super_admin can read all agencies" on public.agency_accounts
  for select using (public.is_platform_super_admin());

drop policy if exists "super_admin reads agency_members" on public.agency_members;
create policy "super_admin reads agency_members" on public.agency_members
  for select using (public.is_platform_super_admin());

drop policy if exists "super_admin reads invitations" on public.invitations;
create policy "super_admin reads invitations" on public.invitations
  for select using (public.is_platform_super_admin());

drop policy if exists "super_admin reads consults" on public.consults;
create policy "super_admin reads consults" on public.consults
  for select using (public.is_platform_super_admin());

drop policy if exists "super_admin updates agency_accounts" on public.agency_accounts;
create policy "super_admin updates agency_accounts" on public.agency_accounts
  for update using (public.is_platform_super_admin()) with check (public.is_platform_super_admin());

drop policy if exists "super_admin updates practices" on public.practices;
create policy "super_admin updates practices" on public.practices
  for update using (public.is_platform_super_admin()) with check (public.is_platform_super_admin());

drop policy if exists "super_admin writes reseller-assets" on storage.objects;
create policy "super_admin writes reseller-assets" on storage.objects
  for all
  using (bucket_id = 'reseller-assets' and public.is_platform_super_admin())
  with check (bucket_id = 'reseller-assets' and public.is_platform_super_admin());
