-- One-off demo seed: unscheduled treatment plans for the "Demo Dental"
-- subaccount so the Reactivation Campaign feature has a realistic audience to
-- pull and blast. The campaign reads public.consults filtered by practice +
-- created-date window, excluding ones with an active sequence — so these are
-- outcome='pending' with no sequence, dated across the 3-12 month windows.
--
-- Guarded (no-ops if Demo Dental isn't present, e.g. local DBs) and idempotent
-- (clears its own marker rows first), so it's safe anywhere / on re-run.

do $$
declare
  pid uuid;
begin
  select id into pid from public.practices
   where email = 'demo@pinnacledental.com' or name = 'Demo Dental'
   order by created_at
   limit 1;

  if pid is null then
    raise notice 'Demo Dental practice not found; skipping reactivation seed.';
    return;
  end if;

  -- Idempotent: remove any prior rows from this seed (recognizable marker email).
  delete from public.consults
   where practice_id = pid and patient_email like '%@reactivation.demo';

  insert into public.consults
    (practice_id, patient_name, patient_first, patient_last, patient_phone, patient_email,
     treatment_type, case_value, tx_plan_value, objection_type, outcome, status, recording_date, created_at)
  values
    (pid, 'Patricia Nguyen',  'Patricia','Nguyen', '(480) 555-0151','patricia.nguyen@reactivation.demo','full_arch',         38000,38000,'price',  'pending','active',(now()-interval '212 days')::date, now()-interval '212 days'),
    (pid, 'Gerald Hoffman',   'Gerald',  'Hoffman', '(480) 555-0152','gerald.hoffman@reactivation.demo', 'full_arch',         41000,41000,'spouse', 'pending','active',(now()-interval '198 days')::date, now()-interval '198 days'),
    (pid, 'Denise Carraway',  'Denise',  'Carraway','(480) 555-0153','denise.carraway@reactivation.demo','dental_implants',   12000,12000,'price',  'pending','active',(now()-interval '305 days')::date, now()-interval '305 days'),
    (pid, 'Marcus Bellamy',   'Marcus',  'Bellamy', '(480) 555-0154','marcus.bellamy@reactivation.demo', 'dental_implants',   9500, 9500, 'timing', 'pending','active',(now()-interval '256 days')::date, now()-interval '256 days'),
    (pid, 'Sophia Reyes',     'Sophia',  'Reyes',   '(480) 555-0155','sophia.reyes@reactivation.demo',   'invisalign',        6800, 6800, 'price',  'pending','active',(now()-interval '341 days')::date, now()-interval '341 days'),
    (pid, 'Harold Pruitt',    'Harold',  'Pruitt',  '(480) 555-0156','harold.pruitt@reactivation.demo',  'full_mouth_rehab',  27000,27000,'fear',   'pending','active',(now()-interval '189 days')::date, now()-interval '189 days'),
    (pid, 'Yvonne Castillo',  'Yvonne',  'Castillo','(480) 555-0157','yvonne.castillo@reactivation.demo','cosmetic_veneers',  14000,14000,'price',  'pending','active',(now()-interval '233 days')::date, now()-interval '233 days'),
    (pid, 'Trevor Osei',      'Trevor',  'Osei',    '(480) 555-0158','trevor.osei@reactivation.demo',    'full_arch',         36000,36000,'timing', 'pending','active',(now()-interval '278 days')::date, now()-interval '278 days'),
    (pid, 'Bianca Floyd',     'Bianca',  'Floyd',   '(480) 555-0159','bianca.floyd@reactivation.demo',   'sleep_apnea',       4200, 4200, null,     'pending','active',(now()-interval '301 days')::date, now()-interval '301 days'),
    (pid, 'Raymond Tilley',   'Raymond', 'Tilley',  '(480) 555-0160','raymond.tilley@reactivation.demo', 'dental_implants',   10500,10500,'fear',   'pending','active',(now()-interval '224 days')::date, now()-interval '224 days'),
    (pid, 'Camille Beaudry',  'Camille', 'Beaudry', '(480) 555-0161','camille.beaudry@reactivation.demo','periodontal',       3800, 3800, 'price',  'pending','active',(now()-interval '352 days')::date, now()-interval '352 days'),
    (pid, 'Devon Mathews',    'Devon',   'Mathews', '(480) 555-0162','devon.mathews@reactivation.demo',  'full_arch',         39500,39500,'spouse', 'pending','active',(now()-interval '205 days')::date, now()-interval '205 days'),
    (pid, 'Lorraine Whitfield','Lorraine','Whitfield','(480) 555-0163','lorraine.whitfield@reactivation.demo','full_mouth_rehab',24000,24000,'timing','pending','active',(now()-interval '263 days')::date, now()-interval '263 days'),
    (pid, 'Andre Salcedo',    'Andre',   'Salcedo', '(480) 555-0164','andre.salcedo@reactivation.demo',  'cosmetic_veneers',  11000,11000,'fear',   'pending','active',(now()-interval '118 days')::date, now()-interval '118 days'),
    (pid, 'Megan Ipsen',      'Megan',   'Ipsen',   '(480) 555-0165','megan.ipsen@reactivation.demo',    'invisalign',        7200, 7200, 'spouse', 'pending','active',(now()-interval '142 days')::date, now()-interval '142 days'),
    (pid, 'Curtis Fairbanks', 'Curtis',  'Fairbanks','(480) 555-0166','curtis.fairbanks@reactivation.demo','dental_implants', 13500,13500,'price',  'pending','active',(now()-interval '167 days')::date, now()-interval '167 days');

  raise notice 'Seeded reactivation demo consults for Demo Dental (%).', pid;
end $$;
