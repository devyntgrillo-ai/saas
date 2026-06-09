-- ============================================================================
-- RLS hardening (security audit follow-up, 2026-06-09)
--
-- Two safe, behavior-preserving fixes from the full RLS audit:
--   1. agency_accounts INSERT was WITH CHECK (true) — any authenticated user
--      could create a reseller row. Gate it to the platform super-admin.
--   2. Several admin policies hardcoded the literal super-admin email instead
--      of the canonical is_platform_super_admin() helper. Functionally the same
--      today, but if the owner email ever changes the literals silently lock the
--      owner out (or, worse, leave a stale address authorized). Standardize them
--      all on the helper (email + users.access_level, SECURITY DEFINER).
--
-- NOT addressed here (requires app-code changes, see audit notes):
--   - conversation-attachments / chat-attachments are PUBLIC storage buckets
--     (served via the public CDN regardless of RLS). Locking them down means
--     flipping the buckets to private + switching the app to signed URLs.
--
-- Idempotent. Safe to run in the SQL editor (project eymgqjeudrmeofytnwgs).
-- ============================================================================

-- ── 1) agency_accounts: only the platform super-admin may create resellers ──
drop policy if exists "agency_accounts_insert" on public.agency_accounts;
create policy "agency_accounts_insert" on public.agency_accounts
  for insert to authenticated
  with check (public.is_platform_super_admin());

-- ── 2) Standardize hardcoded-email admin policies on the helper ─────────────

-- assisted_wins: practice-scoped read + super-admin everything
drop policy if exists "assisted_wins_select" on public.assisted_wins;
create policy "assisted_wins_select" on public.assisted_wins
  for select using (
    practice_id = public.current_practice_id()
    or public.is_platform_super_admin()
  );

drop policy if exists "assisted_wins_admin" on public.assisted_wins;
create policy "assisted_wins_admin" on public.assisted_wins
  for all
  using (public.is_platform_super_admin())
  with check (public.is_platform_super_admin());

-- practice_members: self-read + super-admin manage
drop policy if exists "pm_self_select" on public.practice_members;
create policy "pm_self_select" on public.practice_members
  for select using (
    user_id = auth.uid()
    or public.is_platform_super_admin()
  );

drop policy if exists "pm_admin" on public.practice_members;
create policy "pm_admin" on public.practice_members
  for all
  using (public.is_platform_super_admin())
  with check (public.is_platform_super_admin());

-- training_module_groups: super-admin manage (read stays open to authenticated)
drop policy if exists "tmg_manage" on public.training_module_groups;
create policy "tmg_manage" on public.training_module_groups
  for all
  using (public.is_platform_super_admin())
  with check (public.is_platform_super_admin());

-- training_push_log: super-admin only
drop policy if exists "Super admin manage push log" on public.training_push_log;
create policy "Super admin manage push log" on public.training_push_log
  for all
  using (public.is_platform_super_admin())
  with check (public.is_platform_super_admin());
