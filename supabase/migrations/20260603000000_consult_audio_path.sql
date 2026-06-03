alter table public.consults add column if not exists audio_storage_path text;
alter table public.consults add column if not exists transcript_error text;
