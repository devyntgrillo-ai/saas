-- Consult-only PMS sync calibration: practice admin approves matched appointment
-- types before any rows land in pms_appointments / schedule UI.

alter table public.practices
  add column if not exists pms_history_years int not null default 1
    check (pms_history_years between 1 and 5),
  add column if not exists pms_forward_years int not null default 1
    check (pms_forward_years between 1 and 5),
  add column if not exists pms_sync_approved_at timestamptz,
  add column if not exists pms_sync_rules jsonb,
  add column if not exists pms_sync_status text not null default 'draft'
    check (pms_sync_status in ('draft', 'pending_approval', 'approved', 'syncing', 'active')),
  add column if not exists pms_auto_sync_enabled boolean not null default false;

alter table public.pms_appointments
  add column if not exists pms_match_rule text;

comment on column public.practices.pms_history_years is 'Years of past appointments to scan/backfill (1–5, default 1).';
comment on column public.practices.pms_forward_years is 'Years of future appointments to scan/sync (1–5, default 1).';
comment on column public.practices.pms_sync_rules is 'Draft/approved cluster rules from discover-pms-consults (AI-assisted).';
comment on column public.practices.pms_sync_status is 'draft → pending_approval → active after practice admin approves.';
comment on column public.pms_appointments.pms_match_rule is 'Cluster id that matched this appointment during sync.';
