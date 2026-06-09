-- Internal super-admin notes on resellers (referenced by admin portal).
alter table public.agency_accounts add column if not exists admin_notes text;
