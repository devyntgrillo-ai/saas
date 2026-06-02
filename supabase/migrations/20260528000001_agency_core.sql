-- ============================================================================
-- Agency / reseller core tables (live DB had these ad-hoc; not in schema.sql).
-- Required for AuthContext agency queries and admin/agency portals.
-- ============================================================================

create table if not exists public.agency_accounts (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  owner_name      text,
  owner_email     text,
  owner_user_id   uuid references auth.users(id) on delete set null,
  monthly_fee     numeric default 500,
  active          boolean not null default true,
  status          text default 'active',
  admin_notes     text,
  created_at      timestamptz not null default now()
);

create table if not exists public.agency_members (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  agency_id                uuid not null references public.agency_accounts(id) on delete cascade,
  role                     text not null default 'owner',
  accessible_practice_ids  uuid[],
  created_at               timestamptz not null default now(),
  unique (user_id, agency_id)
);

create index if not exists idx_agency_members_user on public.agency_members(user_id);
create index if not exists idx_agency_members_agency on public.agency_members(agency_id);

create table if not exists public.invitations (
  id                       uuid primary key default gen_random_uuid(),
  email                    text not null,
  role                     text not null,
  access_level             text,
  agency_id                uuid references public.agency_accounts(id) on delete cascade,
  practice_id              uuid references public.practices(id) on delete cascade,
  accessible_practice_ids  uuid[],
  personal_message         text,
  invited_by_user_id       uuid references auth.users(id) on delete set null,
  token                    text not null unique default encode(gen_random_bytes(16), 'hex'),
  accepted_at              timestamptz,
  expires_at               timestamptz not null default (now() + interval '7 days'),
  created_at               timestamptz not null default now()
);

create index if not exists idx_invitations_email on public.invitations(email);
create index if not exists idx_invitations_token on public.invitations(token);

alter table public.practices
  add column if not exists agency_id uuid references public.agency_accounts(id) on delete set null,
  add column if not exists baa_accepted_at timestamptz,
  add column if not exists location text;

alter table public.users
  add column if not exists access_level text;

create index if not exists idx_practices_agency on public.practices(agency_id);

-- RLS (permissive for authenticated; matches typical multi-tenant pattern)
alter table public.agency_accounts enable row level security;
alter table public.agency_members enable row level security;
alter table public.invitations enable row level security;

drop policy if exists "agency_accounts_select" on public.agency_accounts;
create policy "agency_accounts_select" on public.agency_accounts
  for select to authenticated using (true);

drop policy if exists "agency_accounts_insert" on public.agency_accounts;
create policy "agency_accounts_insert" on public.agency_accounts
  for insert to authenticated with check (true);

drop policy if exists "agency_accounts_update" on public.agency_accounts;
create policy "agency_accounts_update" on public.agency_accounts
  for update to authenticated using (true);

drop policy if exists "agency_members_select" on public.agency_members;
create policy "agency_members_select" on public.agency_members
  for select to authenticated using (user_id = auth.uid() or true);

drop policy if exists "agency_members_insert" on public.agency_members;
create policy "agency_members_insert" on public.agency_members
  for insert to authenticated with check (true);

drop policy if exists "agency_members_delete" on public.agency_members;
create policy "agency_members_delete" on public.agency_members
  for delete to authenticated using (true);

drop policy if exists "invitations_select" on public.invitations;
create policy "invitations_select" on public.invitations
  for select to authenticated using (true);

drop policy if exists "invitations_insert" on public.invitations;
create policy "invitations_insert" on public.invitations
  for insert to authenticated with check (true);

drop policy if exists "invitations_delete" on public.invitations;
create policy "invitations_delete" on public.invitations
  for delete to authenticated using (true);

-- Invitation RPCs used by AcceptInvitation.jsx
create or replace function public.get_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
begin
  select i.*,
         a.name as agency_name,
         p.name as practice_name,
         u.email as inviter_email
    into inv
    from public.invitations i
    left join public.agency_accounts a on a.id = i.agency_id
    left join public.practices p on p.id = i.practice_id
    left join public.users u on u.id = i.invited_by_user_id
   where i.token = p_token
   limit 1;

  if inv is null then
    return null;
  end if;

  return jsonb_build_object(
    'email', inv.email,
    'role', inv.role,
    'access_level', inv.access_level,
    'agency_name', inv.agency_name,
    'practice_name', inv.practice_name,
    'inviter_email', inv.inviter_email,
    'personal_message', inv.personal_message,
    'accepted_at', inv.accepted_at,
    'expires_at', inv.expires_at
  );
end;
$$;

create or replace function public.accept_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.invitations%rowtype;
  uid uuid := auth.uid();
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'Not authenticated');
  end if;

  select * into inv from public.invitations where token = p_token for update;
  if inv is null then
    return jsonb_build_object('ok', false, 'error', 'Invitation not found');
  end if;
  if inv.accepted_at is not null or inv.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'Invitation expired');
  end if;

  update public.invitations set accepted_at = now() where id = inv.id;

  if inv.agency_id is not null then
    insert into public.agency_members (user_id, agency_id, role, accessible_practice_ids)
    values (uid, inv.agency_id, coalesce(inv.role, 'member'), inv.accessible_practice_ids)
    on conflict (user_id, agency_id) do update
      set role = excluded.role,
          accessible_practice_ids = excluded.accessible_practice_ids;
  end if;

  if inv.practice_id is not null then
    update public.users set practice_id = inv.practice_id where id = uid;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.get_invitation(text) to anon, authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
