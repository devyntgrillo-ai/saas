-- ============================================================================
-- DEV UNBLOCK SCRIPT  (project eymgqjeudrmeofytnwgs)
-- Run in Supabase SQL Editor. Safe to re-run (idempotent).
-- Re-enable RLS with proper policies before production launch.
-- ============================================================================

-- 1) Inspect current agency_accounts policies (optional, for reference) -------
-- SELECT schemaname, tablename, policyname, cmd, qual, with_check
-- FROM pg_policies WHERE tablename = 'agency_accounts';

-- 2) Disable RLS on tables a super_admin needs full access to -----------------
alter table public.agency_accounts        disable row level security;
alter table public.practices              disable row level security;
alter table public.users                  disable row level security;
alter table public.consults               disable row level security;
alter table public.messages               disable row level security;
alter table public.conversations          disable row level security;
alter table public.conversation_messages  disable row level security;
alter table public.agency_members         disable row level security;
alter table public.pms_appointments       disable row level security;
alter table public.pms_sync               disable row level security;
alter table public.pms_sync_log           disable row level security;
alter table public.ai_learning_events     disable row level security;
alter table public.message_outcomes       disable row level security;
alter table public.network_insights       disable row level security;
alter table public.cancellation_feedback  disable row level security;
alter table public.audit_logs             disable row level security;
alter table public.invitations            disable row level security;
alter table public.training_modules       disable row level security;

-- 3) Make pms_appointments.consult_id FK nullable + deferrable ----------------
alter table public.pms_appointments drop constraint if exists pms_appointments_consult_id_fkey;
alter table public.pms_appointments add constraint pms_appointments_consult_id_fkey
  foreign key (consult_id) references public.consults(id)
  on delete set null
  deferrable initially deferred;

-- 4) Fix the PMS match trigger: never write pms_appointments during the
--    consult INSERT. BEFORE INSERT only fills the consult's patient fields;
--    AFTER INSERT does the back-link once the consult row exists. -------------
create or replace function public.match_consult_to_pms()
returns trigger language plpgsql security definer set search_path = public as $$
declare appt record; ts timestamptz;
begin
  if NEW.patient_name is not null or NEW.pms_appointment_id is not null then return NEW; end if;
  ts := coalesce((NEW.recording_date + coalesce(NEW.recording_time, '00:00:00'::time))::timestamptz, NEW.created_at, now());
  select * into appt from public.pms_appointments a
    where a.practice_id = NEW.practice_id and a.consult_id is null and a.appointment_time is not null
      and abs(extract(epoch from (a.appointment_time - ts))) <= 7200
    order by abs(extract(epoch from (a.appointment_time - ts))) asc limit 1;
  if found then
    NEW.patient_name := nullif(trim(coalesce(appt.patient_first,'')||' '||coalesce(appt.patient_last,'')), '');
    NEW.patient_phone := appt.patient_phone; NEW.patient_email := appt.patient_email;
    NEW.pms_appointment_id := coalesce(appt.pms_appointment_id, appt.id::text);
  end if;
  return NEW;
end $$;
drop trigger if exists trg_match_consult_to_pms on public.consults;
create trigger trg_match_consult_to_pms before insert on public.consults
  for each row execute function public.match_consult_to_pms();

create or replace function public.link_consult_to_pms()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.pms_appointment_id is null then return NEW; end if;
  update public.pms_appointments
    set consult_id = NEW.id
    where practice_id = NEW.practice_id
      and consult_id is null
      and (pms_appointment_id = NEW.pms_appointment_id or id::text = NEW.pms_appointment_id);
  return NEW;
end $$;
drop trigger if exists trg_link_consult_to_pms on public.consults;
create trigger trg_link_consult_to_pms after insert on public.consults
  for each row execute function public.link_consult_to_pms();

-- 5a) VERIFY RLS is actually disabled on every target table ------------------
select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('agency_accounts','practices','users','consults','messages',
    'conversations','conversation_messages','agency_members','pms_appointments',
    'pms_sync','pms_sync_log','ai_learning_events','message_outcomes',
    'network_insights','cancellation_feedback','audit_logs','invitations',
    'training_modules')
order by relname;   -- every rls_enabled should be false

-- 5b) VERIFY a consult can be inserted with no FK error, then clean up --------
do $$
declare cid uuid; pid uuid;
begin
  select id into pid from public.practices limit 1;
  if pid is not null then
    insert into public.consults (practice_id, status, recording_source)
      values (pid, 'analyzing', 'browser') returning id into cid;
    delete from public.consults where id = cid;
    raise notice 'consults insert OK (no FK error) (id %)', cid;
  else
    raise notice 'no practices found; skipped consult insert test';
  end if;
end $$;

-- 5c) VERIFY an agency_accounts insert succeeds. Adjust columns to match your
--     table if it has extra NOT NULL fields; this reports the real error.
do $$
declare aid uuid;
begin
  insert into public.agency_accounts (name) values ('__rls_test__') returning id into aid;
  delete from public.agency_accounts where id = aid;
  raise notice 'agency_accounts insert OK (id %)', aid;
exception when others then
  raise notice 'agency_accounts insert FAILED: % (%). If this is a NOT NULL/column error, RLS is fixed - just add the missing columns.', sqlerrm, sqlstate;
end $$;
