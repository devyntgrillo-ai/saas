-- ============================================================================
-- RESELLER WHITE-LABEL BRANDING. Idempotent.
--
-- Resellers live in `agency_accounts`; a practice belongs to a reseller via
-- `practices.agency_id`. This migration makes the reseller record carry the
-- full white-label brand so the app + emails can re-skin per reseller:
--
--   • company_name   - display name shown to clients instead of "Hope AI"
--   • primary_color   - hex brand color (drives the themeable primary palette)
--   • logo_url        - sidebar / email-header logo (public URL)
--   • favicon_url     - browser-tab favicon (optional)
--   • support_email   - shown in error states, billing, email reply-to
--   • white_label_enabled - explicit on/off switch for the brand
--
-- It also creates the public `reseller-assets` storage bucket (logos/favicons)
-- and extends get_branding() to surface company_name + favicon_url for the
-- pre-auth domain/slug path. Super-admin override + per-user resolution happen
-- client-side in BrandingContext.
--
-- Run in the Supabase SQL editor (project eymgqjeudrmeofytnwgs) if not applied
-- via the CLI. Safe to run repeatedly.
-- ============================================================================

-- 1) Brand columns on the reseller record. IF NOT EXISTS so it is safe whether
--    or not the live table already has some of these (it was created ad-hoc).
alter table public.agency_accounts add column if not exists company_name        text;
alter table public.agency_accounts add column if not exists brand_name          text;
alter table public.agency_accounts add column if not exists primary_color       text;
alter table public.agency_accounts add column if not exists logo_url            text;
alter table public.agency_accounts add column if not exists logo_dark_url       text;
alter table public.agency_accounts add column if not exists favicon_url         text;
alter table public.agency_accounts add column if not exists support_email       text;
alter table public.agency_accounts add column if not exists support_phone       text;
alter table public.agency_accounts add column if not exists secondary_color     text;
alter table public.agency_accounts add column if not exists accent_color        text;
alter table public.agency_accounts add column if not exists onboarding_message  text;
alter table public.agency_accounts add column if not exists domain              text;
alter table public.agency_accounts add column if not exists custom_domain       text;
alter table public.agency_accounts add column if not exists white_label_enabled boolean not null default false;

-- Backfill company_name from the older brand_name / name so existing resellers
-- keep their wordmark, and flip on white_label_enabled where a brand exists.
update public.agency_accounts
   set company_name = coalesce(company_name, brand_name)
 where company_name is null and brand_name is not null;

update public.agency_accounts
   set white_label_enabled = true
 where white_label_enabled = false
   and (company_name is not null or brand_name is not null or logo_url is not null);

-- 2) Public storage bucket for reseller logos / favicons.
--    Public so <img src> + email headers can load the asset without a signed URL.
insert into storage.buckets (id, name, public)
values ('reseller-assets', 'reseller-assets', true)
on conflict (id) do update set public = true;

-- Authenticated users may upload/manage assets; anyone may read (public bucket).
-- Files are keyed `<agency_id>/<kind>-<ts>.<ext>`; tighten the first path segment
-- against the caller's agency later if desired.
drop policy if exists "reseller_assets_insert" on storage.objects;
create policy "reseller_assets_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'reseller-assets');

drop policy if exists "reseller_assets_update" on storage.objects;
create policy "reseller_assets_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'reseller-assets')
  with check (bucket_id = 'reseller-assets');

drop policy if exists "reseller_assets_delete" on storage.objects;
create policy "reseller_assets_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'reseller-assets');

drop policy if exists "reseller_assets_read" on storage.objects;
create policy "reseller_assets_read" on storage.objects
  for select to public
  using (bucket_id = 'reseller-assets');

-- 3) get_branding(p_slug, p_domain): resolve a reseller brand for the pre-auth
--    path (custom domain, or ?brand=<agency id>). Returns one jsonb object or
--    null. CREATE OR REPLACE supersedes any prior definition additively - same
--    field names the client already reads, plus company_name + favicon_url.
create or replace function public.get_branding(p_slug text default null, p_domain text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when a.id is null then null else jsonb_build_object(
           'slug',               a.id::text,
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
      or (p_slug is not null and a.id::text = p_slug)
    )
  order by
    -- prefer an exact domain match over the slug fallback
    case when p_domain is not null and (a.domain = p_domain or a.custom_domain = p_domain) then 0 else 1 end
  limit 1;
$$;

grant execute on function public.get_branding(text, text) to anon, authenticated;
