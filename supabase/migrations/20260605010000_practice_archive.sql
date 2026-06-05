-- ============================================================================
-- Soft-delete (archive/restore) for subaccounts (practices). Idempotent.
-- Run in the Supabase SQL editor (project eymgqjeudrmeofytnwgs).
--
-- archived_at NULL  = active (shown in list views)
-- archived_at set   = archived (hidden from lists, restorable)
-- ============================================================================
alter table public.practices add column if not exists archived_at timestamptz;
alter table public.practices add column if not exists archived_by uuid references auth.users(id) on delete set null;

create index if not exists idx_practices_archived_at on public.practices(archived_at);

-- Allow archiving/restoring from the Super Admin and Reseller views: the
-- practice's own members keep update access; super-admins and the practice's
-- agency owner/admin can now update it too (to set/clear archived_at).
drop policy if exists "practices_update" on public.practices;
create policy "practices_update" on public.practices
  for update using (
    id = public.current_practice_id()
    or public.is_super_admin()
    or (agency_id is not null and public.is_agency_admin(agency_id))
  );
