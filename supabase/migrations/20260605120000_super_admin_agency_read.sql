-- Reseller impersonation: let the platform super-admin (matched by JWT email,
-- same pattern as the existing practices/agency_accounts read-all policies) SELECT
-- the agency-scoped tables the reseller dashboard reads, for ANY agency — so a
-- super-admin "viewing as" a reseller sees their team, invites, and analytics.
-- practices + agency_accounts read-all already exist (20260603130000).

drop policy if exists "super_admin reads agency_members" on public.agency_members;
create policy "super_admin reads agency_members" on public.agency_members
  for select using ((auth.jwt() ->> 'email') = 'devyntgrillo@gmail.com');

drop policy if exists "super_admin reads invitations" on public.invitations;
create policy "super_admin reads invitations" on public.invitations
  for select using ((auth.jwt() ->> 'email') = 'devyntgrillo@gmail.com');

-- Analytics page reads consults across the agency's practices.
drop policy if exists "super_admin reads consults" on public.consults;
create policy "super_admin reads consults" on public.consults
  for select using ((auth.jwt() ->> 'email') = 'devyntgrillo@gmail.com');
