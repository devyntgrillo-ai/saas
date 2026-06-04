-- Harden stop-on-reply: normalize sequence_config reads and resolve consult when
-- conversation.consult_id is missing (common for first inbound SMS before a send).

create or replace function public.normalize_sequence_config(cfg jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select case
    when cfg is null then null::jsonb
    when jsonb_typeof(cfg) = 'string' then (cfg #>> '{}')::jsonb
    else cfg
  end;
$$;

create or replace function public.auto_pause_sequence_on_reply()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
  cfg jsonb;
  stop_on_reply boolean := true;
  conv record;
  digits text;
begin
  if NEW.direction <> 'inbound' then return NEW; end if;

  select c.id, c.consult_id, c.practice_id, c.patient_phone
    into conv
    from public.conversations c
   where c.id = NEW.conversation_id;

  if conv.id is null then return NEW; end if;

  cid := conv.consult_id;

  -- Link thread to the most recent in-flight consult for this phone when missing.
  if cid is null and conv.patient_phone is not null then
    digits := regexp_replace(conv.patient_phone, '\D', '', 'g');
    if digits <> '' then
      select co.id into cid
        from public.consults co
       where co.practice_id = conv.practice_id
         and co.patient_phone is not null
         and regexp_replace(co.patient_phone, '\D', '', 'g') = digits
         and co.sequence_status <> 'cancelled'
         and co.outcome = 'pending'
       order by co.created_at desc
       limit 1;

      if cid is not null then
        update public.conversations
           set consult_id = cid
         where id = conv.id and consult_id is null;
      end if;
    end if;
  end if;

  if cid is null then return NEW; end if;

  begin
    select public.normalize_sequence_config(p.sequence_config) into cfg
      from public.consults co
      join public.practices p on p.id = co.practice_id
     where co.id = cid;
    stop_on_reply := coalesce((cfg -> 'rules' ->> 'stopOnReply')::boolean, true);
  exception when others then
    stop_on_reply := true;
  end;

  if not stop_on_reply then return NEW; end if;

  update public.consults
     set sequence_status = 'paused', sequence_paused_reason = 'reply'
   where id = cid and sequence_status <> 'cancelled';

  return NEW;
end $$;
