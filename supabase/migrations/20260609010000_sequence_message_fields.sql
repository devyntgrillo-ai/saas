-- New per-message fields for the dynamic sequence engine.
alter table public.messages add column if not exists call_script       jsonb; -- call_reminder script bullets
alter table public.messages add column if not exists purpose           text;
alter table public.messages add column if not exists tone              text;
alter table public.messages add column if not exists sequence_position int;
-- Consecutive no-reply counter on the consult (drives no-response adaptation).
alter table public.consults add column if not exists consecutive_no_reply int not null default 0;
