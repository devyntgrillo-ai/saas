-- Ensure new practices have patient email follow-ups enabled by default.
alter table public.practices
  alter column email_enabled set default true;
