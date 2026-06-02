-- ============================================================================
-- Sikka PMS integration columns + supporting tables. Idempotent.
-- Run in the Supabase SQL editor (project eymgqjeudrmeofytnwgs).
-- ============================================================================

-- practices: Sikka linkage (set by admin, never by the practice).
alter table public.practices add column if not exists sikka_practice_id  text;
alter table public.practices add column if not exists sikka_connected     boolean not null default false;
alter table public.practices add column if not exists pms_type            text;            -- informational (dentrix/eaglesoft/...)
alter table public.practices add column if not exists pms_last_synced_at  timestamptz;

-- pms_appointments: a duration column + a unique key for idempotent upserts on
-- re-sync. (Existing columns: patient_first/last/phone/email, appointment_time,
-- appointment_type, provider, pms_appointment_id, is_implant_consult.)
alter table public.pms_appointments add column if not exists duration_minutes int;

-- Upsert key: (practice_id, pms_appointment_id). NULLs are allowed/distinct, so
-- manual (non-Sikka) rows with a null pms_appointment_id don't collide.
create unique index if not exists uq_pms_appts_practice_extid
  on public.pms_appointments(practice_id, pms_appointment_id);

-- Unlinked Sikka registrations for admin review (when the connect webhook can't
-- match a Sikka practice to a Hope AI practice).
create table if not exists public.sikka_registrations (
  id                uuid primary key default gen_random_uuid(),
  sikka_practice_id text,
  practice_name     text,
  npi               text,
  raw               jsonb,
  matched_practice_id uuid references public.practices(id) on delete set null,
  status            text not null default 'unlinked', -- unlinked | linked | ignored
  created_at        timestamptz not null default now()
);
create index if not exists idx_sikka_registrations_status on public.sikka_registrations(status, created_at desc);

alter table public.sikka_registrations enable row level security;
-- Super-admins read/manage unlinked registrations from the admin panel.
drop policy if exists "sikka_reg_admin_select" on public.sikka_registrations;
create policy "sikka_reg_admin_select" on public.sikka_registrations
  for select to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.access_level = 'super_admin'));
drop policy if exists "sikka_reg_admin_update" on public.sikka_registrations;
create policy "sikka_reg_admin_update" on public.sikka_registrations
  for update to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.access_level = 'super_admin'));
-- Inserts come from the sikka-connect-webhook (service role, bypasses RLS).
