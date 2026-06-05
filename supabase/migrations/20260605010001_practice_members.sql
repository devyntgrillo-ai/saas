-- ============================================================================
-- PRACTICE MEMBERS — multi-location access. A single user (e.g. a dentist who
-- owns several offices) can belong to multiple practices and switch between them.
--
-- users.practice_id remains the user's "home" practice; practice_members lists
-- every practice they can access. user_practice_ids() unions the two, and a
-- members-read policy on practices lets the account switcher load them.
--
-- Run in the Supabase SQL editor (project eymgqjeudrmeofytnwgs) if not applied
-- via the CLI. Safe to run repeatedly.
-- ============================================================================

create table if not exists public.practice_members (
  id          uuid default gen_random_uuid() primary key,
  practice_id uuid references public.practices(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete cascade,
  role        text default 'member',
  created_at  timestamptz default now(),
  unique (practice_id, user_id)
);
create index if not exists practice_members_user_idx on public.practice_members (user_id);

alter table public.practice_members enable row level security;

-- A user reads their own memberships; super admin reads all. Inserts come from
-- the invite / signup edge functions (service role) which bypass RLS.
drop policy if exists "pm_self_select" on public.practice_members;
create policy "pm_self_select" on public.practice_members
  for select using (user_id = auth.uid() or auth.jwt() ->> 'email' = 'devyntgrillo@gmail.com');

drop policy if exists "pm_admin" on public.practice_members;
create policy "pm_admin" on public.practice_members
  for all
  using (auth.jwt() ->> 'email' = 'devyntgrillo@gmail.com')
  with check (auth.jwt() ->> 'email' = 'devyntgrillo@gmail.com');

-- Backfill: every existing user's home practice becomes a membership row so the
-- switcher is consistent from day one.
insert into public.practice_members (practice_id, user_id, role)
select u.practice_id, u.id, coalesce(u.role, 'member')
from public.users u
where u.practice_id is not null
on conflict (practice_id, user_id) do nothing;

-- Practice ids the current user can access (memberships ∪ home practice).
create or replace function public.user_practice_ids()
returns setof uuid
language sql stable security definer set search_path = public as $$
  select practice_id from public.practice_members where user_id = auth.uid()
  union
  select practice_id from public.users where id = auth.uid() and practice_id is not null
$$;
grant execute on function public.user_practice_ids() to authenticated;

-- Additive (permissive) policy so a user can read any practice they're a member
-- of — drives the account switcher's "My Practices" list + switched-practice load.
drop policy if exists "practices_member_select" on public.practices;
create policy "practices_member_select" on public.practices
  for select using (id in (select public.user_practice_ids()));

-- Additive read policies so a user can VIEW data for any practice they belong to
-- (multi-location switching). Permissive — only widens SELECT, never writes.
drop policy if exists "consults_member_select" on public.consults;
create policy "consults_member_select" on public.consults
  for select using (practice_id in (select public.user_practice_ids()));

drop policy if exists "messages_member_select" on public.messages;
create policy "messages_member_select" on public.messages
  for select using (practice_id in (select public.user_practice_ids()));

drop policy if exists "conversations_member_select" on public.conversations;
create policy "conversations_member_select" on public.conversations
  for select using (practice_id in (select public.user_practice_ids()));

drop policy if exists "conversation_messages_member_select" on public.conversation_messages;
create policy "conversation_messages_member_select" on public.conversation_messages
  for select using (
    conversation_id in (select id from public.conversations where practice_id in (select public.user_practice_ids()))
  );
