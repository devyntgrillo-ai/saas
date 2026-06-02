-- ============================================================================
-- Seed PMS appointments for "Perry Family Dentistry" (11 rows).
-- Repeatable/resettable: clears prior seed rows (pms_appointment_id like 'seed-%')
-- before inserting. Dates are relative to current_date so it always shows
-- today / yesterday / tomorrow correctly.
--
-- Run in the Supabase SQL editor (project eymgqjeudrmeofytnwgs).
-- pms_appointments columns: practice_id, pms_appointment_id, patient_first,
-- patient_last, patient_phone, patient_email, appointment_time (timestamptz),
-- appointment_type, provider, is_implant_consult. (No separate patients table -
-- contact info lives on the appointment row.)
-- ============================================================================
do $$
declare
  pid uuid;
begin
  select id into pid from public.practices where name ilike '%Perry%' order by created_at limit 1;
  if pid is null then
    raise notice 'Skipping PMS appointment seed: no practice matching %%Perry%% yet.';
    return;
  end if;

  -- Reset prior seed rows so this is repeatable.
  delete from public.pms_appointments where practice_id = pid and pms_appointment_id like 'seed-%';

  insert into public.pms_appointments
    (practice_id, pms_appointment_id, patient_first, patient_last, patient_phone, patient_email,
     appointment_time, appointment_type, provider, is_implant_consult)
  values
  -- TODAY
  (pid, 'seed-01', 'Margaret', 'Chen',      '(509) 555-0182', 'margaret.chen@email.com',  (current_date + time '08:00'), 'Implant Consult',         'Dr. Perry', true),
  (pid, 'seed-02', 'Robert',   'Delgado',   '(512) 555-0211', 'robert.delgado@gmail.com', (current_date + time '09:30'), 'Full Arch Consult',       'Dr. Perry', true),
  (pid, 'seed-03', 'Linda',    'Foster',    '(509) 555-0193', 'lfoster@outlook.com',      (current_date + time '11:00'), 'Implant Consult',         'Dr. Perry', true),
  (pid, 'seed-04', 'James',    'Whitfield', '(208) 555-0147', 'jwhitfield@email.com',     (current_date + time '13:30'), 'Single Implant Consult',  'Dr. Perry', true),
  (pid, 'seed-05', 'Sandra',   'Nguyen',    '(509) 555-0229', 'snguyen@gmail.com',        (current_date + time '15:00'), 'Implant Consultation',    'Dr. Perry', true),
  -- YESTERDAY (will show as Missed)
  (pid, 'seed-06', 'Thomas',   'Rivera',    '(208) 555-0163', 'tom.rivera@email.com',     ((current_date - 1) + time '09:00'), 'Implant Consult',   'Dr. Perry', true),
  (pid, 'seed-07', 'Karen',    'Mills',     '(509) 555-0178', 'karen.mills@outlook.com',  ((current_date - 1) + time '10:30'), 'Full Arch Consult', 'Dr. Perry', true),
  (pid, 'seed-08', 'David',    'Park',      '(425) 555-0201', 'dpark@gmail.com',          ((current_date - 1) + time '14:00'), 'Implant Consult',   'Dr. Perry', true),
  -- TOMORROW (upcoming)
  (pid, 'seed-09', 'Patricia', 'Gomez',     '(509) 555-0134', 'pgomez@email.com',         ((current_date + 1) + time '08:30'), 'Implant Consult',        'Dr. Perry', true),
  (pid, 'seed-10', 'Frank',    'Sullivan',  '(208) 555-0188', 'frank.sullivan@gmail.com', ((current_date + 1) + time '10:00'), 'Full Arch Consult',      'Dr. Perry', true),
  (pid, 'seed-11', 'Angela',   'Torres',    '(509) 555-0216', 'angela.torres@email.com',  ((current_date + 1) + time '14:30'), 'Single Implant Consult', 'Dr. Perry', true);

  raise notice 'Seeded 11 appointments for practice %', pid;
end $$;

-- Verify: select count(*) from public.pms_appointments
--   where practice_id = (select id from public.practices where name ilike '%Perry%' limit 1);
-- Expect 11 (assuming no other appointments existed).
