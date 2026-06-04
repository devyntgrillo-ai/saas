-- ============================================================================
-- Fix agency table RLS: replace permissive USING(true) policies with proper
-- tenant isolation.
--
-- agency_accounts  — scoped to agency members + practice's agency + super_admin
-- agency_members   — scoped to same-agency members + self + super_admin
-- invitations      — scoped to agency/practice members + super_admin
--
-- Helper functions use SECURITY DEFINER to avoid recursive RLS evaluation
-- in policy subqueries.
-- ============================================================================

-- ── Helpers ──────────────────────────────────────────────────────────────────

create or replace function public.get_my_agency_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(agency_id), '{}'::uuid[])
  from public.agency_members
  where user_id = auth.uid()
$$;

revoke all on function public.get_my_agency_ids() from public, anon;
grant execute on function public.get_my_agency_ids() to authenticated;

-- Drop the existing modify policy that depends on is_agency_admin, so we can
-- recreate the function with matching param names.
drop policy if exists "agency_members_modify" on public.agency_members;

-- DROP first because existing function uses param name "p_agency" and
-- CREATE OR REPLACE does not allow renaming parameters.
drop function if exists public.is_agency_admin(uuid);

create function public.is_agency_admin(p_agency uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.agency_members
    where user_id = auth.uid()
      and agency_id = p_agency
      and role in ('owner', 'admin')
  )
$$;

revoke all on function public.is_agency_admin(uuid) from public, anon;
grant execute on function public.is_agency_admin(uuid) to authenticated, service_role;

-- Drop redundant policies (superadmin variants are now folded into the main ones).
drop policy if exists "agency_accounts_superadmin_select" on public.agency_accounts;
drop policy if exists "agency_members_superadmin_select"  on public.agency_members;
drop policy if exists "invitations_update"                on public.invitations;

-- ── 1) agency_accounts ───────────────────────────────────────────────────────

drop policy if exists "agency_accounts_select" on public.agency_accounts;
create policy "agency_accounts_select" on public.agency_accounts
  for select using (
    id = any (public.get_my_agency_ids())
    or id = (select agency_id from public.practices where id = public.current_practice_id() limit 1)
    or public.is_super_admin()
  );

drop policy if exists "agency_accounts_insert" on public.agency_accounts;
create policy "agency_accounts_insert" on public.agency_accounts
  for insert to authenticated
  with check (true);

drop policy if exists "agency_accounts_update" on public.agency_accounts;
create policy "agency_accounts_update" on public.agency_accounts
  for update using (
    public.is_agency_admin(id)
    or public.is_super_admin()
  );

-- ── 2) agency_members ────────────────────────────────────────────────────────

drop policy if exists "agency_members_select" on public.agency_members;
create policy "agency_members_select" on public.agency_members
  for select using (
    user_id = auth.uid()
    or agency_id = any (public.get_my_agency_ids())
    or public.is_super_admin()
  );

drop policy if exists "agency_members_insert" on public.agency_members;
create policy "agency_members_insert" on public.agency_members
  for insert to authenticated
  with check (false);

drop policy if exists "agency_members_delete" on public.agency_members;
create policy "agency_members_delete" on public.agency_members
  for delete using (
    public.is_agency_admin(agency_id)
    or public.is_super_admin()
  );

-- ── 3) invitations ───────────────────────────────────────────────────────────

drop policy if exists "invitations_select" on public.invitations;
create policy "invitations_select" on public.invitations
  for select using (
    agency_id = any (public.get_my_agency_ids())
    or practice_id = public.current_practice_id()
    or public.is_super_admin()
  );

drop policy if exists "invitations_insert" on public.invitations;
create policy "invitations_insert" on public.invitations
  for insert to authenticated
  with check (
    (
      agency_id = any (public.get_my_agency_ids())
      and public.is_agency_admin(agency_id)
    )
    or practice_id = public.current_practice_id()
    or public.is_super_admin()
  );

drop policy if exists "invitations_delete" on public.invitations;
create policy "invitations_delete" on public.invitations
  for delete using (
    agency_id = any (public.get_my_agency_ids())
    or practice_id = public.current_practice_id()
    or public.is_super_admin()
  );
