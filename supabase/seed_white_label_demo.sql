-- ============================================================================
-- seed_white_label_demo.sql - turn on white-label branding for a reseller so the
-- super-admin's "View as client" toggle (account switcher) has a brand to resolve
-- to and visibly flips the whole app to the reseller's look.
--
-- WHAT IT DOES (idempotent):
--   • Finds the agency the demo super-admin belongs to (falls back to the seeded
--     "Northwest Implant Group", creating it if missing).
--   • Enables white-label on it with an unmistakable palette (teal, not the
--     default indigo) + company name, so toggling "View as client" ON is obvious
--     and the browser-tab title changes too.
--   • GUARANTEES the demo super-admin is an owner-member of that agency, so the
--     toggle resolves to it directly from the admin view (Path A) with no
--     impersonation needed.
--   • Ensures at least one practice is linked to that agency, so it also works via
--     the impersonation path (pick the client → toggle) and shows a reseller card.
--
-- WHY THIS MAKES THE TOGGLE WORK: BrandingContext resolves `resellerAgency` from
-- the viewer's own agency, or the practice they're impersonating. With the toggle
-- OFF a super-admin still sees Hope AI; ON shows this brand. isWhiteLabeledAgency
-- requires white_label_enabled = true AND a name - both set here.
--
-- HOW TO RUN: Supabase SQL editor (project eymgqjeudrmeofytnwgs). Re-runnable.
--   Reload the app afterward so the agency record re-loads.
-- TO UNDO:  update public.agency_accounts set white_label_enabled = false
--           where white_label_enabled;  -- (or scope to the printed id)
-- ============================================================================

do $$
declare
  uid uuid;
  ag uuid;
begin
  -- Resolve the demo super-admin's user id (needed to guarantee membership).
  select id into uid from public.users where email = 'devyntgrillo@gmail.com' limit 1;
  if uid is null then
    raise exception 'No public.users row for devyntgrillo@gmail.com - sign in once so the user row exists, then re-run.';
  end if;

  -- Reuse the agency the demo already belongs to → what their toggle resolves to.
  select am.agency_id into ag from public.agency_members am where am.user_id = uid limit 1;

  -- Fallbacks: a known seeded reseller, else create one.
  if ag is null then
    select id into ag from public.agency_accounts where name = 'Northwest Implant Group' limit 1;
  end if;
  if ag is null then
    insert into public.agency_accounts (name, owner_name, owner_email, active)
    values ('Northwest Implant Group', 'Demo Reseller', 'reseller@example.com', true)
    returning id into ag;
  end if;

  -- Enable white-label with an unmistakable brand (teal palette + name + title).
  -- Keep any logo/favicon already configured; only set what drives a visible change.
  update public.agency_accounts set
    white_label_enabled = true,
    company_name    = coalesce(nullif(company_name, ''), 'Northwest Implant Group'),
    brand_name      = coalesce(nullif(brand_name, ''),   'Northwest Implant Group'),
    primary_color   = '#0D9488',
    secondary_color = coalesce(nullif(secondary_color, ''), '#14B8A6'),
    accent_color    = coalesce(nullif(accent_color, ''),    '#F59E0B'),
    support_email   = coalesce(nullif(support_email, ''),   'support@northwestimplant.com')
  where id = ag;

  -- GUARANTEE Path A: make the demo super-admin an owner of this agency so
  -- BrandingContext resolves resellerAgency → this brand without impersonation.
  if not exists (
    select 1 from public.agency_members where user_id = uid and agency_id = ag
  ) then
    insert into public.agency_members (user_id, agency_id, role) values (uid, ag, 'owner');
  end if;

  -- Ensure a practice is linked (impersonation path + reseller overview card).
  if not exists (select 1 from public.practices where agency_id = ag) then
    insert into public.practices (name, doctor_first, doctor_last, agency_id, baa_accepted_at)
    values ('Cascade Implant Center', 'Sarah', 'Lindqvist', ag, now());
  end if;

  raise notice 'White-labeled agency % (primary #0D9488). Undo: update public.agency_accounts set white_label_enabled=false where id=%;', ag, ag;
end $$;

-- Verify:
-- select id, name, company_name, white_label_enabled, primary_color
--   from public.agency_accounts where white_label_enabled;
