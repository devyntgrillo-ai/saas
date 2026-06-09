-- Part 6: per-practice channel tuning snapshot (written weekly by
-- tune-practice-channels; read by analyze-consult + the dashboard insight card).
alter table public.practices add column if not exists channel_performance jsonb;
