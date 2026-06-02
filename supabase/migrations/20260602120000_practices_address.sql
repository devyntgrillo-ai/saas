-- Onboarding and Settings save practice.address; column was missing (only location existed).
alter table public.practices add column if not exists address text;
