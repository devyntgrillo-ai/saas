-- ============================================================================
-- TRAINING MODULE GROUPS — editable, ordered "module" tabs for the course.
--
-- Lessons (training_modules.module_group) reference a group by its stable `key`
-- (e.g. 'Module 1: Foundation'). The display `name` is editable in the Super
-- Admin Training tab, so renaming a tab ('Mindset & Foundation') is a one-row
-- update here and never has to touch the lessons. Practices read these to render
-- the horizontal module tabs; only the super admin can edit them.
--
-- Run in the Supabase SQL editor (project eymgqjeudrmeofytnwgs) if not applied
-- via the CLI. Safe to run repeatedly.
-- ============================================================================

create table if not exists public.training_module_groups (
  id          uuid primary key default gen_random_uuid(),
  key         text unique not null,   -- stable id stored on training_modules.module_group
  name        text not null,          -- editable display label (the tab title)
  order_index int not null default 0,
  created_at  timestamptz default now()
);

alter table public.training_module_groups enable row level security;

drop policy if exists "tmg_select" on public.training_module_groups;
create policy "tmg_select" on public.training_module_groups
  for select using (auth.role() = 'authenticated');

drop policy if exists "tmg_manage" on public.training_module_groups;
create policy "tmg_manage" on public.training_module_groups
  for all
  using (auth.jwt() ->> 'email' = 'devyntgrillo@gmail.com')
  with check (auth.jwt() ->> 'email' = 'devyntgrillo@gmail.com');

-- Seed the four course modules with their tab names. on conflict do nothing so
-- re-running never clobbers a renamed tab.
insert into public.training_module_groups (key, name, order_index) values
  ('Module 1: Foundation', 'Mindset & Foundation', 1),
  ('Module 2: The Consult', 'The Consult',          2),
  ('Module 3: The Close',   'The Close',             3),
  ('Module 4: Objections',  'Objection Handling',    4)
on conflict (key) do nothing;
