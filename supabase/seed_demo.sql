-- ============================================================================
-- seed_demo.sql - demo polish for Perry Family Dentistry. Run AFTER:
--   1) migrations/20260530000000_recording_pipeline_columns.sql  (adds case_value
--      + conversation display columns this seed relies on)
--   2) seed_sequences.sql  (creates the 8 @seedseq.test consults + messages)
--
-- Does three things, all repeatable/idempotent:
--   • Removes junk reseller agencies (keeps Northwest Implant Group + Pacific
--     Dental Partners). Guarded so it never deletes an agency that owns practices.
--   • Sets treatment-plan values on the converted demo consults.
--   • Adds 2 demo conversations (1 active w/ call log, 1 closed) for the seed
--     consults, with realistic back-and-forth.
--
-- Run in the Supabase SQL editor (project eymgqjeudrmeofytnwgs).
-- ============================================================================

-- 1) Junk agency cleanup - only delete if the agency owns no practices (safe).
delete from public.agency_accounts a
where a.name in ('dsd', 'Coastal Smiles Network', 'Mountain West Dental', 'Summit Dental Partners')
  and not exists (select 1 from public.practices p where p.agency_id = a.id);

do $$
declare
  pid uuid;
  conv1 uuid; conv2 uuid; conv3 uuid;
  consult_active uuid;  -- Margaret (active)
  consult_won uuid;     -- Sandra (accepted/converted)
  camp uuid;            -- demo reactivation campaign
  consult_tom uuid;     -- Tom Rivera (reactivation reply)
  consult_karen uuid;   -- Karen Mills (reactivation in progress)
begin
  select id into pid from public.practices where name ilike '%Perry%' order by created_at limit 1;
  if pid is null then
    raise exception 'No practice matching %%Perry%% found - run the reseller practices seed first.';
  end if;

  -- 2) Treatment values on converted demo consults.
  update public.consults set case_value = 34500
    where practice_id = pid and patient_email = 'snguyen@seedseq.test';      -- Sandra (accepted)
  update public.consults set case_value = 28000, outcome = 'closed_won', outcome_set_at = now() - interval '2 days'
    where practice_id = pid and patient_email = 'pgomez@seedseq.test';        -- Patricia -> second converted

  select id into consult_active from public.consults where practice_id = pid and patient_email = 'margaret.chen@seedseq.test';
  select id into consult_won    from public.consults where practice_id = pid and patient_email = 'snguyen@seedseq.test';

  -- 3) Demo conversations (repeatable: clear prior demo threads first).
  delete from public.conversations where practice_id = pid and patient_email like '%@seedseq.test';

  -- ── Active thread: Margaret, patient replied (unread), includes a call log ──
  insert into public.conversations
    (practice_id, patient_first, patient_last, patient_phone, patient_email, consult_id,
     last_message_at, unread_count, last_message_preview, created_at)
  values
    (pid, 'Margaret', 'Chen', '(509) 555-0182', 'margaret.chen@seedseq.test', consult_active,
     now() - interval '3 hours', 1, 'My husband is on board now, can we set something up?', now() - interval '3 days')
  returning id into conv1;

  insert into public.conversation_messages (conversation_id, direction, channel, body, sent_at, created_at) values
    (conv1, 'outbound', 'sms',  'Hi Margaret, it was great meeting you today! Want me to text over the options we discussed?', now() - interval '3 days', now() - interval '3 days'),
    (conv1, 'inbound',  'sms',  'Yes please, thank you!', now() - interval '3 days' + interval '20 minutes', now() - interval '3 days' + interval '20 minutes'),
    (conv1, 'outbound', 'call', 'Called May 28, 3:45 PM - no answer, left voicemail', now() - interval '2 days', now() - interval '2 days'),
    (conv1, 'outbound', 'sms',  'Just checking in - happy to answer any questions about financing whenever you are ready.', now() - interval '1 day', now() - interval '1 day'),
    (conv1, 'inbound',  'sms',  'My husband is on board now, can we set something up?', now() - interval '3 hours', now() - interval '3 hours');

  -- ── Closed thread: Sandra, converted ───────────────────────────────────────
  insert into public.conversations
    (practice_id, patient_first, patient_last, patient_phone, patient_email, consult_id,
     last_message_at, unread_count, last_message_preview, created_at)
  values
    (pid, 'Sandra', 'Nguyen', '(509) 555-0229', 'snguyen@seedseq.test', consult_won,
     now() - interval '5 days', 0, 'Perfect, see you then. Thank you!', now() - interval '7 days')
  returning id into conv2;

  insert into public.conversation_messages (conversation_id, direction, channel, body, sent_at, created_at) values
    (conv2, 'outbound', 'sms',  'Hi Sandra, wonderful meeting you! Sending the plan and financing now.', now() - interval '7 days', now() - interval '7 days'),
    (conv2, 'inbound',  'sms',  'Thanks! The monthly option looks doable.', now() - interval '6 days', now() - interval '6 days'),
    (conv2, 'outbound', 'call', 'Called May 24, 10:12 AM - spoke 6 min, ready to schedule surgical date', now() - interval '6 days', now() - interval '6 days'),
    (conv2, 'outbound', 'sms',  'Great news! I have you down for your consult. Anything you need beforehand?', now() - interval '5 days', now() - interval '5 days'),
    (conv2, 'inbound',  'sms',  'Perfect, see you then. Thank you!', now() - interval '5 days', now() - interval '5 days');

  -- 4) Demo reactivation campaign (repeatable: clear prior demo campaigns first).
  --    Enrollments + the conversation back-link cascade/clear with the campaign.
  delete from public.reactivation_campaigns where practice_id = pid and campaign_name like 'Price Lock%';

  select id into consult_tom   from public.consults where practice_id = pid and patient_email = 'tom.rivera@seedseq.test';
  select id into consult_karen from public.consults where practice_id = pid and patient_email = 'karen.mills@seedseq.test';

  insert into public.reactivation_campaigns
    (practice_id, campaign_name, angle_type,
     message_1_sms, message_1_email_subject, message_1_email_body, message_2_sms,
     filter_date_min, filter_date_max, total_recipients, messages_per_day,
     status, scheduled_start, started_at, created_at)
  values
    (pid, 'Price Lock · 6 - 12 months', 'price_lock',
     'Hi FIRSTNAME, Dr. Perry here. We''re holding your treatment plan pricing for 30 days before costs increase. I''d hate for you to miss this. Reply if you''d like more info.',
     'Your treatment plan - a note from Dr. Perry',
     'Hi FIRSTNAME, I was reviewing your treatment plan and wanted to reach out personally. Implant costs have been rising, so we are holding your pricing for the next 30 days.',
     'Hi FIRSTNAME - just making sure you got my note. We have a few openings and I''d love to get you scheduled. No pressure. -Dr. Perry',
     now() - interval '300 days', now() - interval '200 days', 42, 20,
     'active', now() - interval '4 days', now() - interval '4 days', now() - interval '4 days')
  returning id into camp;

  -- Enrollments: one replied (Tom), one mid-drip (Karen), plus filler to make the
  -- recipients/progress counts read realistically in the campaign list.
  insert into public.reactivation_enrollments
    (campaign_id, practice_id, consult_id, patient_first, patient_last, patient_phone, patient_email,
     status, messages_sent, last_sent_at, replied_at, reply_content)
  values
    (camp, pid, consult_tom, 'Tom', 'Rivera', '(512) 555-0240', 'tom.rivera@seedseq.test',
     'replied', 1, now() - interval '2 days', now() - interval '6 hours', 'Yes - what would the monthly payment look like?'),
    (camp, pid, consult_karen, 'Karen', 'Mills', '(509) 555-0255', 'karen.mills@seedseq.test',
     'sending', 1, now() - interval '1 day', null, null);

  -- Reactivation reply thread: Tom replied to the campaign → badge + paused banner.
  insert into public.conversations
    (practice_id, patient_first, patient_last, patient_phone, patient_email, consult_id,
     reactivation_campaign_id, last_message_at, unread_count, last_message_preview, created_at)
  values
    (pid, 'Tom', 'Rivera', '(512) 555-0240', 'tom.rivera@seedseq.test', consult_tom,
     camp, now() - interval '6 hours', 1, 'Yes - what would the monthly payment look like?', now() - interval '2 days')
  returning id into conv3;

  insert into public.conversation_messages (conversation_id, direction, channel, body, sent_at, created_at) values
    (conv3, 'outbound', 'sms', 'Hi Tom, Dr. Perry here. We''re holding your treatment plan pricing for 30 days before costs increase. I''d hate for you to miss this. Reply if you''d like more info.', now() - interval '2 days', now() - interval '2 days'),
    (conv3, 'inbound',  'sms', 'Yes - what would the monthly payment look like?', now() - interval '6 hours', now() - interval '6 hours');

  raise notice 'Demo seed complete for practice %', pid;
end $$;
