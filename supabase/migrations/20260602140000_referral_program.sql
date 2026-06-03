-- ============================================================================
-- REFERRAL PROGRAM
-- Direct (non-reseller) practices can refer other practices and earn
-- $250/month per active referral. Reseller-onboarded practices (agency_id set)
-- do not participate - their referrals flow through the reseller.
--
-- Adds referral columns to practices, a referral_payouts ledger, RLS, and a set
-- of SECURITY DEFINER helpers so the app can:
--   - generate a unique referral code for the current practice
--   - resolve a referral code to a referrer (used on signup, pre-auth)
--   - list a practice's own referrals (RLS would otherwise hide other practices)
--   - power the super-admin referral panel
-- Idempotent; safe to re-run.
-- ============================================================================

-- ── practices: referral columns ────────────────────────────────────────────
alter table public.practices
  add column if not exists referral_code           text,
  add column if not exists referred_by_code        text,
  add column if not exists referred_by_practice_id uuid references public.practices(id) on delete set null;

-- Case-insensitive uniqueness for referral codes (NULLs allowed/repeatable).
create unique index if not exists idx_practices_referral_code_uniq
  on public.practices (lower(referral_code));
create index if not exists idx_practices_referred_by
  on public.practices (referred_by_practice_id);

-- ── referral_payouts: one row per (referrer, referred, month) ───────────────
create table if not exists public.referral_payouts (
  id                    uuid primary key default gen_random_uuid(),
  referring_practice_id uuid not null references public.practices(id) on delete cascade,
  referred_practice_id  uuid not null references public.practices(id) on delete cascade,
  month                 date not null,                 -- first day of the covered month
  amount                numeric(10,2) not null default 250,
  status                text not null default 'pending', -- pending | paid | cancelled
  paid_at               timestamptz,
  created_at            timestamptz not null default now(),
  unique (referring_practice_id, referred_practice_id, month)
);
create index if not exists idx_referral_payouts_referrer on public.referral_payouts(referring_practice_id);
create index if not exists idx_referral_payouts_month    on public.referral_payouts(month);
create index if not exists idx_referral_payouts_status   on public.referral_payouts(status);

-- ── helper: is the caller a super-admin? ────────────────────────────────────
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select access_level = 'super_admin' from public.users where id = auth.uid()),
    false
  )
$$;
revoke all on function public.is_super_admin() from public, anon;
grant execute on function public.is_super_admin() to authenticated, service_role;

-- ── RLS: a practice sees only its own payouts; super-admin sees all ─────────
alter table public.referral_payouts enable row level security;

drop policy if exists "referral_payouts_select" on public.referral_payouts;
create policy "referral_payouts_select" on public.referral_payouts
  for select using (
    referring_practice_id = public.current_practice_id()
    or public.is_super_admin()
  );

-- Inserts/updates are performed by the service role (cron) and SECURITY DEFINER
-- RPCs, both of which bypass RLS; no anon/authenticated write policy is granted.

-- ============================================================================
-- ensure_referral_code()
-- Assigns a unique referral code to the current practice on first use and
-- returns it. Derived from the practice name, cleaned to uppercase alphanumerics
-- with no separators (e.g. "Gold Dental" → "GOLDDENTAL"). On collision, a 4-digit
-- numeric suffix is appended.
-- ============================================================================
create or replace function public.ensure_referral_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  pid       uuid := public.current_practice_id();
  existing  text;
  nm        text;
  base      text;
  candidate text;
  tries     int := 0;
begin
  if pid is null then return null; end if;

  select referral_code, name into existing, nm from public.practices where id = pid;
  if existing is not null and length(existing) > 0 then return existing; end if;

  -- Strip everything but letters/digits, uppercase. "Gold Dental" → "GOLDDENTAL".
  base := upper(regexp_replace(coalesce(nm, ''), '[^a-zA-Z0-9]', '', 'g'));
  if length(base) < 3 then base := 'CASE'; end if;
  base := left(base, 16);

  -- Prefer the clean name as-is; only add a numeric suffix if it's taken.
  candidate := base;
  while exists (select 1 from public.practices where lower(referral_code) = lower(candidate)) loop
    tries := tries + 1;
    candidate := left(base, 12) || lpad((floor(random() * 9000) + 1000)::int::text, 4, '0');
    if tries > 50 then
      candidate := left(base || replace(gen_random_uuid()::text, '-', ''), 16);
      exit;
    end if;
  end loop;

  update public.practices set referral_code = candidate where id = pid and referral_code is null;
  select referral_code into candidate from public.practices where id = pid;
  return candidate;
end $$;
revoke all on function public.ensure_referral_code() from public, anon;
grant execute on function public.ensure_referral_code() to authenticated;

-- ============================================================================
-- resolve_referral_code(code)
-- Pre-auth lookup used by the signup flow: maps a referral code to its referrer
-- (id + name) without exposing the practices table. Callable by anon.
-- ============================================================================
create or replace function public.resolve_referral_code(p_code text)
returns table(practice_id uuid, practice_name text)
language sql
stable
security definer
set search_path = public
as $$
  select id, name
  from public.practices
  where referral_code is not null
    and lower(referral_code) = lower(trim(p_code))
  limit 1
$$;
revoke all on function public.resolve_referral_code(text) from public;
grant execute on function public.resolve_referral_code(text) to anon, authenticated;

-- ============================================================================
-- my_referrals()
-- The practices the current practice has referred (RLS hides them otherwise).
-- Returns just enough to render the referral-history table.
-- ============================================================================
create or replace function public.my_referrals()
returns table(
  referred_practice_id uuid,
  practice_name        text,
  joined               timestamptz,
  subscription_status  text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.name, p.created_at, coalesce(p.subscription_status, 'trial')
  from public.practices p
  where p.referred_by_practice_id = public.current_practice_id()
  order by p.created_at desc
$$;
revoke all on function public.my_referrals() from public, anon;
grant execute on function public.my_referrals() to authenticated;

-- ============================================================================
-- admin_referrals()
-- Super-admin view of every referral relationship. Returns no rows for anyone
-- who isn't a super-admin.
-- ============================================================================
create or replace function public.admin_referrals()
returns table(
  referred_practice_id    uuid,
  referred_practice_name  text,
  referring_practice_id   uuid,
  referring_practice_name text,
  since                   timestamptz,
  subscription_status     text,
  earning                 boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select red.id, red.name,
         ring.id, ring.name,
         red.created_at,
         coalesce(red.subscription_status, 'trial'),
         coalesce(red.subscription_status, 'trial') = 'active'
  from public.practices red
  join public.practices ring on ring.id = red.referred_by_practice_id
  where public.is_super_admin()
  order by red.created_at desc
$$;
revoke all on function public.admin_referrals() from public, anon;
grant execute on function public.admin_referrals() to authenticated;

-- ============================================================================
-- admin_referral_payouts(status)
-- Super-admin payout ledger, optionally filtered by status, with both practice
-- names joined for display + CSV export.
-- ============================================================================
create or replace function public.admin_referral_payouts(p_status text default null)
returns table(
  id                      uuid,
  referring_practice_id   uuid,
  referring_practice_name text,
  referred_practice_id    uuid,
  referred_practice_name  text,
  month                   date,
  amount                  numeric,
  status                  text,
  paid_at                 timestamptz,
  created_at              timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select pay.id,
         pay.referring_practice_id, ring.name,
         pay.referred_practice_id,  red.name,
         pay.month, pay.amount, pay.status, pay.paid_at, pay.created_at
  from public.referral_payouts pay
  join public.practices ring on ring.id = pay.referring_practice_id
  join public.practices red  on red.id  = pay.referred_practice_id
  where public.is_super_admin()
    and (p_status is null or pay.status = p_status)
  order by pay.month desc, ring.name
$$;
revoke all on function public.admin_referral_payouts(text) from public, anon;
grant execute on function public.admin_referral_payouts(text) to authenticated;

-- ============================================================================
-- admin_mark_payout_paid(payout_id)
-- Super-admin action: mark a pending payout as paid.
-- ============================================================================
create or replace function public.admin_mark_payout_paid(p_payout_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'not authorized';
  end if;
  update public.referral_payouts
    set status = 'paid', paid_at = now()
    where id = p_payout_id and status = 'pending';
end $$;
revoke all on function public.admin_mark_payout_paid(uuid) from public, anon;
grant execute on function public.admin_mark_payout_paid(uuid) to authenticated;
