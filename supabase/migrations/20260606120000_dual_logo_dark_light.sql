-- ============================================================================
-- Dual brand logos: separate dark-mode and light-mode logo URLs so a reseller
-- can upload a light/white logo for dark UI and a dark logo for light UI.
-- logo_url stays the universal fallback when only one (or neither) is set.
-- Supersedes the vestigial logo_dark_url column (its value is backfilled).
-- ============================================================================

alter table public.agency_accounts add column if not exists logo_url_dark  text;
alter table public.agency_accounts add column if not exists logo_url_light text;

-- Preserve any value that lived in the old logo_dark_url column.
update public.agency_accounts
   set logo_url_dark = logo_dark_url
 where logo_url_dark is null and logo_dark_url is not null;

-- Surface the new columns in the pre-auth branding RPC (custom domain / ?brand=).
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
           'logo_url_dark',      a.logo_url_dark,
           'logo_url_light',     a.logo_url_light,
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
    case when p_domain is not null and (a.domain = p_domain or a.custom_domain = p_domain) then 0 else 1 end
  limit 1;
$$;

grant execute on function public.get_branding(text, text) to anon, authenticated;
