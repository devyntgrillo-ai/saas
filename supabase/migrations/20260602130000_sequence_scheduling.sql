-- Practice timezone for quiet hours; TC approval gate for manual follow-up start.
alter table public.practices
  add column if not exists timezone text not null default 'America/Chicago';

alter table public.consults
  add column if not exists followup_approved_at timestamptz;

comment on column public.practices.timezone is 'IANA timezone for sequence quiet hours (e.g. America/Chicago).';
comment on column public.consults.followup_approved_at is 'When TC approved follow-up scheduling (required when auto_start_followup is off).';
