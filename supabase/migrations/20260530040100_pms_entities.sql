-- ============================================================================
-- PMS entity tables populated by the Sikka webhook (sikka-connect-webhook):
-- patients, providers, transactions. Appointments already have a table
-- (pms_appointments). All keyed by (practice_id, external_id) for idempotent
-- upserts. RLS: practice-scoped reads; the webhook writes via the service role
-- (bypasses RLS). Idempotent. Run in the SQL editor (project eymgqjeudrmeofytnwgs).
-- ============================================================================

-- ---- patients --------------------------------------------------------------
create table if not exists public.pms_patients (
  id            uuid primary key default gen_random_uuid(),
  practice_id   uuid not null references public.practices(id) on delete cascade,
  office_id     text,
  external_id   text,
  first_name    text,
  last_name     text,
  phone         text,
  email         text,
  date_of_birth date,
  raw           jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists uq_pms_patients_practice_extid
  on public.pms_patients(practice_id, external_id);
create index if not exists idx_pms_patients_practice on public.pms_patients(practice_id);
create index if not exists idx_pms_patients_phone on public.pms_patients(practice_id, phone);

-- ---- providers -------------------------------------------------------------
create table if not exists public.pms_providers (
  id          uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id) on delete cascade,
  office_id   text,
  external_id text,
  name        text,
  first_name  text,
  last_name   text,
  specialty   text,
  raw         jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists uq_pms_providers_practice_extid
  on public.pms_providers(practice_id, external_id);
create index if not exists idx_pms_providers_practice on public.pms_providers(practice_id);

-- ---- transactions (stored for future reporting) ----------------------------
create table if not exists public.pms_transactions (
  id                  uuid primary key default gen_random_uuid(),
  practice_id         uuid not null references public.practices(id) on delete cascade,
  office_id           text,
  external_id         text,
  patient_external_id text,
  amount              numeric,
  transaction_date    date,
  transaction_type    text,
  description         text,
  raw                 jsonb,
  created_at          timestamptz not null default now()
);
create unique index if not exists uq_pms_transactions_practice_extid
  on public.pms_transactions(practice_id, external_id);
create index if not exists idx_pms_transactions_practice on public.pms_transactions(practice_id, transaction_date desc);

-- ---- RLS: practice-scoped reads (webhook writes via service role) ----------
do $$
declare t text;
begin
  foreach t in array array['pms_patients','pms_providers','pms_transactions'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "%s_select_own_practice" on public.%I;', t, t);
    execute format($f$
      create policy "%1$s_select_own_practice" on public.%1$I
        for select to authenticated
        using (practice_id = public.current_practice_id());
    $f$, t);
  end loop;
end $$;
