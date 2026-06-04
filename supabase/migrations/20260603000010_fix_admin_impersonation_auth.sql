-- ============================================================================
-- Fix Items 7-11 from the security audit: Admin RLS, impersonation auth,
-- data-loader limits, reseller-assets write scoping, and referral anon access.
-- ============================================================================

-- ── Item 7+8: prácticas RLS — super-admin sees all; agency sees their own ────
drop policy if exists "practices_superadmin_select" on public.practices;
create policy "practices_superadmin_select" on public.practices
  for select
  using (public.is_super_admin());

drop policy if exists "practices_agency_select" on public.practices;
create policy "practices_agency_select" on public.practices
  for select
  using (agency_id = any (public.get_my_agency_ids()));

-- users: super-admin can list all users (admin portal user lookup).
drop policy if exists "users_superadmin_select" on public.users;
create policy "users_superadmin_select" on public.users
  for select
  using (public.is_super_admin());

-- consults: super-admin sees all (admin overview + impersonated dashboard).
drop policy if exists "consults_superadmin_all" on public.consults;
create policy "consults_superadmin_all" on public.consults
  for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- messages: super-admin sees all (impersonated dashboard).
drop policy if exists "messages_superadmin_all" on public.messages;
create policy "messages_superadmin_all" on public.messages
  for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- conversations: super-admin sees all (impersonated dashboard).
drop policy if exists "conversations_superadmin_all" on public.conversations;
create policy "conversations_superadmin_all" on public.conversations
  for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- cancellation_feedback: super-admin sees all (admin cancellations list).
drop policy if exists "cancel_fb_superadmin_select" on public.cancellation_feedback;
create policy "cancel_fb_superadmin_select" on public.cancellation_feedback
  for select
  using (public.is_super_admin());

-- ── Item 10: reseller-assets storage — write scoped to caller's agency ───────
-- Files are keyed <agency_id>/<kind>.<ext>; only members of that agency may
-- upload/update/delete their own agency's assets.

drop policy if exists "reseller_assets_insert" on storage.objects;
create policy "reseller_assets_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'reseller-assets'
    and exists (
      select 1 from public.agency_members
      where user_id = auth.uid()
        and name like (agency_id::text || '/%')
    )
  );

drop policy if exists "reseller_assets_update" on storage.objects;
create policy "reseller_assets_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'reseller-assets'
    and exists (
      select 1 from public.agency_members
      where user_id = auth.uid()
        and name like (agency_id::text || '/%')
    )
  )
  with check (
    bucket_id = 'reseller-assets'
    and exists (
      select 1 from public.agency_members
      where user_id = auth.uid()
        and name like (agency_id::text || '/%')
    )
  );

drop policy if exists "reseller_assets_delete" on storage.objects;
create policy "reseller_assets_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'reseller-assets'
    and exists (
      select 1 from public.agency_members
      where user_id = auth.uid()
        and name like (agency_id::text || '/%')
    )
  );

-- ── Item 11: revoke resolve_referral_code from anon ──────────────────────────
-- Prevents practice enumeration via brute-force. The signup flow already
-- stamps referred_by_code on the practice row; the resolved practice_id bonus
-- now requires the caller to be authenticated (after sign-in).
revoke execute on function public.resolve_referral_code(text) from anon;
