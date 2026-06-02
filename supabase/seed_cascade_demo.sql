-- ============================================================================
-- seed_cascade_demo.sql - fill an ACTIVE sub-account with realistic demo data.
-- Targets "Cascade Implant Center" (a real practice under the demo super-admin's
-- agency). Perry Family Dentistry's demo data is locked behind its lapsed
-- subscription, so this gives a clean, payable account to demo on.
--
-- Does, idempotently (re-runnable):
--   1. Activates billing + marks the PMS connected so nothing is paywalled and
--      the schedule/consults views work.
--   2. Seeds 8 consults (every sequence lifecycle state) + their messages.
--   3. Seeds 3 conversations with realistic threads.
--   4. Seeds a PMS day-sheet (pms_appointments) - recorded + not-recorded + missed.
--
-- Seed rows are tagged by patient_email '%@cascade.seedseq.test' and
-- pms_appointment_id 'CASC-APPT-%' and cleared up front. Change TARGET below to
-- seed a different practice (Blue Sky Dental, Spokane Implant Specialists, etc.).
-- Run in the Supabase SQL editor (project eymgqjeudrmeofytnwgs).
-- ============================================================================

-- Column guards (idempotent) - mirror the migrations so this runs on any schema.
alter table public.consults add column if not exists patient_name  text;
alter table public.consults add column if not exists patient_phone text;
alter table public.consults add column if not exists patient_email text;
alter table public.consults add column if not exists outcome text default 'pending';
alter table public.consults add column if not exists outcome_set_at timestamptz;
alter table public.consults add column if not exists sequence_activated_at timestamptz;
alter table public.consults add column if not exists sequence_cancelled_at timestamptz;
alter table public.consults add column if not exists sequence_cancelled_reason text;
alter table public.consults add column if not exists sequence_status text default 'active';
alter table public.consults add column if not exists sequence_paused_reason text;
alter table public.consults add column if not exists case_value numeric;
alter table public.consults add column if not exists objection_type text;
alter table public.consults add column if not exists exit_intent_level text;
alter table public.consults add column if not exists what_happened text;
alter table public.consults add column if not exists treatment_type text;
alter table public.consults add column if not exists attribution_status text;
alter table public.consults add column if not exists attribution_model text;
alter table public.messages add column if not exists send_day int;

do $$
declare
  TARGET text := 'Cascade Implant Center';   -- ← change to seed a different practice
  pid uuid;
  c1 uuid; c2 uuid; c3 uuid; c4 uuid; c5 uuid; c6 uuid; c7 uuid; c8 uuid;
  conv1 uuid; conv2 uuid; conv3 uuid;
  cl2 uuid; cl3 uuid;
begin
  select id into pid from public.practices where name ilike TARGET order by created_at limit 1;
  if pid is null then
    raise exception 'No practice matching % found - run reseller_practices_seed.sql first.', TARGET;
  end if;

  -- 1) Make the account fully usable: active billing + PMS connected.
  update public.practices set
    subscription_status = 'active',
    trial_ends_at      = now() + interval '30 days',
    current_period_end = now() + interval '30 days',
    onboarding_completed = true,
    baa_accepted_at    = coalesce(baa_accepted_at, now()),
    sikka_connected    = true,
    pms_type           = coalesce(pms_type, 'dentrix'),
    pms_last_synced_at = now()
  where id = pid;

  -- 2) Reset prior seed rows (messages cascade with consults).
  delete from public.conversations where practice_id = pid and patient_email like '%@cascade.seedseq.test';
  delete from public.consults      where practice_id = pid and patient_email like '%@cascade.seedseq.test';
  delete from public.pms_appointments where practice_id = pid and pms_appointment_id like 'CASC-APPT-%';

  -- ── 1. ACTIVE - Gregory Pearson (full arch, 2 of 6 sent) ──────────────────
  insert into public.consults
    (practice_id, recording_date, recording_time, duration, transcript, status, sequence_status,
     primary_objection, objection_type, exit_intent, exit_intent_level, what_happened, personal_detail,
     coaching_insight, tc_action, treatment_type, case_value,
     patient_name, patient_phone, patient_email, outcome, sequence_activated_at, created_at)
  values
    (pid, (now() - interval '3 days')::date, time '09:15', 1320,
     'Discussed All-on-4 for upper arch. Cost was the main hesitation.', 'analyzed', 'active',
     'Price', 'price', 'warm', 'warm', 'Patient is a strong full-arch candidate but stalled on the total. Wants to be confident at his son''s wedding this fall.',
     'Son getting married in the fall - wants to smile in photos.',
     'Lead with the wedding timeline and financing before the full number. Dr. Lindqvist can phase if needed.',
     'Call within 24h with a financing breakdown and a photo-ready timeline.', 'full_arch', 38000,
     'Gregory Pearson', '(509) 555-0312', 'gpearson@cascade.seedseq.test', 'pending',
     now() - interval '2 days', now() - interval '3 days')
  returning id into c1;
  insert into public.messages (consult_id, practice_id, type, channel, subject, body, status, send_day, sent_at, scheduled_for, created_at) values
    (c1, pid, 'followup', 'sms',   null, 'Hi Gregory, great meeting you today! I pulled together two ways to make the full-arch work financially. Want me to send them over?', 'sent', 1, now() - interval '3 days', null, now() - interval '3 days'),
    (c1, pid, 'followup', 'email', 'Your treatment options', 'Hi Gregory, attaching the All-on-4 plan plus monthly financing so you can see how affordable it can be. Happy to walk through it anytime.', 'sent', 1, now() - interval '3 days', null, now() - interval '3 days'),
    (c1, pid, 'followup', 'sms',   null, 'Just checking in - any questions on the options? Glad to help however I can.', 'scheduled', 3, null, now() + interval '2 days', now() - interval '3 days'),
    (c1, pid, 'followup', 'email', 'A few patient stories', 'Sharing how a couple of patients in a similar spot decided to move forward.', 'scheduled', 3, null, now() + interval '2 days', now() - interval '3 days'),
    (c1, pid, 'followup', 'sms',   null, 'Hi Gregory, still here whenever you are ready. Want to grab a time to get you scheduled before the wedding?', 'scheduled', 7, null, now() + interval '6 days', now() - interval '3 days'),
    (c1, pid, 'followup', 'email', 'Locking in your timeline', 'Here is the timeline if we start in the next couple of weeks so everything is set for the fall.', 'scheduled', 7, null, now() + interval '6 days', now() - interval '3 days');

  -- ── 2. ACTIVE - Helen Ramirez (single implants, 3 of 6 sent, replied) ─────
  insert into public.consults
    (practice_id, recording_date, recording_time, duration, transcript, status, sequence_status,
     primary_objection, objection_type, exit_intent, exit_intent_level, what_happened,
     coaching_insight, tc_action, treatment_type, case_value,
     patient_name, patient_phone, patient_email, outcome, sequence_activated_at, created_at)
  values
    (pid, (now() - interval '5 days')::date, time '11:00', 1500,
     'Two posterior implants. Wants to discuss with her husband before committing.', 'analyzed', 'active',
     'Spouse', 'spouse', 'warm', 'warm', 'Ready clinically; needs to loop in her husband on the decision.',
     'Offer a joint call so she is not relaying numbers secondhand.',
     'Offer a 3-way call this week with Helen and her husband.', 'dental_implants', 14500,
     'Helen Ramirez', '(509) 555-0327', 'hramirez@cascade.seedseq.test', 'pending',
     now() - interval '4 days', now() - interval '5 days')
  returning id into c2;
  insert into public.messages (consult_id, practice_id, type, channel, subject, body, status, send_day, sent_at, scheduled_for, created_at) values
    (c2, pid, 'followup', 'sms',   null, 'Hi Helen, thanks for coming in. Whenever you and your husband want to talk it through, I am happy to join.', 'sent', 1, now() - interval '5 days', null, now() - interval '5 days'),
    (c2, pid, 'followup', 'email', 'Everything we covered', 'Hi Helen, here is the recap and numbers so you can share them at home. Let me know what questions come up.', 'sent', 1, now() - interval '5 days', null, now() - interval '5 days'),
    (c2, pid, 'followup', 'sms',   null, 'Would a quick joint call this week help? I can answer both of your questions at once.', 'sent', 3, now() - interval '2 days', null, now() - interval '5 days'),
    (c2, pid, 'followup', 'email', 'Two times that could work', 'Sending a couple of openings for a 3-way call - just reply with whichever is easier.', 'scheduled', 7, null, now() + interval '2 days', now() - interval '5 days'),
    (c2, pid, 'followup', 'sms',   null, 'Still glad to set up that call whenever you two are ready, Helen.', 'scheduled', 7, null, now() + interval '2 days', now() - interval '5 days'),
    (c2, pid, 'followup', 'email', 'Financing that fits', 'A quick look at monthly options in case that helps the conversation at home.', 'scheduled', 14, null, now() + interval '9 days', now() - interval '5 days');

  -- ── 3. PENDING (24h activation hold) - Walter Kim (created 6h ago) ────────
  insert into public.consults
    (practice_id, recording_date, recording_time, duration, transcript, status, sequence_status,
     primary_objection, objection_type, exit_intent, exit_intent_level, what_happened,
     coaching_insight, tc_action, treatment_type, case_value,
     patient_name, patient_phone, patient_email, outcome, created_at)
  values
    (pid, now()::date, time '08:30', 1140,
     'Nervous about the procedure, otherwise ready for a single implant.', 'analyzed', 'active',
     'Fear', 'fear', 'hot', 'hot', 'Anxiety is the only blocker - sedation and a calm walkthrough will move this fast.',
     'Acknowledge the nerves first. Lead with sedation and comfort options.',
     'Send the sedation overview and offer to answer any nerves-related questions by text.', 'dental_implants', 6200,
     'Walter Kim', '(509) 555-0341', 'wkim@cascade.seedseq.test', 'pending', now() - interval '6 hours')
  returning id into c3;
  insert into public.messages (consult_id, practice_id, type, channel, subject, body, status, send_day, sent_at, scheduled_for, created_at) values
    (c3, pid, 'followup', 'sms',   null, 'Hi Walter, so glad you came in. I will text you a quick overview of the comfort options we talked about.', 'scheduled', 1, null, now() + interval '18 hours', now() - interval '6 hours'),
    (c3, pid, 'followup', 'email', 'Comfort and sedation options', 'Hi Walter, here is everything on how we keep you comfortable, step by step. No question is too small.', 'scheduled', 1, null, now() + interval '18 hours', now() - interval '6 hours'),
    (c3, pid, 'followup', 'sms',   null, 'Checking in, Walter. Any questions about the procedure or comfort? Happy to help.', 'scheduled', 3, null, now() + interval '2 days', now() - interval '6 hours'),
    (c3, pid, 'followup', 'email', 'What other patients felt', 'A couple of stories from patients who were nervous too, and how it went for them.', 'scheduled', 3, null, now() + interval '2 days', now() - interval '6 hours');

  -- ── 4. PAUSED (stopped by TC) - Denise Albright ───────────────────────────
  insert into public.consults
    (practice_id, recording_date, recording_time, duration, transcript, status, sequence_status, sequence_paused_reason,
     primary_objection, objection_type, exit_intent, exit_intent_level, what_happened,
     coaching_insight, tc_action, treatment_type, case_value,
     patient_name, patient_phone, patient_email, outcome,
     sequence_activated_at, sequence_cancelled_at, sequence_cancelled_reason, created_at)
  values
    (pid, (now() - interval '4 days')::date, time '13:30', 1260,
     'Traveling for two weeks, asked us to hold outreach.', 'analyzed', 'paused', 'Stopped by TC',
     'Timing', 'timing', 'warm', 'warm', 'Asked us to pause while she travels; resume right after she is back.',
     'Respect the pause. Resume the week she returns so it feels attentive, not pushy.',
     'Resume outreach the week she returns with a warm welcome-back message.', 'full_arch', 33000,
     'Denise Albright', '(509) 555-0355', 'dalbright@cascade.seedseq.test', 'pending',
     now() - interval '3 days', now() - interval '1 day', 'Stopped by TC', now() - interval '4 days')
  returning id into c4;
  insert into public.messages (consult_id, practice_id, type, channel, subject, body, status, send_day, sent_at, scheduled_for, created_at) values
    (c4, pid, 'followup', 'sms',   null, 'Hi Denise, great meeting you. I will send over the details we discussed today.', 'sent', 1, now() - interval '4 days', null, now() - interval '4 days'),
    (c4, pid, 'followup', 'email', 'Your treatment summary', 'Hi Denise, here is the full summary and pricing. Safe travels, and we will pick this up when you are back.', 'sent', 1, now() - interval '4 days', null, now() - interval '4 days'),
    (c4, pid, 'followup', 'sms',   null, 'Welcome back, Denise! Ready to find a time whenever you are.', 'scheduled', 7, null, now() + interval '5 days', now() - interval '4 days'),
    (c4, pid, 'followup', 'email', 'Financing reminder', 'A quick reminder of the financing options in case it helps your decision.', 'scheduled', 14, null, now() + interval '10 days', now() - interval '4 days');

  -- ── 5. COMPLETED (accepted mid-sequence) - Frank Donovan ──────────────────
  insert into public.consults
    (practice_id, recording_date, recording_time, duration, transcript, status, sequence_status,
     primary_objection, objection_type, exit_intent, exit_intent_level, what_happened,
     coaching_insight, tc_action, treatment_type, case_value,
     patient_name, patient_phone, patient_email, outcome, outcome_set_at,
     attribution_status, attribution_model,
     sequence_activated_at, sequence_cancelled_at, sequence_cancelled_reason, created_at)
  values
    (pid, (now() - interval '7 days')::date, time '15:00', 1380,
     'Ready to proceed on full arch once financing was clarified.', 'closed_won', 'cancelled',
     'Price', 'price', 'hot', 'hot', 'Financing closed this one - accepted after the monthly breakdown.',
     'Financing closed this one. Note the plan that worked for similar future cases.',
     'Schedule surgical date and send pre-op instructions.', 'full_arch', 36500,
     'Frank Donovan', '(509) 555-0368', 'fdonovan@cascade.seedseq.test', 'accepted', now() - interval '5 days',
     'consultiq_recovered', 'consultiq_recovered',
     now() - interval '6 days', now() - interval '5 days', 'accepted', now() - interval '7 days')
  returning id into c5;
  insert into public.messages (consult_id, practice_id, type, channel, subject, body, status, send_day, sent_at, scheduled_for, created_at) values
    (c5, pid, 'followup', 'sms',   null, 'Hi Frank, wonderful meeting you! Sending the plan and financing now.', 'sent', 1, now() - interval '7 days', null, now() - interval '7 days'),
    (c5, pid, 'followup', 'email', 'Your plan and financing', 'Hi Frank, here is everything we discussed plus the monthly options. Let me know your questions.', 'sent', 1, now() - interval '7 days', null, now() - interval '7 days'),
    (c5, pid, 'followup', 'sms',   null, 'Following up on the financing, Frank. The monthly option we talked about is still available.', 'sent', 3, now() - interval '5 days', null, now() - interval '7 days'),
    (c5, pid, 'followup', 'sms',   null, 'This message was cancelled because the patient accepted treatment.', 'cancelled', 7, null, null, now() - interval '7 days'),
    (c5, pid, 'followup', 'email', 'This message was cancelled because the patient accepted treatment.', 'This message was cancelled because the patient accepted treatment.', 'cancelled', 7, null, null, now() - interval '7 days');

  -- ── 6. COMPLETED (ran full course) - Yolanda Pierce ───────────────────────
  insert into public.consults
    (practice_id, recording_date, recording_time, duration, transcript, status, sequence_status,
     primary_objection, objection_type, exit_intent, exit_intent_level, what_happened,
     coaching_insight, tc_action, treatment_type, case_value,
     patient_name, patient_phone, patient_email, outcome, created_at)
  values
    (pid, (now() - interval '20 days')::date, time '10:00', 1200,
     'Considering options, no firm objection. Long-term lead.', 'analyzed', 'active',
     'Timing', 'timing', 'long_term', 'long_term', 'No firm objection; keep a light nurture cadence and revisit next quarter.',
     'Long-term lead. Keep a light nurture cadence and revisit in 90 days.',
     'Add to long-term nurture and check back in 90 days.', 'invisalign', 6500,
     'Yolanda Pierce', '(509) 555-0374', 'ypierce@cascade.seedseq.test', 'pending', now() - interval '20 days')
  returning id into c6;
  insert into public.messages (consult_id, practice_id, type, channel, subject, body, status, send_day, sent_at, scheduled_for, created_at) values
    (c6, pid, 'followup', 'sms',   null, 'Hi Yolanda, lovely meeting you. Sending the options we reviewed.', 'sent', 1, now() - interval '20 days', null, now() - interval '20 days'),
    (c6, pid, 'followup', 'email', 'Your options', 'Hi Yolanda, here is the summary and pricing from today. No rush at all.', 'sent', 1, now() - interval '20 days', null, now() - interval '20 days'),
    (c6, pid, 'followup', 'sms',   null, 'Just checking in, Yolanda. Any questions on the plan?', 'sent', 3, now() - interval '18 days', null, now() - interval '20 days'),
    (c6, pid, 'followup', 'email', 'Here when you are ready', 'No pressure. Whenever you want to revisit, we will pick right back up.', 'sent', 7, now() - interval '14 days', null, now() - interval '20 days');

  -- ── 7. CANCELLED (not a fit) - Curtis Maldonado ───────────────────────────
  insert into public.consults
    (practice_id, recording_date, recording_time, duration, transcript, status, sequence_status,
     primary_objection, objection_type, exit_intent, exit_intent_level, what_happened, personal_detail,
     coaching_insight, tc_action, treatment_type, case_value,
     patient_name, patient_phone, patient_email, outcome, outcome_set_at,
     sequence_activated_at, sequence_cancelled_at, sequence_cancelled_reason, created_at)
  values
    (pid, (now() - interval '8 days')::date, time '09:00', 1080,
     'Went with a competitor on price.', 'closed_lost', 'cancelled',
     'Price', 'price', 'warm', 'warm', 'Comparison shopping; chose a lower-cost provider.', 'Comparison shopping on price.',
     'Lost on price to a lower-cost provider. Consider a sharper financing lead next time.',
     'No further outreach. Log the price gap for the practice.', 'dental_implants', 0,
     'Curtis Maldonado', '(509) 555-0389', 'cmaldonado@cascade.seedseq.test', 'not_converting', now() - interval '6 days',
     now() - interval '7 days', now() - interval '6 days', 'not_converting', now() - interval '8 days')
  returning id into c7;
  insert into public.messages (consult_id, practice_id, type, channel, subject, body, status, send_day, sent_at, scheduled_for, created_at) values
    (c7, pid, 'followup', 'sms',   null, 'Hi Curtis, great meeting you today. Sending the details we discussed.', 'sent', 1, now() - interval '8 days', null, now() - interval '8 days'),
    (c7, pid, 'followup', 'email', 'Your treatment plan', 'Hi Curtis, here is the full plan and pricing. Happy to answer anything.', 'sent', 1, now() - interval '8 days', null, now() - interval '8 days'),
    (c7, pid, 'followup', 'sms',   null, 'This message was cancelled because the patient was marked not a fit.', 'cancelled', 3, null, null, now() - interval '8 days'),
    (c7, pid, 'followup', 'email', 'This message was cancelled because the patient was marked not a fit.', 'This message was cancelled because the patient was marked not a fit.', 'cancelled', 7, null, null, now() - interval '8 days');

  -- ── 8. PAUSED (rescheduled, resumes Day 30) - Bianca Russo ────────────────
  insert into public.consults
    (practice_id, recording_date, recording_time, duration, transcript, status, sequence_status, sequence_paused_reason,
     primary_objection, objection_type, exit_intent, exit_intent_level, what_happened,
     coaching_insight, tc_action, treatment_type, case_value,
     patient_name, patient_phone, patient_email, outcome, outcome_set_at,
     sequence_activated_at, created_at)
  values
    (pid, (now() - interval '10 days')::date, time '10:30', 1320,
     'Asked to revisit after the new year.', 'analyzed', 'paused', 'Rescheduled - resumes Day 30',
     'Timing', 'timing', 'long_term', 'long_term', 'Wants to revisit after the holidays; re-engage at Day 30.',
     'Re-engage at Day 30 with a fresh, low-pressure check-in.',
     'Pause active outreach. Re-engagement picks up at Day 30.', 'full_mouth_rehab', 24000,
     'Bianca Russo', '(509) 555-0396', 'brusso@cascade.seedseq.test', 'rescheduled', now() - interval '6 days',
     now() - interval '9 days', now() - interval '10 days')
  returning id into c8;
  insert into public.messages (consult_id, practice_id, type, channel, subject, body, status, send_day, sent_at, scheduled_for, created_at) values
    (c8, pid, 'followup', 'sms',   null, 'Hi Bianca, great meeting you. Sending the plan we talked through.', 'sent', 1, now() - interval '10 days', null, now() - interval '10 days'),
    (c8, pid, 'followup', 'email', 'Your treatment options', 'Hi Bianca, here is everything from today. We will revisit after the new year as you asked.', 'sent', 1, now() - interval '10 days', null, now() - interval '10 days'),
    (c8, pid, 'followup', 'email', 'Checking back in', 'Hi Bianca, circling back as promised. Would love to help whenever you are ready.', 'scheduled', 30, null, now() + interval '20 days', now() - interval '10 days');

  -- 3) Conversations ----------------------------------------------------------
  -- Active thread: Helen replied (unread) - links to her consult.
  insert into public.conversations
    (practice_id, patient_first, patient_last, patient_phone, patient_email, consult_id, last_message_at, unread_count, last_message_preview, created_at)
  values
    (pid, 'Helen', 'Ramirez', '(509) 555-0327', 'hramirez@cascade.seedseq.test', c2,
     now() - interval '3 hours', 1, 'My husband is on board - can we set up that call?', now() - interval '5 days')
  returning id into conv1;
  insert into public.conversation_messages (conversation_id, direction, channel, body, sent_at, created_at) values
    (conv1, 'outbound', 'sms', 'Hi Helen, it was great meeting you! Want me to text over the options we discussed?', now() - interval '5 days', now() - interval '5 days'),
    (conv1, 'inbound',  'sms', 'Yes please, thank you!', now() - interval '5 days' + interval '20 minutes', now() - interval '5 days' + interval '20 minutes'),
    (conv1, 'outbound', 'sms', 'Would a quick joint call this week help? I can answer both of your questions at once.', now() - interval '2 days', now() - interval '2 days'),
    (conv1, 'inbound',  'sms', 'My husband is on board - can we set up that call?', now() - interval '3 hours', now() - interval '3 hours');

  -- Converted thread: Frank, closed.
  insert into public.conversations
    (practice_id, patient_first, patient_last, patient_phone, patient_email, consult_id, last_message_at, unread_count, last_message_preview, created_at)
  values
    (pid, 'Frank', 'Donovan', '(509) 555-0368', 'fdonovan@cascade.seedseq.test', c5,
     now() - interval '5 days', 0, 'Perfect, see you then. Thank you!', now() - interval '7 days')
  returning id into conv2;
  insert into public.conversation_messages (conversation_id, direction, channel, body, sent_at, created_at) values
    (conv2, 'outbound', 'sms', 'Hi Frank, wonderful meeting you! Sending the plan and financing now.', now() - interval '7 days', now() - interval '7 days'),
    (conv2, 'inbound',  'sms', 'Thanks! The monthly option looks doable.', now() - interval '6 days', now() - interval '6 days'),
    (conv2, 'outbound', 'sms', 'Great news! I have you down for your surgical consult. Anything you need beforehand?', now() - interval '5 days', now() - interval '5 days'),
    (conv2, 'inbound',  'sms', 'Perfect, see you then. Thank you!', now() - interval '5 days', now() - interval '5 days');

  -- Nervous-patient thread: Walter (pending).
  insert into public.conversations
    (practice_id, patient_first, patient_last, patient_phone, patient_email, consult_id, last_message_at, unread_count, last_message_preview, created_at)
  values
    (pid, 'Walter', 'Kim', '(509) 555-0341', 'wkim@cascade.seedseq.test', c3,
     now() - interval '5 hours', 1, 'Honestly the needles scare me more than anything.', now() - interval '6 hours')
  returning id into conv3;
  insert into public.conversation_messages (conversation_id, direction, channel, body, sent_at, created_at) values
    (conv3, 'outbound', 'sms', 'Hi Walter, so glad you came in. Totally normal to feel nervous - we have great comfort options. What worries you most?', now() - interval '6 hours', now() - interval '6 hours'),
    (conv3, 'inbound',  'sms', 'Honestly the needles scare me more than anything.', now() - interval '5 hours', now() - interval '5 hours');

  -- 4) PMS day-sheet (pms_appointments): recorded (linked), not-recorded, missed.
  insert into public.pms_appointments
    (practice_id, pms_appointment_id, patient_first, patient_last, patient_phone, patient_email,
     appointment_time, appointment_type, provider, duration_minutes, is_implant_consult, consult_id)
  values
    -- Today - two recorded (linked to consults), two still to record.
    (pid, 'CASC-APPT-1', 'Walter',  'Kim',      '(509) 555-0341', 'wkim@cascade.seedseq.test',      (now()::date + time '08:30'), 'Implant Consult', 'Dr. Lindqvist', 60, true, c3),
    (pid, 'CASC-APPT-2', 'Gregory', 'Pearson',  '(509) 555-0312', 'gpearson@cascade.seedseq.test',  (now()::date + time '09:15'), 'Implant Consult', 'Dr. Lindqvist', 60, true, c1),
    (pid, 'CASC-APPT-3', 'Marcus',  'Webb',     '(509) 555-0401', 'mwebb@cascade.seedseq.test',     (now()::date + time '11:00'), 'Implant Consult', 'Dr. Lindqvist', 60, true, null),
    (pid, 'CASC-APPT-4', 'Sofia',   'Navarro',  '(509) 555-0412', 'snavarro@cascade.seedseq.test',  (now()::date + time '14:00'), 'Full Arch Consult', 'Dr. Lindqvist', 90, true, null),
    -- Tomorrow - upcoming.
    (pid, 'CASC-APPT-5', 'Derek',   'Olsen',    '(509) 555-0423', 'dolsen@cascade.seedseq.test',    ((now()::date + 1) + time '09:00'), 'Implant Consult', 'Dr. Lindqvist', 60, true, null),
    (pid, 'CASC-APPT-6', 'Priya',   'Anand',    '(509) 555-0434', 'panand@cascade.seedseq.test',    ((now()::date + 1) + time '10:30'), 'Implant Consult', 'Dr. Lindqvist', 60, true, null),
    -- Two days out.
    (pid, 'CASC-APPT-7', 'Leon',    'Carter',   '(509) 555-0445', 'lcarter@cascade.seedseq.test',   ((now()::date + 2) + time '13:30'), 'Full Arch Consult', 'Dr. Lindqvist', 90, true, null),
    -- Yesterday - missed (never recorded).
    (pid, 'CASC-APPT-8', 'Janet',   'Fowler',   '(509) 555-0456', 'jfowler@cascade.seedseq.test',   ((now()::date - 1) + time '15:00'), 'Implant Consult', 'Dr. Lindqvist', 60, true, null);

  -- 5) Power Dialer - call touchpoints due today on the open consults so the
  --    dialer queue (messages where channel/type='call', scheduled today) is full.
  insert into public.messages (consult_id, practice_id, type, channel, subject, body, status, send_day, scheduled_for, created_at) values
    (c1, pid, 'call', 'call', null, 'Call: walk Gregory through financing + the monthly breakdown; tie it to the wedding timeline.', 'scheduled', 3, now(), now()),
    (c2, pid, 'call', 'call', null, 'Call: offer Helen a quick joint call so she and her husband hear the same numbers.', 'scheduled', 3, now(), now()),
    (c3, pid, 'call', 'call', null, 'Call: reassure Walter on sedation/comfort, keep it warm and low-pressure.', 'scheduled', 1, now(), now()),
    (c6, pid, 'call', 'call', null, 'Call: friendly check-in with Yolanda; no pressure, offer to get her scheduled when ready.', 'scheduled', 7, now(), now());

  -- 6) Recent calls (call_logs) so the dialer's "Recent calls" list is populated.
  --    No recording_url (no real Twilio recording exists yet) → shown as "No
  --    recording"; real calls placed in-app will have a playable recording.
  delete from public.call_logs where practice_id = pid and twilio_call_sid like 'SEED-CASC-%';
  -- Gregory + Yolanda: calls without a conversation thread (appear in Recent calls only).
  insert into public.call_logs (practice_id, consult_id, twilio_call_sid, direction, to_number, from_number, status, disposition, notes, duration_seconds, started_at, ended_at, created_at) values
    (pid, c1, 'SEED-CASC-1', 'outbound', '(509) 555-0312', '+15095550100', 'completed', 'scheduled', 'Reached, scheduled the surgical consult.', 214, now() - interval '2 hours', now() - interval '2 hours' + interval '214 seconds', now() - interval '2 hours'),
    (pid, c6, 'SEED-CASC-4', 'outbound', '(509) 555-0374', '+15095550100', 'completed', 'no_answer', 'No answer.', 0, now() - interval '1 day' - interval '3 hours', now() - interval '1 day' - interval '3 hours', now() - interval '1 day' - interval '3 hours');
  -- Helen + Walter: calls tied to their conversation threads → show inline with SMS.
  insert into public.call_logs (practice_id, consult_id, conversation_id, twilio_call_sid, direction, to_number, from_number, status, disposition, notes, duration_seconds, started_at, ended_at, created_at)
    values (pid, c2, conv1, 'SEED-CASC-2', 'outbound', '(509) 555-0327', '+15095550100', 'completed', 'followup', 'Reached; will loop in husband, joint call Thursday.', 175, now() - interval '5 hours', now() - interval '5 hours' + interval '175 seconds', now() - interval '5 hours')
    returning id into cl2;
  insert into public.call_logs (practice_id, consult_id, conversation_id, twilio_call_sid, direction, to_number, from_number, status, disposition, notes, duration_seconds, started_at, ended_at, created_at)
    values (pid, c3, conv3, 'SEED-CASC-3', 'outbound', '(509) 555-0341', '+15095550100', 'completed', 'voicemail', 'Left voicemail about sedation and comfort options.', 38, now() - interval '4 hours', now() - interval '4 hours' + interval '38 seconds', now() - interval '4 hours')
    returning id into cl3;
  -- Inline call entries in the threads (channel='call' renders as a centered pill).
  insert into public.conversation_messages (conversation_id, direction, channel, body, sent_at, created_at, meta, call_log_id) values
    (conv1, 'outbound', 'call', 'Outbound call · reached', now() - interval '5 hours', now() - interval '5 hours',
      jsonb_build_object('outcome', 'Reached, following up', 'duration_sec', 175, 'note', 'Looping in husband; joint call Thursday.', 'actor', 'Sara'), cl2),
    (conv3, 'outbound', 'call', 'Outbound call · left voicemail', now() - interval '4 hours', now() - interval '4 hours',
      jsonb_build_object('outcome', 'Left voicemail', 'duration_sec', 38, 'note', 'Voicemail re: sedation and comfort options.', 'actor', 'Sara'), cl3);

  raise notice 'Seeded demo data for % (8 consults, 3 conversations, 8 appointments, 4 dialer calls, 4 call logs, 2 inline call entries)', TARGET;
end $$;
