-- ============================================================================
-- Audio retention: raw consult recordings are auto-deleted after a per-practice
-- retention window (default 30 days), while transcripts + analysis are kept.
--   - consults.audio_deleted_at  - when the raw audio was purged (transcript kept)
--   - practices.audio_retention_days - per-practice window (7/30/60/90)
-- The daily purge cron (purge-consult-audio) is scheduled directly against prod
-- with a hardcoded service token (see ops notes) because the app.* GUCs aren't
-- set on this project; it is intentionally not defined here to avoid committing
-- the token.
-- ============================================================================

alter table public.consults  add column if not exists audio_deleted_at     timestamptz;
alter table public.practices add column if not exists audio_retention_days integer not null default 30;
