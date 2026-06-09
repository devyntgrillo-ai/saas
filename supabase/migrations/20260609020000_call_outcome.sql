-- Call-reminder outcome logged by the TC (Part 9).
alter table public.messages add column if not exists call_outcome text; -- Left voicemail | Spoke with patient | No answer | Call back requested
