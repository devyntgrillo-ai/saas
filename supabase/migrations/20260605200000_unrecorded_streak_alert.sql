-- ============================================================================
-- Consecutive-unrecorded adoption alert
--
-- Instead of the old "fewer than N consults this week" heuristic, we alert the
-- team INTERNALLY (super-admin + the practice's reseller owner) when a practice
-- lets X implant consults pass in a row without recording any of them - the
-- clearest signal that a customer has stopped using the product and needs a
-- personal nudge.
--
--   • unrecorded_streak_threshold  - per-practice trigger (consults in a row).
--                                    NULL → fall back to the global default
--                                    (env UNRECORDED_STREAK_THRESHOLD, else 5).
--   • unrecorded_streak_alerted_at - debounce: stamped when we alert, cleared
--                                    by the job once the streak drops back below
--                                    the threshold (so the next streak re-alerts).
-- ============================================================================

alter table public.practices
  add column if not exists unrecorded_streak_threshold int,
  add column if not exists unrecorded_streak_alerted_at timestamptz;

comment on column public.practices.unrecorded_streak_threshold is
  'Consecutive unrecorded implant consults that trigger an internal adoption alert. NULL = global default (5).';
comment on column public.practices.unrecorded_streak_alerted_at is
  'Last time the consecutive-unrecorded alert fired for this practice (debounce).';
