-- ============================================================================
-- Practice invite columns (send-client-invite edge function)
--
-- Resellers / super admins invite a new client practice before its owner has
-- set up an account. The practice row is created in an "invited" lifecycle state
-- carrying the owner's contact details, the reseller's price, and a one-time
-- invite token, then activated when the owner accepts the magic link.
-- ============================================================================

alter table public.practices
  add column if not exists status         text not null default 'active', -- invited | active | ...
  add column if not exists invited_at     timestamptz,
  add column if not exists invite_token   text,
  add column if not exists owner_name     text,
  add column if not exists owner_email    text,
  add column if not exists city           text,
  add column if not exists state          text,
  add column if not exists reseller_price numeric;

-- One-time invite token must be unique so the accept flow can resolve a practice.
create unique index if not exists idx_practices_invite_token
  on public.practices(invite_token)
  where invite_token is not null;

create index if not exists idx_practices_status on public.practices(status);
