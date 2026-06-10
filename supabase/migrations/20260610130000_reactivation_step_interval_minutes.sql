-- Optional per-campaign step spacing in minutes (e.g. 15 for email test blasts).
-- When set, process-reactivation-drip uses idx * step_interval_minutes from launch
-- instead of day offsets, and skips business-hours / weekday gates.
alter table public.reactivation_campaigns
  add column if not exists step_interval_minutes int;
