-- ============================================================================
-- Admin portal fixes: unified super-admin detection, practice update RLS,
-- and replacement RPCs (legacy functions referenced dropped resellers tables).
-- Idempotent — safe to run via CLI or SQL editor.
-- ============================================================================

-- ── 1) Unified super-admin helper ───────────────────────────────────────────

create or replace function public.super_admin_email()
returns text
language sql
immutable
as $$ select 'devyntgrillo@gmail.com'::text $$;

revoke all on function public.super_admin_email() from public, anon;
grant execute on function public.super_admin_email() to authenticated, service_role;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    lower(coalesce(auth.jwt() ->> 'email', '')) = public.super_admin_email()
    or coalesce(
      (select u.access_level = 'super_admin' from public.users u where u.id = auth.uid()),
      false
    )
$$;

revoke all on function public.is_super_admin() from public, anon;
grant execute on function public.is_super_admin() to authenticated, service_role;

-- Keep DB access_level in sync with the designated email.
update public.users u
   set access_level = 'super_admin'
  from auth.users a
 where a.id = u.id
   and lower(a.email) = public.super_admin_email()
   and coalesce(u.access_level, '') is distinct from 'super_admin';

-- ── 2) Super-admin can update any practice (PMS / billing admin fields) ─────

drop policy if exists "practices_superadmin_update" on public.practices;
create policy "practices_superadmin_update" on public.practices
  for update
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists "practices_superadmin_insert" on public.practices;
create policy "practices_superadmin_insert" on public.practices
  for insert
  with check (public.is_super_admin());

-- Align legacy email-only super-admin read policies with is_super_admin().
drop policy if exists "super_admin can read all" on public.practices;
create policy "super_admin can read all"
  on public.practices for select
  using (public.is_super_admin());

drop policy if exists "super_admin can read all agencies" on public.agency_accounts;
create policy "super_admin can read all agencies"
  on public.agency_accounts for select
  using (public.is_super_admin());

-- ── 3) Training modules — use is_super_admin() instead of hardcoded email ───

drop policy if exists "Users can view published modules" on public.training_modules;
create policy "Users can view published modules"
  on public.training_modules for select
  using (status = 'published' or public.is_super_admin());

drop policy if exists "Super admin can manage modules" on public.training_modules;
create policy "Super admin can manage modules"
  on public.training_modules for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ── 4) Replace stale admin RPCs ─────────────────────────────────────────────

drop function if exists public.admin_agencies();
drop function if exists public.admin_practices();
drop function if exists public.admin_revenue();

create or replace function public.admin_agencies()
returns table (
  id uuid,
  name text,
  owner_email text,
  practices bigint,
  mrr numeric,
  white_labeled boolean,
  active boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.id,
    a.name,
    u.email as owner_email,
    count(p.id)::bigint as practices,
    coalesce(a.monthly_fee, 0) * count(p.id)::numeric as mrr,
    coalesce(a.white_label_enabled, false) as white_labeled,
    coalesce(a.active, (a.status = 'active'), true) as active,
    a.created_at
  from public.agency_accounts a
  left join public.practices p on p.agency_id = a.id
  left join public.users u on u.id = a.owner_user_id
  where public.is_super_admin()
  group by a.id, a.name, u.email, a.monthly_fee, a.white_label_enabled, a.active, a.status, a.created_at
  order by a.created_at asc
$$;

revoke all on function public.admin_agencies() from public, anon;
grant execute on function public.admin_agencies() to authenticated;

create or replace function public.admin_practices()
returns table (
  id uuid,
  name text,
  agency_name text,
  doctor text,
  consults_month bigint,
  subscription_status text
)
language sql
stable
security definer
set search_path = public
as $$
  with month_consults as (
    select practice_id, count(*)::bigint as n
    from public.consults
    where created_at >= (now() - interval '30 days')
    group by practice_id
  )
  select
    p.id,
    p.name,
    ag.name as agency_name,
    coalesce(
      nullif(trim(coalesce(p.doctor_first, '') || ' ' || coalesce(p.doctor_last, '')), ''),
      p.name
    ) as doctor,
    coalesce(mc.n, 0)::bigint as consults_month,
    coalesce(p.subscription_status, 'trial') as subscription_status
  from public.practices p
  left join public.agency_accounts ag on ag.id = p.agency_id
  left join month_consults mc on mc.practice_id = p.id
  where public.is_super_admin()
  order by p.name asc
$$;

revoke all on function public.admin_practices() from public, anon;
grant execute on function public.admin_practices() to authenticated;

create or replace function public.admin_revenue()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  agency_mrr numeric := 0;
  direct_mrr numeric := 0;
  signups int := 0;
  churn int := 0;
  by_agency jsonb := '[]'::jsonb;
begin
  if not public.is_super_admin() then
    return null;
  end if;

  select coalesce(sum(coalesce(a.monthly_fee, 0)), 0)
    into agency_mrr
  from public.agency_accounts a
  join public.practices p on p.agency_id = a.id
  where coalesce(p.subscription_status, 'trial') = 'active';

  select coalesce(count(*) * 997, 0)
    into direct_mrr
  from public.practices p
  where p.agency_id is null
    and coalesce(p.subscription_status, 'trial') = 'active';

  select count(*)::int into signups
  from public.practices
  where created_at >= date_trunc('month', now());

  select count(*)::int into churn
  from public.cancellation_feedback
  where created_at >= date_trunc('month', now());

  select coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'mrr', t.mrr) order by t.name), '[]'::jsonb)
    into by_agency
  from (
    select a.name, sum(coalesce(a.monthly_fee, 0))::numeric as mrr
    from public.agency_accounts a
    join public.practices p on p.agency_id = a.id
    where coalesce(p.subscription_status, 'trial') = 'active'
    group by a.id, a.name
  ) t;

  return jsonb_build_object(
    'total_mrr', agency_mrr + direct_mrr,
    'new_signups_month', signups,
    'churn_month', churn,
    'by_agency', by_agency
  );
end;
$$;

revoke all on function public.admin_revenue() from public, anon;
grant execute on function public.admin_revenue() to authenticated;
