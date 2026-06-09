-- Voice memos: transcript + duration for audio chat messages.
alter table public.support_messages add column if not exists audio_transcript text;
alter table public.support_messages add column if not exists audio_duration   int;
