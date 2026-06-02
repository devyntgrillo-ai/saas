-- ============================================================================
-- reseller_practices_seed.sql
-- Populates real client practices for the reseller view + account switcher.
--
-- WHY: the reseller portal (Agency.jsx) and the account switcher read REAL rows
-- from the `practices` table. "Perry Family Dentistry" et al. currently exist
-- only as admin DEMO data (src/lib/admin.js), so the portal/switcher are empty.
-- This inserts real practices linked to the demo super-admin's agency so:
--   • the account switcher lists them (super-admin sees all practices), and
--   • the reseller Overview shows practice cards (agency_id = your agency), and
--   • clicking a card / switching sets a practiceId → the full practice nav
--     (Dashboard, Consults, Conversations, Performance, KB, Training, Settings)
--     appears.
--
-- HOW TO RUN: Supabase SQL editor (project eymgqjeudrmeofytnwgs). Idempotent.
-- (Could not run from the agent session - no DB connection available.)
-- ============================================================================

do $$
declare
  ag uuid;
begin
  -- The agency the demo super-admin belongs to.
  select am.agency_id into ag
  from public.agency_members am
  join public.users u on u.id = am.user_id
  where u.email = 'devyntgrillo@gmail.com'
  limit 1;

  if ag is null then
    raise exception 'No agency_members row found for devyntgrillo@gmail.com - cannot link practices. Check the agency_members table.';
  end if;

  insert into public.practices (name, doctor_first, doctor_last, agency_id, baa_accepted_at)
  select v.name, v.df, v.dl, ag, now()
  from (values
    ('Perry Family Dentistry',      'James',  'Perry'),
    ('Cascade Implant Center',      'Sarah',  'Lindqvist'),
    ('Blue Sky Dental',             'Aaron',  'Cole'),
    ('Spokane Implant Specialists', 'Nadia',  'Brooks'),
    ('Columbia River Dental',       'Owen',   'Hayes')
  ) as v(name, df, dl)
  where not exists (select 1 from public.practices p where p.name = v.name);

  raise notice 'Seeded practices for agency %', ag;
end $$;

-- Verify:
-- select name, agency_id, baa_accepted_at from public.practices order by name;
