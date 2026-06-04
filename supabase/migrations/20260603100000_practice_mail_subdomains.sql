-- Per-practice patient email subdomains under MAILGUN_PATIENT_MAIL_ROOT (e.g. smith.mail.heyhope.ai).

alter table public.practices
  add column if not exists mail_subdomain text,
  add column if not exists mail_from_local_part text not null default 'office';

comment on column public.practices.mail_subdomain is
  'Slug for patient-facing email host: {mail_subdomain}.mail.heyhope.ai';
comment on column public.practices.mail_from_local_part is
  'Local part before @ on patient mail host (default office).';

create unique index if not exists idx_practices_mail_subdomain
  on public.practices (mail_subdomain)
  where mail_subdomain is not null;
