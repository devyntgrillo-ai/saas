-- Sikka registration queue: webhook stores office sync data; practice admin
-- links by entering their SPU practice ID on Settings → PMS.

create index if not exists idx_sikka_registrations_office
  on public.sikka_registrations(sikka_practice_id, created_at desc);

comment on column public.sikka_registrations.status is
  'pending = awaiting practice claim; unlinked = legacy; linked; ignored';
