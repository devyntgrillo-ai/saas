-- ============================================================================
-- Launchpad onboarding checklist.
--
-- Tracks per-practice setup progress shown in the new "Launchpad" tab. Steps are
-- mostly auto-completed by inspecting existing data when the Launchpad loads
-- (see src/lib/launchpad.js); a few are checked off when the user performs the
-- action (e.g. sending an invite). Completion is persisted here so progress is
-- durable, and `practices.launchpad_completed_at` flips the tab off for good.
-- Idempotent: safe to re-run.
-- ============================================================================

alter table public.practices add column if not exists launchpad_completed_at timestamptz;
alter table public.practices add column if not exists launchpad_dismissed_at timestamptz;
-- Captured on the streamlined Welcome step (1-2 / 3-5 / 6-10 / 10+).
alter table public.practices add column if not exists consults_per_week text;

create table if not exists public.practice_launchpad_steps (
  id           uuid primary key default gen_random_uuid(),
  practice_id  uuid not null references public.practices(id) on delete cascade,
  step_key     text not null,
  completed_at timestamptz not null default now(),
  unique (practice_id, step_key)
);

create index if not exists idx_pls_practice on public.practice_launchpad_steps(practice_id);

alter table public.practice_launchpad_steps enable row level security;

drop policy if exists pls_select on public.practice_launchpad_steps;
create policy pls_select on public.practice_launchpad_steps for select to authenticated
  using (practice_id = public.current_practice_id() or public.is_platform_admin());

drop policy if exists pls_write on public.practice_launchpad_steps;
create policy pls_write on public.practice_launchpad_steps for all to authenticated
  using (practice_id = public.current_practice_id() or public.is_platform_admin())
  with check (practice_id = public.current_practice_id() or public.is_platform_admin());
