-- ============================================================================
-- ATTRIBUTION MODEL v2 + auditable attribution_events trail. Idempotent.
--
-- Adds a defensible, event-sourced attribution model:
--   • consults.attribution_status: caselift_assisted | caselift_recovered
--     | practice_direct | unknown
--   • consults.attribution_confirmed_at / attribution_source (pms_sync|manual|webhook)
--   • attribution_events: append-only log (message_sent | patient_replied |
--     treatment_accepted) that builds the status and proves how CaseLift helped.
--
-- Status is derived (in priority order) when a consult is accepted/closed_won:
--   patient replied to a sequence  -> caselift_recovered
--   at least one message was sent  -> caselift_assisted
--   no sequence activity           -> practice_direct
--
-- Triggers populate attribution_events automatically:
--   messages.status -> 'sent'            => message_sent
--   conversation_messages inbound insert => patient_replied
--   consult accepted / closed_won        => treatment_accepted (+ status compute)
--
-- The legacy consults.attribution_model column is kept in sync for back-compat.
-- Run in the Supabase SQL editor (project eymgqjeudrmeofytnwgs).
-- ============================================================================

-- ── Columns ─────────────────────────────────────────────────────────────────
alter table public.consults
  add column if not exists attribution_status text,        -- caselift_assisted | caselift_recovered | practice_direct | unknown
  add column if not exists attribution_confirmed_at timestamptz,
  add column if not exists attribution_source text;        -- pms_sync | manual | webhook

alter table public.consults drop constraint if exists consults_attribution_status_check;
alter table public.consults add constraint consults_attribution_status_check
  check (attribution_status is null or attribution_status in
    ('caselift_assisted', 'caselift_recovered', 'practice_direct', 'unknown'));

-- ── attribution_events: append-only auditable trail ──────────────────────────
create table if not exists public.attribution_events (
  id          uuid primary key default gen_random_uuid(),
  consult_id  uuid not null references public.consults(id) on delete cascade,
  practice_id uuid not null references public.practices(id) on delete cascade,
  event_type  text not null,                  -- message_sent | patient_replied | treatment_accepted
  event_date  timestamptz not null default now(),
  source      text not null default 'caselift', -- caselift | pms | manual
  created_at  timestamptz not null default now()
);
create index if not exists idx_attr_events_consult  on public.attribution_events(consult_id);
create index if not exists idx_attr_events_practice on public.attribution_events(practice_id);
create index if not exists idx_attr_events_type     on public.attribution_events(consult_id, event_type);

alter table public.attribution_events enable row level security;
drop policy if exists "attr_events_select" on public.attribution_events;
create policy "attr_events_select" on public.attribution_events
  for select using (practice_id = public.current_practice_id());
drop policy if exists "attr_events_insert" on public.attribution_events;
create policy "attr_events_insert" on public.attribution_events
  for insert to authenticated with check (practice_id = public.current_practice_id());

-- ── Derivation helper ────────────────────────────────────────────────────────
-- Returns the attribution status for a consult from its event/message history.
create or replace function public.derive_attribution_status(p_consult_id uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  replied   boolean;
  sent      boolean;
begin
  select exists (
    select 1 from public.conversation_messages cm
    join public.conversations cv on cv.id = cm.conversation_id
    where cv.consult_id = p_consult_id and cm.direction = 'inbound'
  ) or exists (
    select 1 from public.attribution_events ae
    where ae.consult_id = p_consult_id and ae.event_type = 'patient_replied'
  ) into replied;

  select exists (
    select 1 from public.messages m
    where m.consult_id = p_consult_id and m.status = 'sent'
  ) or exists (
    select 1 from public.attribution_events ae
    where ae.consult_id = p_consult_id and ae.event_type = 'message_sent'
  ) into sent;

  if replied then return 'caselift_recovered'; end if;
  if sent then return 'caselift_assisted'; end if;
  return 'practice_direct';
end $$;

-- ── message_sent event ───────────────────────────────────────────────────────
create or replace function public.log_message_sent_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.status = 'sent'
     and (TG_OP = 'INSERT' or OLD.status is distinct from 'sent')
     and NEW.consult_id is not null then
    insert into public.attribution_events (consult_id, practice_id, event_type, event_date, source)
    values (NEW.consult_id, NEW.practice_id, 'message_sent', coalesce(NEW.sent_at, now()), 'caselift');
  end if;
  return NEW;
end $$;
drop trigger if exists trg_log_message_sent on public.messages;
create trigger trg_log_message_sent after insert or update of status on public.messages
  for each row execute function public.log_message_sent_event();

-- ── patient_replied event ────────────────────────────────────────────────────
create or replace function public.log_patient_replied_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  cv_consult uuid;
  cv_practice uuid;
begin
  if NEW.direction = 'inbound' then
    select consult_id, practice_id into cv_consult, cv_practice
      from public.conversations where id = NEW.conversation_id;
    if cv_consult is not null then
      insert into public.attribution_events (consult_id, practice_id, event_type, event_date, source)
      values (cv_consult, cv_practice, 'patient_replied', coalesce(NEW.sent_at, NEW.created_at, now()), 'caselift');
    end if;
  end if;
  return NEW;
end $$;
drop trigger if exists trg_log_patient_replied on public.conversation_messages;
create trigger trg_log_patient_replied after insert on public.conversation_messages
  for each row execute function public.log_patient_replied_event();

-- ── treatment_accepted: compute status + log event on close ──────────────────
-- Fires when a consult transitions into an accepted/won state via either the
-- workflow `status` or the TC `outcome` column (manual or PMS sync).
create or replace function public.set_attribution_on_close()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  became_won boolean;
  new_status text;
begin
  became_won :=
       (NEW.status  = 'closed_won' and OLD.status  is distinct from 'closed_won')
    or (NEW.outcome = 'closed_won' and OLD.outcome is distinct from 'closed_won')
    or (NEW.outcome = 'accepted'   and OLD.outcome is distinct from 'accepted');

  if not became_won then return NEW; end if;

  new_status := public.derive_attribution_status(NEW.id);
  NEW.attribution_status       := new_status;
  NEW.attribution_confirmed_at := now();
  NEW.attribution_source       := coalesce(NEW.attribution_source, 'manual');
  -- Keep the legacy column in sync (billing / older reports read it).
  NEW.attribution_model := case
    when new_status in ('caselift_recovered', 'caselift_assisted') then 'caselift_recovered'
    else 'practice_recovered' end;

  insert into public.attribution_events (consult_id, practice_id, event_type, event_date, source)
  values (NEW.id, NEW.practice_id, 'treatment_accepted', now(), coalesce(NEW.attribution_source, 'manual'));

  return NEW;
end $$;

-- Replace the old status-only attribution trigger with the comprehensive one.
drop trigger if exists trg_set_consult_attribution on public.consults;
drop trigger if exists trg_set_attribution_on_close on public.consults;
create trigger trg_set_attribution_on_close before update of status, outcome on public.consults
  for each row execute function public.set_attribution_on_close();

grant execute on function public.derive_attribution_status(uuid) to authenticated, service_role;
