-- ============================================================================
-- Signup offers — super-admin-generated special-pricing / free-trial links.
--
-- A code maps to an arbitrary monthly price (+ optional free-trial days). Shared
-- as get.caselift.io/signup?offer=<code>. The code is the server-trusted source
-- of price/trial (the URL is never trusted), so a tampered ?plan= can't change
-- what's charged. Default standard pricing ($997, no offer) is unchanged.
-- Idempotent.
-- ============================================================================
create table if not exists public.signup_offers (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,
  label       text,                              -- who/what this link is for
  price       numeric(10,2) not null,            -- monthly $ (arbitrary)
  trial_days  integer not null default 0,        -- 0 = charge now; N = free trial, then bill
  max_uses    integer,                           -- null = unlimited
  uses        integer not null default 0,
  active      boolean not null default true,
  expires_at  timestamptz,                       -- null = never
  created_by  uuid,
  created_at  timestamptz not null default now()
);

create index if not exists idx_signup_offers_code on public.signup_offers(code);

alter table public.signup_offers enable row level security;

-- Super-admins manage offers; nobody else can read the table directly.
drop policy if exists "signup_offers_admin_all" on public.signup_offers;
create policy "signup_offers_admin_all" on public.signup_offers
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- Anon-callable resolver for the signup page (pre-auth): returns only safe
-- display fields + a validity flag. Never exposes usage internals or lets the
-- caller enumerate the table.
create or replace function public.resolve_signup_offer(p_code text)
returns table (code text, label text, price numeric, trial_days integer, valid boolean)
language sql
security definer
set search_path = public
as $$
  select o.code, o.label, o.price, o.trial_days,
         (o.active
           and (o.expires_at is null or o.expires_at > now())
           and (o.max_uses is null or o.uses < o.max_uses)) as valid
  from public.signup_offers o
  where o.code = p_code
  limit 1;
$$;

revoke all on function public.resolve_signup_offer(text) from public;
grant execute on function public.resolve_signup_offer(text) to anon, authenticated;

-- Atomic redemption counter, called server-side (edge function) after a signup
-- successfully uses an offer.
create or replace function public.increment_signup_offer_use(p_code text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.signup_offers set uses = uses + 1 where code = p_code;
$$;

revoke all on function public.increment_signup_offer_use(text) from public, anon;
grant execute on function public.increment_signup_offer_use(text) to service_role;
