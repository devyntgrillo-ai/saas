-- Seed Power Dialer test data for Gold Dental (adeoyeadebayo18+2@gmail.com)
-- practice_id: e26ad518-6b4e-4ccd-b60c-c06740df8ce1
--
-- Run: npx supabase db query --linked -f scripts/seed-power-dialer-gold-dental.sql

do $$
declare
  pid uuid := 'e26ad518-6b4e-4ccd-b60c-c06740df8ce1';
  c_john uuid := '79136c85-660f-4048-8ffe-7622532555eb';
  c_sarah uuid := '9ed7d629-09aa-44de-9401-f482a56ec761';
  c_sarah2 uuid := 'cb8129ca-0d94-454f-8ad8-21ba7dc538ec';
  c_maria uuid;
begin
  -- Ensure consults have phones (power dialer filters these out otherwise).
  update public.consults set
    patient_phone = '(512) 555-0142',
    patient_name = coalesce(patient_name, 'John Smith'),
    exit_intent_level = coalesce(exit_intent_level, 'warm'),
    objection_type = coalesce(objection_type, 'price'),
    status = 'analyzed'
  where id = c_john and practice_id = pid;

  update public.consults set
    patient_phone = '(512) 555-0199',
    patient_name = coalesce(patient_name, 'Sarah Johnson'),
    exit_intent_level = coalesce(exit_intent_level, 'warm'),
    objection_type = coalesce(objection_type, 'price'),
    status = 'analyzed'
  where id = c_sarah and practice_id = pid;

  update public.consults set
    patient_phone = '(512) 555-0288',
    patient_name = coalesce(patient_name, 'Sarah Johnson'),
    exit_intent_level = coalesce(exit_intent_level, 'hot'),
    objection_type = coalesce(objection_type, 'spouse'),
    status = 'analyzed'
  where id = c_sarah2 and practice_id = pid;

  -- Extra lead for a fuller dialer session.
  insert into public.consults (
    practice_id, patient_name, patient_phone, patient_email, status,
    objection_type, exit_intent_level, personal_detail, tc_action, recording_date
  ) values (
    pid, 'Maria Lopez', '(512) 555-0367', 'maria.lopez@example.com', 'analyzed',
    'timing', 'long_term',
    'Wants to wait until after her daughter''s wedding in September.',
    'Warm check-in call — no pressure, offer a quick 15-minute visit when timing feels right.',
    current_date - 14
  )
  on conflict do nothing
  returning id into c_maria;

  if c_maria is null then
    select id into c_maria from public.consults
    where practice_id = pid and patient_phone = '(512) 555-0367'
    limit 1;
  end if;

  -- Remove stale call touchpoints for this practice, then insert fresh ones due today.
  delete from public.messages
  where practice_id = pid
    and (channel = 'call' or type = 'call');

  insert into public.messages (consult_id, practice_id, type, channel, subject, body, status, send_day, scheduled_for, created_at)
  values
    (c_john, pid, 'call', 'call', null,
     'Call: follow up on financing options before the August family reunion.',
     'scheduled', 3, now(), now()),
    (c_sarah, pid, 'call', 'call', null,
     'Call: address speech concern and monthly payment breakdown before her open house.',
     'scheduled', 1, now(), now()),
    (c_sarah2, pid, 'call', 'call', null,
     'Call: offer a quick joint call so she and her spouse hear the same numbers.',
     'scheduled', 7, now(), now()),
    (c_maria, pid, 'call', 'call', null,
     'Call: friendly check-in — respect her wedding timeline, keep it low pressure.',
     'scheduled', 14, now(), now());

  raise notice 'Power dialer seeded for practice % — % call touchpoints due today', pid, 4;
end $$;

-- Verify queue matches frontend filter.
select
  m.id,
  c.patient_name,
  c.patient_phone,
  m.send_day,
  m.status,
  m.scheduled_for
from public.messages m
join public.consults c on c.id = m.consult_id
where m.practice_id = 'e26ad518-6b4e-4ccd-b60c-c06740df8ce1'
  and (m.channel = 'call' or m.type = 'call')
  and m.status in ('scheduled', 'pending', 'draft')
  and m.scheduled_for <= (current_date + time '23:59:59')::timestamptz
order by m.scheduled_for;
