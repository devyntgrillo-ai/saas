-- Link a consult directly to a synced PMS patient (pms_patients), set when a TC
-- records via the "Select Patient" picker (no today's appointment to link
-- through). Enables attribution back to the PMS patient record.
alter table public.consults
  add column if not exists pms_patient_id uuid references public.pms_patients(id) on delete set null;

create index if not exists idx_consults_pms_patient on public.consults(pms_patient_id);
