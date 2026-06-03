-- Normalized E.164 for O(1) inbound SMS routing (one Twilio account, many numbers).

alter table public.practices add column if not exists twilio_phone_e164 text;

-- Drop the unique index temporarily so the backfill + dedup can run without
-- constraint violations. It's re-created at the end.
drop index if exists idx_practices_twilio_phone_e164;

-- Backfill from existing twilio_phone_number (US-focused).
update public.practices
set twilio_phone_e164 = case
  when twilio_phone_number is null then null
  when regexp_replace(twilio_phone_number, '[^0-9]', '', 'g') ~ '^1[0-9]{10}$'
    then '+' || regexp_replace(twilio_phone_number, '[^0-9]', '', 'g')
  when length(regexp_replace(twilio_phone_number, '[^0-9]', '', 'g')) = 10
    then '+1' || regexp_replace(twilio_phone_number, '[^0-9]', '', 'g')
  else trim(twilio_phone_number)
end
where twilio_phone_number is not null
  and (twilio_phone_e164 is null or twilio_phone_e164 = '');

-- One Twilio number must map to one practice; clear accidental duplicates.
with ranked as (
  select
    id,
    row_number() over (
      partition by twilio_phone_e164
      order by coalesce(created_at, '1970-01-01'::timestamptz), id
    ) as rn
  from public.practices
  where twilio_phone_e164 is not null
)
update public.practices p
set twilio_phone_e164 = null
from ranked r
where p.id = r.id
  and r.rn > 1;

-- Re-create the unique partial index.
create unique index if not exists idx_practices_twilio_phone_e164
  on public.practices (twilio_phone_e164)
  where twilio_phone_e164 is not null;
