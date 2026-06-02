-- ============================================================================
-- admin_seed.sql - clean up junk agencies + seed a realistic admin dataset
--
-- HOW TO RUN: paste into the Supabase SQL editor for project eymgqjeudrmeofytnwgs
-- (Dashboard → SQL Editor → New query → Run). It is wrapped in a transaction.
--
-- WHY A FILE (not auto-applied): this session has no Supabase MCP / psql / DB
-- connection, so the SQL could not be executed from the agent. Run it yourself.
--
-- COLUMN CAVEAT: the repo's schema.sql does NOT define agency_accounts columns
-- or the practices.agency_id / subscription_status / location columns the admin
-- UI reads. The statements below use the column set the app's own AddAgencyModal
-- writes. If a statement errors with `column ... does not exist`, either add the
-- column (alter table) or delete that column from the INSERT and re-run - the
-- app tolerates these columns being absent (it just falls back to defaults).
--
-- WHAT IS DB-DRIVEN vs FRONTEND: Total MRR = (# linked practices) × monthly_fee,
-- and "consults this month" come from the consults table - those reflect this
-- seed. But the activity feed, the 6-month MRR-history chart, and per-practice
-- "production recovered" are computed in the frontend (src/lib/admin.js demo
-- constants), so they already show the impressive target numbers regardless of
-- this seed. Running this makes the agency/practice/consult data real.
-- ============================================================================

begin;

-- 1) DELETE junk seed agencies (exact request) -------------------------------
delete from public.agency_accounts
where name in ('dsd', 'Coastal Smiles Network', 'Mountain West Dental', 'Summit Dental Partners');

-- 2) Ensure the two real agencies exist (idempotent by name) ------------------
--    $500/location to Hope AI → 3 locations = $1,500, 2 locations = $1,000.
insert into public.agency_accounts (name, owner_name, owner_email, monthly_fee, active, admin_notes)
select 'Northwest Implant Group', 'Marcus Webb', 'agency@nwimplant.com', 500, true,
       'Founding partner. Expanding into Idaho in Q3 - likely +2 locations.'
where not exists (select 1 from public.agency_accounts where name = 'Northwest Implant Group');

insert into public.agency_accounts (name, owner_name, owner_email, monthly_fee, active, admin_notes)
select 'Pacific Dental Partners', 'Elena Park', 'admin@pacificdental.com', 500, true,
       'Onboarding their 3rd location next month.'
where not exists (select 1 from public.agency_accounts where name = 'Pacific Dental Partners');

-- 3) Seed 5 practices linked to the two agencies -----------------------------
--    NOTE: requires practices.agency_id, subscription_status, location. Remove
--    any column that errors. Names match the frontend DEMO_RECOVERED map so the
--    UI shows production-recovered figures (~$301k total) for these practices.
do $$
declare
  nw  uuid := (select id from public.agency_accounts where name = 'Northwest Implant Group' limit 1);
  pac uuid := (select id from public.agency_accounts where name = 'Pacific Dental Partners' limit 1);
begin
  insert into public.practices (name, doctor_first, doctor_last, agency_id, subscription_status, location, created_at)
  select v.name, v.df, v.dl, v.agency, v.sub, v.loc, now() - (v.age || ' days')::interval
  from (values
    ('Perry Family Dentistry',        'James',  'Perry',     nw,  'active',   'Spokane, WA',  45),
    ('Cascade Implant Center',        'Sarah',  'Lindqvist', nw,  'active',   'Tacoma, WA',   40),
    ('Blue Sky Dental',               'Aaron',  'Cole',      nw,  'active',   'Bellevue, WA', 33),
    ('Spokane Implant Specialists',   'Nadia',  'Brooks',    pac, 'active',   'Spokane, WA',  28),
    ('Columbia River Dental',         'Owen',   'Hayes',     pac, 'trialing', 'Portland, OR',  9)
  ) as v(name, df, dl, agency, sub, loc, age)
  where not exists (select 1 from public.practices p where p.name = v.name);
end $$;

-- 4) Seed ~47 consults across this month (counts drive the admin metric) ------
--    Distribution: Perry 15, Cascade 10, Blue Sky 7, Spokane 12, Columbia 3 = 47.
do $$
declare
  rec record;
  i int;
begin
  for rec in
    select p.id, c.n
    from (values
      ('Perry Family Dentistry', 15),
      ('Cascade Implant Center', 10),
      ('Blue Sky Dental', 7),
      ('Spokane Implant Specialists', 12),
      ('Columbia River Dental', 3)
    ) as c(name, n)
    join public.practices p on p.name = c.name
  loop
    for i in 1..rec.n loop
      insert into public.consults (practice_id, status, primary_objection, recording_date, created_at)
      values (
        rec.id,
        (array['analyzed','recovered','followed_up','analyzed'])[1 + (i % 4)],
        (array['Cost concern','Needs spouse approval','Wants to think it over','Timing','Comparing options'])[1 + (i % 5)],
        (now() - ((i * 1.7)::int || ' days')::interval)::date,
        now() - ((i * 1.7)::int || ' days')::interval
      );
    end loop;
  end loop;
end $$;

-- 5) One churn event this month (drives "Churn this month" + Revenue churn) ----
do $$
declare
  perry uuid := (select id from public.practices where name = 'Perry Family Dentistry' limit 1);
begin
  if perry is not null and not exists (
    select 1 from public.cancellation_feedback
    where created_at >= date_trunc('month', now()) and reason = 'too_expensive'
  ) then
    insert into public.cancellation_feedback (practice_id, reason, mrr_at_cancellation, production_recovered, created_at)
    values (perry, 'too_expensive', 997, 0, now() - interval '6 days');
  end if;
end $$;

commit;

-- 6) Verify -------------------------------------------------------------------
-- select name, monthly_fee, active from public.agency_accounts order by name;
-- select count(*) as practices from public.practices;
-- select count(*) as consults_this_month from public.consults where created_at >= date_trunc('month', now());
