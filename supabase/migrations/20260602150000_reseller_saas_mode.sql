-- ============================================================================
-- RESELLER SAAS MODE. Idempotent.
--
-- Layers a GoHighLevel-style "SaaS configurator" onto the reseller record:
-- resellers set their own client price (>= $397), optionally offer a trial and
-- annual pricing, and onboard clients through a white-labeled signup page at
-- /signup/<reseller_slug>. Hope AI bills each reseller $297/month per active
-- subaccount via Chargebee (see the bill-resellers edge function).
--
-- Columns added to agency_accounts (the resellers table):
--   • reseller_client_price   - $/month the reseller charges each client (>= 397)
--   • reseller_trial_days     - trial length for the reseller's clients (0-30)
--   • reseller_trial_enabled  - whether the reseller offers a free trial
--   • reseller_annual_enabled - whether the reseller offers annual (10% off) pricing
--   • reseller_slug           - unique URL slug for /signup/<slug>
--   • chargebee_customer_id   - the reseller's own Chargebee customer (we bill them)
--
-- Columns added to practices (client subaccounts):
--   • trial_started_at        - when the client's trial began
--   (trial_ends_at already exists from the billing-columns migration)
--
-- Also extends get_branding() so the pre-auth signup page can resolve a reseller
-- brand by reseller_slug (in addition to the existing id / custom-domain paths).
--
-- Run in the Supabase SQL editor (project eymgqjeudrmeofytnwgs) if not applied
-- via the CLI. Safe to run repeatedly.
-- ============================================================================

-- 1) Reseller SaaS configuration on the reseller record.
alter table public.agency_accounts add column if not exists reseller_client_price   numeric(10,2);
alter table public.agency_accounts add column if not exists reseller_trial_days     int     not null default 0;
alter table public.agency_accounts add column if not exists reseller_trial_enabled  boolean not null default false;
alter table public.agency_accounts add column if not exists reseller_annual_enabled boolean not null default false;
alter table public.agency_accounts add column if not exists reseller_slug           text;
alter table public.agency_accounts add column if not exists chargebee_customer_id   text;
-- Per-reseller wholesale override; defaults to the standard $297 we charge per
-- active subaccount. Editable by super-admins in /admin/resellers.
alter table public.agency_accounts add column if not exists reseller_wholesale_price numeric(10,2) not null default 297;

-- Minimum price guard: clients must be charged at least $397/month so the
-- reseller always clears at least $100 over our $297 wholesale. NULL is allowed
-- (reseller hasn't configured SaaS mode yet). Added defensively (drop+add).
alter table public.agency_accounts drop constraint if exists reseller_client_price_min;
alter table public.agency_accounts
  add constraint reseller_client_price_min
  check (reseller_client_price is null or reseller_client_price >= 397);

-- Trial length sanity (0-30 days), matching the configurator UI.
alter table public.agency_accounts drop constraint if exists reseller_trial_days_range;
alter table public.agency_accounts
  add constraint reseller_trial_days_range
  check (reseller_trial_days between 0 and 30);

-- Slugs must be globally unique (one signup URL per reseller). Partial unique
-- index so the many NULLs (un-configured resellers) don't collide.
create unique index if not exists agency_accounts_reseller_slug_key
  on public.agency_accounts (reseller_slug)
  where reseller_slug is not null;

-- 2) Trial tracking on the client subaccount. trial_ends_at already exists.
alter table public.practices add column if not exists trial_started_at timestamptz;

-- 3) Extend get_branding() to also match on reseller_slug for the white-labeled
--    /signup/<slug> page. CREATE OR REPLACE supersedes the prior definition; the
--    returned shape is unchanged (the client reads the same fields).
create or replace function public.get_branding(p_slug text default null, p_domain text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when a.id is null then null else jsonb_build_object(
           'slug',               coalesce(a.reseller_slug, a.id::text),
           'company_name',       coalesce(a.company_name, a.brand_name, a.name),
           'brand_name',         coalesce(a.company_name, a.brand_name, a.name),
           'logo_url',           a.logo_url,
           'logo_dark_url',      a.logo_dark_url,
           'favicon_url',        a.favicon_url,
           'primary_color',      a.primary_color,
           'secondary_color',    a.secondary_color,
           'accent_color',       a.accent_color,
           'support_email',      a.support_email,
           'support_phone',      a.support_phone,
           'onboarding_message', a.onboarding_message
         ) end
  from public.agency_accounts a
  where a.white_label_enabled = true
    and (
      (p_domain is not null and (a.domain = p_domain or a.custom_domain = p_domain))
      or (p_slug is not null and (a.reseller_slug = p_slug or a.id::text = p_slug))
    )
  order by
    -- prefer exact domain, then slug, then id fallback
    case
      when p_domain is not null and (a.domain = p_domain or a.custom_domain = p_domain) then 0
      when p_slug is not null and a.reseller_slug = p_slug then 1
      else 2
    end
  limit 1;
$$;

grant execute on function public.get_branding(text, text) to anon, authenticated;

-- 4) Public, unauthenticated lookup used by the /signup/<slug> page to fetch the
--    reseller's SaaS offer (price, trial config) for a slug. Security definer so
--    it can read the resellers table without exposing a broad RLS policy; returns
--    only the non-sensitive fields the signup page needs, and only for resellers
--    that have actually configured + enabled SaaS mode.
create or replace function public.get_reseller_signup(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when a.id is null then null else jsonb_build_object(
           'agency_id',         a.id::text,
           'slug',              a.reseller_slug,
           'company_name',      coalesce(a.company_name, a.brand_name, a.name),
           'logo_url',          a.logo_url,
           'favicon_url',       a.favicon_url,
           'primary_color',     a.primary_color,
           'support_email',     a.support_email,
           'onboarding_message',a.onboarding_message,
           'client_price',      a.reseller_client_price,
           'trial_enabled',     a.reseller_trial_enabled,
           'trial_days',        a.reseller_trial_days,
           'annual_enabled',    a.reseller_annual_enabled
         ) end
  from public.agency_accounts a
  where a.reseller_slug = p_slug
    and a.reseller_client_price is not null
  limit 1;
$$;

grant execute on function public.get_reseller_signup(text) to anon, authenticated;
