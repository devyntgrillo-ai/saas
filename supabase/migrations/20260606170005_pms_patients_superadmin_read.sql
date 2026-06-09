-- pms_patients was readable only via the practice-scoped policy
-- (practice_id = current_practice_id()), so a super-admin viewing another
-- practice (e.g. the demo account) couldn't see the patient roster — even though
-- pms_appointments already has an equivalent super-admin SELECT policy. Mirror it.
drop policy if exists pms_patients_superadmin_select on public.pms_patients;
create policy pms_patients_superadmin_select
  on public.pms_patients
  for select
  to authenticated
  using (public.is_super_admin());
