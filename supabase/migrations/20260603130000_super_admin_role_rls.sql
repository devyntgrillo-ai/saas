-- Role-based impersonation: super-admin grant + read-all RLS.
--
-- NOTE ON THE "role" COLUMN: the app's role system already lives in
-- public.users.access_level ('super_admin' | 'agency_owner' | 'agency_admin' |
-- 'practice_owner' | 'practice_member' | 'practice_viewer'). That IS the role
-- column the spec refers to; adding a separate profiles.role would duplicate and
-- desync it, so we use access_level here. (public.users.role already exists and
-- means the practice-level seat: owner/member/viewer.)

-- 1) Flag the designated platform super-admin by email.
update public.users u
   set access_level = 'super_admin'
  from auth.users a
 where a.id = u.id
   and lower(a.email) = 'devyntgrillo@gmail.com';

-- 2) RLS: super-admin (matched on JWT email, independent of any column) can
--    SELECT every practice, so the account switcher can list all accounts.
--    Added as its own SELECT policy; Postgres ORs it with existing policies.
drop policy if exists "super_admin can read all" on public.practices;
create policy "super_admin can read all"
  on public.practices
  for select
  using ( (auth.jwt() ->> 'email') = 'devyntgrillo@gmail.com' );

-- 3) Same for resellers (agencies), so the super-admin switcher can list every
--    reseller and jump into its admin view.
drop policy if exists "super_admin can read all agencies" on public.agency_accounts;
create policy "super_admin can read all agencies"
  on public.agency_accounts
  for select
  using ( (auth.jwt() ->> 'email') = 'devyntgrillo@gmail.com' );
