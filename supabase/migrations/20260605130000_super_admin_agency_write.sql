-- Reseller impersonation write-through: let the platform super-admin (matched by
-- JWT email) EDIT the reseller they're impersonating — settings/branding on the
-- agency, archive/restore of sub-accounts, and logo/favicon uploads.

-- Agency (reseller) settings + white-label branding.
drop policy if exists "super_admin updates agency_accounts" on public.agency_accounts;
create policy "super_admin updates agency_accounts" on public.agency_accounts
  for update
  using ((auth.jwt() ->> 'email') = 'devyntgrillo@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'devyntgrillo@gmail.com');

-- Sub-account archive/restore (and any practice edits) from the reseller view.
drop policy if exists "super_admin updates practices" on public.practices;
create policy "super_admin updates practices" on public.practices
  for update
  using ((auth.jwt() ->> 'email') = 'devyntgrillo@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'devyntgrillo@gmail.com');

-- Logo / favicon uploads to the white-label asset bucket.
drop policy if exists "super_admin writes reseller-assets" on storage.objects;
create policy "super_admin writes reseller-assets" on storage.objects
  for all
  using (bucket_id = 'reseller-assets' and (auth.jwt() ->> 'email') = 'devyntgrillo@gmail.com')
  with check (bucket_id = 'reseller-assets' and (auth.jwt() ->> 'email') = 'devyntgrillo@gmail.com');
