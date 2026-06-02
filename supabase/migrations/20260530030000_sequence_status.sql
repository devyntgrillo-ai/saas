-- ============================================================================
-- Per-consult sequence run-state + auto-pause on patient reply. Idempotent.
--
--   sequence_status:
--     active    - sending normally (default)
--     paused    - no messages will send; pending messages stay pending
--     cancelled - sequence ended (won / not-a-fit); pending messages cancelled
--
--   sequence_paused_reason: why a paused row is paused.
--     manual    - a TC toggled it off on the Sequences page
--     reply     - auto-paused because the patient replied (shows as "Replied")
--
-- The toggle on the Sequences page flips active <-> paused. Marking an outcome
-- (Accepted / Not a Fit) sets cancelled. Run in the Supabase SQL editor.
-- ============================================================================
alter table public.consults add column if not exists sequence_status text not null default 'active';
alter table public.consults drop constraint if exists consults_sequence_status_check;
alter table public.consults add constraint consults_sequence_status_check
  check (sequence_status in ('active', 'paused', 'cancelled'));

alter table public.consults add column if not exists sequence_paused_reason text;

-- Backfill existing rows from the legacy outcome / cancellation columns.
update public.consults
   set sequence_status = 'cancelled'
 where sequence_status = 'active'
   and (outcome in ('accepted', 'not_converting', 'closed_won')
        or (sequence_cancelled_at is not null
            and coalesce(sequence_cancelled_reason, '') <> 'Stopped by TC'));

-- A manual "Stopped by TC" maps to a (manually) paused sequence.
update public.consults
   set sequence_status = 'paused', sequence_paused_reason = 'manual'
 where sequence_status = 'active'
   and sequence_cancelled_at is not null
   and sequence_cancelled_reason = 'Stopped by TC';

create index if not exists idx_consults_sequence_status on public.consults(practice_id, sequence_status);

-- ----------------------------------------------------------------------------
-- Auto-pause when a patient replies. Inbound messages land in
-- conversation_messages; this fires on insert, resolves the linked consult, and
-- pauses the sequence when the practice has "stop on reply" enabled (default).
-- ----------------------------------------------------------------------------
create or replace function public.auto_pause_sequence_on_reply()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
  cfg jsonb;
  stop_on_reply boolean := true;
begin
  if NEW.direction <> 'inbound' then return NEW; end if;

  select c.consult_id into cid from public.conversations c where c.id = NEW.conversation_id;
  if cid is null then return NEW; end if;

  -- Read the practice's stop-on-reply rule (defaults to true when unset).
  begin
    select p.sequence_config into cfg
      from public.consults co join public.practices p on p.id = co.practice_id
     where co.id = cid;
    -- sequence_config may be stored as a json string scalar; unwrap if so.
    if cfg is not null and jsonb_typeof(cfg) = 'string' then
      cfg := (cfg #>> '{}')::jsonb;
    end if;
    stop_on_reply := coalesce((cfg -> 'rules' ->> 'stopOnReply')::boolean, true);
  exception when others then
    stop_on_reply := true;
  end;

  if not stop_on_reply then return NEW; end if;

  -- Don't disturb a sequence that's already finished (won / not-a-fit).
  update public.consults
     set sequence_status = 'paused', sequence_paused_reason = 'reply'
   where id = cid and sequence_status <> 'cancelled';

  return NEW;
end $$;

drop trigger if exists trg_auto_pause_on_reply on public.conversation_messages;
create trigger trg_auto_pause_on_reply after insert on public.conversation_messages
  for each row execute function public.auto_pause_sequence_on_reply();
