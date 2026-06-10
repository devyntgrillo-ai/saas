-- ============================================================================
-- pms_unscheduled_treatments - the practice's UNSCHEDULED treatment plans pulled
-- live from their PMS (Sikka), so the dashboard "Unscheduled TX Plans" KPI can
-- reflect the PMS's own list rather than CaseLift's pending consults.
--
-- Populated by the sync-pms-unscheduled-treatments edge function (service role).
-- The dashboard counts rows for the active practice; when this table has no rows
-- for a practice (PMS not connected / not yet synced) the dashboard falls back
-- to the consult-based count, so nothing breaks before this is deployed.
--
-- Run in the Supabase SQL editor (project eymgqjeudrmeofytnwgs).
-- (Could not run from the agent session - no DB connection available.)
-- ============================================================================

create table if not exists public.pms_unscheduled_treatments (
  id                  uuid primary key default gen_random_uuid(),
  practice_id         uuid not null references public.practices(id) on delete cascade,
  office_id           text,
  external_id         text,            -- PMS treatment-plan / procedure id (dedupe key)
  patient_external_id text,
  patient_name        text,
  treatment_type      text,            -- normalized CaseLift treatment_type, when derivable
  description         text,
  tx_value            numeric,
  status              text,            -- status as reported by the PMS
  synced_at           timestamptz not null default now(),
  raw                 jsonb,
  created_at          timestamptz not null default now()
);

-- One row per (practice, PMS record). Lets the sync upsert idempotently.
create unique index if not exists pms_unsched_tx_practice_ext
  on public.pms_unscheduled_treatments(practice_id, external_id);
create index if not exists pms_unsched_tx_practice
  on public.pms_unscheduled_treatments(practice_id);

alter table public.pms_unscheduled_treatments enable row level security;

-- Read: a practice user sees their own rows; platform admin sees all.
drop policy if exists pms_unsched_tx_select on public.pms_unscheduled_treatments;
create policy pms_unsched_tx_select on public.pms_unscheduled_treatments
  for select to authenticated
  using (practice_id = public.current_practice_id() or public.is_platform_admin());

-- Writes happen only via the service-role sync function (no authenticated
-- INSERT/UPDATE/DELETE policy granted).
