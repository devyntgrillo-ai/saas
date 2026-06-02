-- ============================================================================
-- Seed example follow-up SEQUENCES for the Sequences page.
-- Creates 8 consults (each with messages) for "Perry Family Dentistry" so the
-- /sequences tab shows one row of every lifecycle state:
--   Active x2 · Pending (24h hold) x1 · Paused x2 · Completed x2 · Cancelled x1
--
-- Repeatable: seed rows are tagged by patient_email ending in '@seedseq.test'
-- and deleted up front (messages cascade via consults FK on delete cascade).
--
-- Run in the Supabase SQL editor (project eymgqjeudrmeofytnwgs).
-- consults cols: practice_id, recording_date, recording_time, duration,
--   transcript, status, primary_objection, secondary_objection, exit_intent,
--   personal_detail, coaching_insight, downsell_opportunity, tc_action,
--   patient_name, patient_phone, patient_email, outcome, outcome_set_at,
--   sequence_activated_at, sequence_cancelled_at, sequence_cancelled_reason,
--   created_at.
-- messages cols: consult_id, practice_id, type, channel, subject, body,
--   status, scheduled_for, sent_at, send_day, created_at.
-- ============================================================================

-- Ensure the patient / outcome / scheduling columns exist. Idempotent; mirrors
-- migrations 20260529020000 (patient fields), 060000 (outcome) and 080000
-- (send_day) in case they have not been applied to this database yet.
alter table public.consults add column if not exists patient_name  text;
alter table public.consults add column if not exists patient_phone text;
alter table public.consults add column if not exists patient_email text;
alter table public.consults add column if not exists outcome text default 'pending';
alter table public.consults add column if not exists outcome_note text;
alter table public.consults add column if not exists outcome_set_at timestamptz;
alter table public.consults add column if not exists outcome_set_by uuid references auth.users(id);
alter table public.consults add column if not exists sequence_activated_at timestamptz;
alter table public.consults add column if not exists sequence_cancelled_at timestamptz;
alter table public.consults add column if not exists sequence_cancelled_reason text;
alter table public.consults drop constraint if exists consults_outcome_check;
alter table public.consults add constraint consults_outcome_check
  check (outcome in ('pending', 'accepted', 'not_converting', 'rescheduled', 'closed_won'));
alter table public.messages add column if not exists send_day int;

do $$
declare
  pid uuid;
  c1 uuid; c2 uuid; c3 uuid; c4 uuid; c5 uuid; c6 uuid; c7 uuid; c8 uuid;
begin
  select id into pid from public.practices where name ilike '%Perry%' order by created_at limit 1;
  if pid is null then
    raise exception 'No practice matching %%Perry%% found - run the reseller practices seed first.';
  end if;

  -- Reset prior seed rows (messages cascade on consult delete).
  delete from public.consults where practice_id = pid and patient_email like '%@seedseq.test';

  -- Shared analysis fields keep the linked consult detail looking complete.
  -- ── 1. ACTIVE - Margaret Chen (created 3 days ago, 2 of 6 sent) ─────────────
  insert into public.consults
    (practice_id, recording_date, recording_time, duration, transcript, status,
     primary_objection, secondary_objection, exit_intent, personal_detail,
     coaching_insight, downsell_opportunity, tc_action,
     patient_name, patient_phone, patient_email, outcome, sequence_activated_at, created_at)
  values
    (pid, (now() - interval '3 days')::date, time '09:15', 1320,
     'Patient discussed full arch options and cost concerns.', 'analyzed',
     'Price', 'Timing', 'warm', 'Daughter getting married in the fall, wants to be confident smiling in photos.',
     'Lead with the photo-ready timeline tied to the wedding. Reassure on financing before quoting the full number.',
     'Offer a single-arch phased plan if full arch stalls on price.',
     'Call within 24h with a financing breakdown and a photo timeline.',
     'Margaret Chen', '(509) 555-0182', 'margaret.chen@seedseq.test', 'pending',
     now() - interval '2 days', now() - interval '3 days')
  returning id into c1;

  insert into public.messages (consult_id, practice_id, type, channel, subject, body, status, send_day, sent_at, scheduled_for, created_at) values
    (c1, pid, 'followup', 'sms',   null, 'Hi Margaret, it was great meeting you today! I put together a couple of options for you. Want me to text them over?', 'sent', 1, now() - interval '3 days', null, now() - interval '3 days'),
    (c1, pid, 'followup', 'email', 'Your treatment options', 'Hi Margaret, attaching the two plans we discussed along with financing. Happy to walk through them whenever works.', 'sent', 1, now() - interval '3 days', null, now() - interval '3 days'),
    (c1, pid, 'followup', 'sms',   null, 'Just checking in, did you get a chance to look over the options? Glad to answer any questions.', 'scheduled', 3, null, now() + interval '2 days', now() - interval '3 days'),
    (c1, pid, 'followup', 'email', 'A few patient stories', 'Wanted to share a couple of patients who were in a similar spot and how their treatment went.', 'scheduled', 3, null, now() + interval '2 days', now() - interval '3 days'),
    (c1, pid, 'followup', 'sms',   null, 'Hi Margaret, still here whenever you are ready. Want to grab a time to get you scheduled?', 'scheduled', 7, null, now() + interval '6 days', now() - interval '3 days'),
    (c1, pid, 'followup', 'email', 'Locking in your timeline', 'With the wedding coming up, here is the timeline if we start treatment in the next couple of weeks.', 'scheduled', 7, null, now() + interval '6 days', now() - interval '3 days');

  -- ── 2. ACTIVE - Robert Delgado (created 5 days ago, 3 of 6 sent) ────────────
  insert into public.consults
    (practice_id, recording_date, recording_time, duration, transcript, status,
     primary_objection, exit_intent, coaching_insight, tc_action,
     patient_name, patient_phone, patient_email, outcome, sequence_activated_at, created_at)
  values
    (pid, (now() - interval '5 days')::date, time '11:00', 1500,
     'Patient wants to consult spouse before committing to full arch.', 'analyzed',
     'Spouse', 'warm', 'Make it easy to loop in his wife - offer a joint call so he is not relaying numbers secondhand.',
     'Offer a 3-way call this week with Robert and his wife.',
     'Robert Delgado', '(512) 555-0211', 'robert.delgado@seedseq.test', 'pending',
     now() - interval '4 days', now() - interval '5 days')
  returning id into c2;

  insert into public.messages (consult_id, practice_id, type, channel, subject, body, status, send_day, sent_at, scheduled_for, created_at) values
    (c2, pid, 'followup', 'sms',   null, 'Hi Robert, thanks for coming in today. Whenever you and your wife want to talk it through, I am happy to join.', 'sent', 1, now() - interval '5 days', null, now() - interval '5 days'),
    (c2, pid, 'followup', 'email', 'Everything we covered', 'Hi Robert, here is a recap and the numbers so you can share them at home. Let me know what questions come up.', 'sent', 1, now() - interval '5 days', null, now() - interval '5 days'),
    (c2, pid, 'followup', 'sms',   null, 'Would a quick joint call this week help? I can answer both of your questions at once.', 'sent', 3, now() - interval '2 days', null, now() - interval '5 days'),
    (c2, pid, 'followup', 'email', 'Two times that could work', 'Sending a couple of openings for a 3-way call. Just reply with whichever is easier.', 'scheduled', 7, null, now() + interval '2 days', now() - interval '5 days'),
    (c2, pid, 'followup', 'sms',   null, 'Still glad to set up that call whenever you two are ready, Robert.', 'scheduled', 7, null, now() + interval '2 days', now() - interval '5 days'),
    (c2, pid, 'followup', 'email', 'Financing that fits', 'A quick look at monthly options in case that helps the conversation at home.', 'scheduled', 14, null, now() + interval '9 days', now() - interval '5 days');

  -- ── 3. PENDING (24h activation hold) - Linda Foster (created 6h ago) ────────
  insert into public.consults
    (practice_id, recording_date, recording_time, duration, transcript, status,
     primary_objection, exit_intent, coaching_insight, tc_action,
     patient_name, patient_phone, patient_email, outcome, created_at)
  values
    (pid, now()::date, time '08:30', 1140,
     'Patient nervous about the procedure, otherwise ready.', 'analyzed',
     'Fear', 'hot', 'Acknowledge the nerves first. Sedation options and a calm walkthrough will move this fast.',
     'Send the sedation overview and offer to answer any nerves-related questions by text.',
     'Linda Foster', '(509) 555-0193', 'lfoster@seedseq.test', 'pending', now() - interval '6 hours')
  returning id into c3;

  insert into public.messages (consult_id, practice_id, type, channel, subject, body, status, send_day, sent_at, scheduled_for, created_at) values
    (c3, pid, 'followup', 'sms',   null, 'Hi Linda, so glad you came in. I will text you a quick overview of the comfort options we talked about.', 'scheduled', 1, null, now() + interval '18 hours', now() - interval '6 hours'),
    (c3, pid, 'followup', 'email', 'Comfort and sedation options', 'Hi Linda, here is everything on how we keep you comfortable, step by step. No question is too small.', 'scheduled', 1, null, now() + interval '18 hours', now() - interval '6 hours'),
    (c3, pid, 'followup', 'sms',   null, 'Checking in, Linda. Any questions about the procedure or comfort? Happy to help.', 'scheduled', 3, null, now() + interval '2 days', now() - interval '6 hours'),
    (c3, pid, 'followup', 'email', 'What other patients felt', 'A couple of stories from patients who were nervous too, and how it went for them.', 'scheduled', 3, null, now() + interval '2 days', now() - interval '6 hours'),
    (c3, pid, 'followup', 'sms',   null, 'Whenever you feel ready, Linda, I can get you on the schedule. No rush at all.', 'scheduled', 7, null, now() + interval '6 days', now() - interval '6 hours'),
    (c3, pid, 'followup', 'email', 'Here when you are ready', 'No pressure at all. When the timing feels right, we will make this easy and comfortable.', 'scheduled', 7, null, now() + interval '6 days', now() - interval '6 hours');

  -- ── 4. PAUSED (stopped by TC) - James Whitfield (created 4 days ago) ────────
  insert into public.consults
    (practice_id, recording_date, recording_time, duration, transcript, status,
     primary_objection, exit_intent, coaching_insight, tc_action,
     patient_name, patient_phone, patient_email, outcome,
     sequence_activated_at, sequence_cancelled_at, sequence_cancelled_reason, created_at)
  values
    (pid, (now() - interval '4 days')::date, time '13:30', 1260,
     'Patient traveling for two weeks, asked us to hold outreach.', 'analyzed',
     'Timing', 'warm', 'Respect the pause he asked for. Resume right after he is back so it feels attentive, not pushy.',
     'Resume outreach the week he returns with a warm welcome-back message.',
     'James Whitfield', '(208) 555-0147', 'jwhitfield@seedseq.test', 'pending',
     now() - interval '3 days', now() - interval '1 day', 'Stopped by TC', now() - interval '4 days')
  returning id into c4;

  insert into public.messages (consult_id, practice_id, type, channel, subject, body, status, send_day, sent_at, scheduled_for, created_at) values
    (c4, pid, 'followup', 'sms',   null, 'Hi James, great meeting you. I will send over the details we discussed today.', 'sent', 1, now() - interval '4 days', null, now() - interval '4 days'),
    (c4, pid, 'followup', 'email', 'Your treatment summary', 'Hi James, here is the full summary and pricing. Safe travels, and we will pick this up when you are back.', 'sent', 1, now() - interval '4 days', null, now() - interval '4 days'),
    (c4, pid, 'followup', 'sms',   null, 'Welcome back, James! Ready to find a time whenever you are.', 'scheduled', 3, null, now() + interval '1 day', now() - interval '4 days'),
    (c4, pid, 'followup', 'email', 'Picking back up', 'Hope the trip was great. Here are a few openings if you would like to move forward.', 'scheduled', 7, null, now() + interval '5 days', now() - interval '4 days'),
    (c4, pid, 'followup', 'sms',   null, 'Still glad to get you scheduled whenever the timing is right.', 'scheduled', 7, null, now() + interval '5 days', now() - interval '4 days'),
    (c4, pid, 'followup', 'email', 'Financing reminder', 'A quick reminder of the financing options in case it helps your decision.', 'scheduled', 14, null, now() + interval '10 days', now() - interval '4 days');

  -- ── 5. COMPLETED (accepted mid-sequence) - Sandra Nguyen (created 7 days ago)
  insert into public.consults
    (practice_id, recording_date, recording_time, duration, transcript, status,
     primary_objection, exit_intent, coaching_insight, tc_action,
     patient_name, patient_phone, patient_email, outcome, outcome_set_at,
     sequence_activated_at, sequence_cancelled_at, sequence_cancelled_reason, created_at)
  values
    (pid, (now() - interval '7 days')::date, time '15:00', 1380,
     'Patient ready to proceed after financing was clarified.', 'analyzed',
     'Price', 'hot', 'Financing closed this one. Note the plan that worked for similar future cases.',
     'Schedule surgical date and send pre-op instructions.',
     'Sandra Nguyen', '(509) 555-0229', 'snguyen@seedseq.test', 'accepted', now() - interval '5 days',
     now() - interval '6 days', now() - interval '5 days', 'accepted', now() - interval '7 days')
  returning id into c5;

  insert into public.messages (consult_id, practice_id, type, channel, subject, body, status, send_day, sent_at, scheduled_for, created_at) values
    (c5, pid, 'followup', 'sms',   null, 'Hi Sandra, wonderful meeting you! Sending the plan and financing now.', 'sent', 1, now() - interval '7 days', null, now() - interval '7 days'),
    (c5, pid, 'followup', 'email', 'Your plan and financing', 'Hi Sandra, here is everything we discussed plus the monthly options. Let me know your questions.', 'sent', 1, now() - interval '7 days', null, now() - interval '7 days'),
    (c5, pid, 'followup', 'sms',   null, 'Following up on the financing, Sandra. The monthly option we talked about is still available.', 'sent', 3, now() - interval '5 days', null, now() - interval '7 days'),
    (c5, pid, 'followup', 'email', 'Ready when you are', 'Great news on getting you started. Here are the next steps once you are set.', 'sent', 3, now() - interval '5 days', null, now() - interval '7 days'),
    (c5, pid, 'followup', 'sms',   null, 'This message was cancelled because the patient accepted treatment.', 'cancelled', 7, null, null, now() - interval '7 days'),
    (c5, pid, 'followup', 'email', 'This message was cancelled because the patient accepted treatment.', 'This message was cancelled because the patient accepted treatment.', 'cancelled', 7, null, null, now() - interval '7 days');

  -- ── 6. COMPLETED (ran full course) - Patricia Gomez (created 20 days ago) ───
  insert into public.consults
    (practice_id, recording_date, recording_time, duration, transcript, status,
     primary_objection, exit_intent, coaching_insight, tc_action,
     patient_name, patient_phone, patient_email, outcome, created_at)
  values
    (pid, (now() - interval '20 days')::date, time '10:00', 1200,
     'Patient considering options, no firm objection.', 'analyzed',
     'Timing', 'long_term', 'Long-term lead. Keep a light nurture cadence and revisit in a quarter.',
     'Add to long-term nurture and check back in 90 days.',
     'Patricia Gomez', '(509) 555-0134', 'pgomez@seedseq.test', 'pending', now() - interval '20 days')
  returning id into c6;

  insert into public.messages (consult_id, practice_id, type, channel, subject, body, status, send_day, sent_at, scheduled_for, created_at) values
    (c6, pid, 'followup', 'sms',   null, 'Hi Patricia, lovely meeting you. Sending the options we reviewed.', 'sent', 1, now() - interval '20 days', null, now() - interval '20 days'),
    (c6, pid, 'followup', 'email', 'Your options', 'Hi Patricia, here is the summary and pricing from today. No rush at all.', 'sent', 1, now() - interval '20 days', null, now() - interval '20 days'),
    (c6, pid, 'followup', 'sms',   null, 'Just checking in, Patricia. Any questions on the plan?', 'sent', 3, now() - interval '18 days', null, now() - interval '20 days'),
    (c6, pid, 'followup', 'email', 'A few patient stories', 'Sharing how a few similar patients approached their decision.', 'sent', 3, now() - interval '18 days', null, now() - interval '20 days'),
    (c6, pid, 'followup', 'sms',   null, 'Still here whenever the timing feels right, Patricia.', 'sent', 7, now() - interval '14 days', null, now() - interval '20 days'),
    (c6, pid, 'followup', 'email', 'Here when you are ready', 'No pressure. Whenever you want to revisit, we will pick right back up.', 'sent', 7, now() - interval '14 days', null, now() - interval '20 days');

  -- ── 7. CANCELLED (not a fit) - Thomas Rivera (created 8 days ago) ───────────
  insert into public.consults
    (practice_id, recording_date, recording_time, duration, transcript, status,
     primary_objection, exit_intent, personal_detail, coaching_insight, tc_action,
     patient_name, patient_phone, patient_email, outcome, outcome_note, outcome_set_at,
     sequence_activated_at, sequence_cancelled_at, sequence_cancelled_reason, created_at)
  values
    (pid, (now() - interval '8 days')::date, time '09:00', 1080,
     'Patient went with a competitor on price.', 'analyzed',
     'Price', 'warm', 'Comparison shopping on price.',
     'Lost on price to a lower-cost provider. Consider a sharper financing lead next time.',
     'No further outreach. Log the price gap for the practice.',
     'Thomas Rivera', '(208) 555-0163', 'tom.rivera@seedseq.test', 'not_converting',
     'Went with a competitor on price.', now() - interval '6 days',
     now() - interval '7 days', now() - interval '6 days', 'not_converting', now() - interval '8 days')
  returning id into c7;

  insert into public.messages (consult_id, practice_id, type, channel, subject, body, status, send_day, sent_at, scheduled_for, created_at) values
    (c7, pid, 'followup', 'sms',   null, 'Hi Thomas, great meeting you today. Sending the details we discussed.', 'sent', 1, now() - interval '8 days', null, now() - interval '8 days'),
    (c7, pid, 'followup', 'email', 'Your treatment plan', 'Hi Thomas, here is the full plan and pricing. Happy to answer anything.', 'sent', 1, now() - interval '8 days', null, now() - interval '8 days'),
    (c7, pid, 'followup', 'sms',   null, 'This message was cancelled because the patient was marked not a fit.', 'cancelled', 3, null, null, now() - interval '8 days'),
    (c7, pid, 'followup', 'email', 'This message was cancelled because the patient was marked not a fit.', 'This message was cancelled because the patient was marked not a fit.', 'cancelled', 3, null, null, now() - interval '8 days'),
    (c7, pid, 'followup', 'sms',   null, 'This message was cancelled because the patient was marked not a fit.', 'cancelled', 7, null, null, now() - interval '8 days'),
    (c7, pid, 'followup', 'email', 'This message was cancelled because the patient was marked not a fit.', 'This message was cancelled because the patient was marked not a fit.', 'cancelled', 7, null, null, now() - interval '8 days');

  -- ── 8. PAUSED (rescheduled, resumes Day 30) - Karen Mills (created 10d ago) ─
  insert into public.consults
    (practice_id, recording_date, recording_time, duration, transcript, status,
     primary_objection, exit_intent, coaching_insight, tc_action,
     patient_name, patient_phone, patient_email, outcome, outcome_set_at,
     sequence_activated_at, created_at)
  values
    (pid, (now() - interval '10 days')::date, time '10:30', 1320,
     'Patient asked to revisit after the new year.', 'analyzed',
     'Timing', 'long_term', 'Re-engage at Day 30 with a fresh, low-pressure check-in.',
     'Pause active outreach. Re-engagement picks up at Day 30.',
     'Karen Mills', '(509) 555-0178', 'karen.mills@seedseq.test', 'rescheduled', now() - interval '6 days',
     now() - interval '9 days', now() - interval '10 days')
  returning id into c8;

  insert into public.messages (consult_id, practice_id, type, channel, subject, body, status, send_day, sent_at, scheduled_for, created_at) values
    (c8, pid, 'followup', 'sms',   null, 'Hi Karen, great meeting you. Sending the plan we talked through.', 'sent', 1, now() - interval '10 days', null, now() - interval '10 days'),
    (c8, pid, 'followup', 'email', 'Your treatment options', 'Hi Karen, here is everything from today. We will revisit after the new year as you asked.', 'sent', 1, now() - interval '10 days', null, now() - interval '10 days'),
    (c8, pid, 'followup', 'sms',   null, 'Thanks again, Karen. I will check back in when the timing you mentioned comes around.', 'sent', 3, now() - interval '8 days', null, now() - interval '10 days'),
    (c8, pid, 'followup', 'email', 'Checking back in', 'Hi Karen, circling back as promised. Would love to help whenever you are ready.', 'scheduled', 30, null, now() + interval '20 days', now() - interval '10 days');

  raise notice 'Seeded 8 example sequences for practice %', pid;
end $$;

-- Verify:
-- select patient_name, outcome, sequence_cancelled_at is not null as cancelled,
--        (select count(*) from public.messages m where m.consult_id = c.id) as msgs
-- from public.consults c where patient_email like '%@seedseq.test' order by created_at desc;
