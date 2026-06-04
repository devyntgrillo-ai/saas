-- De-identified transcripts for in-app voice call recordings (Whisper + PHI strip).
alter table public.call_logs
  add column if not exists transcript_deidentified text,
  add column if not exists transcript_status text, -- pending | transcribed | failed | skipped
  add column if not exists transcript_error text;
