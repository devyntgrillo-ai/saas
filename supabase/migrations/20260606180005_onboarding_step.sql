-- Track how far a practice got in the multi-step onboarding so they can leave and
-- resume where they left off. Each step's data persists in its own columns
-- (profile fields, subscription_status, baa_accepted_at, a2p_*); this just
-- remembers which step to open.
alter table public.practices add column if not exists onboarding_step integer not null default 0;
