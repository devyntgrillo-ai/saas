-- ============================================================================
-- Link consults to PMS appointments. Idempotent.
--
-- NOTE: pms_appointments uses `appointment_time` (timestamptz), not a separate
-- `appointment_date` column, and is already indexed on
-- (practice_id, appointment_time) - so no extra date index is added here.
-- consults already has patient_name / patient_phone / patient_email /
-- pms_appointment_id (text); this adds the uuid FK the new flow uses.
-- Run in the Supabase SQL editor (project eymgqjeudrmeofytnwgs).
-- ============================================================================
alter table public.consults
  add column if not exists appointment_id uuid references public.pms_appointments(id) on delete set null;

create index if not exists idx_consults_appointment on public.consults(appointment_id);

-- Defensive: ensure the patient columns the flow writes exist (they already do
-- on current schemas, but keep this runnable on older ones).
alter table public.consults add column if not exists patient_name  text;
alter table public.consults add column if not exists patient_phone text;
alter table public.consults add column if not exists patient_email text;
