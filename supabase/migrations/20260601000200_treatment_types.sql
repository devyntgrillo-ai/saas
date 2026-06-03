-- ============================================================================
-- TREATMENT TYPE SYSTEM. Idempotent.
--
-- CaseLift recovers unconverted patients across ALL high-value treatments, not
-- just implants. This adds treatment_type + accurate treatment-plan-value
-- tracking to consults, recording metadata, and per-practice default values.
--
-- Run in the Supabase SQL editor (project eymgqjeudrmeofytnwgs) if not applied
-- via the CLI. Safe to run repeatedly.
-- ============================================================================

-- Treatment type on each consult (defaults to implants for legacy rows).
alter table public.consults add column if not exists treatment_type text default 'dental_implants';

-- Actual treatment-plan value + where it came from.
--   tx_plan_value_source: 'pms' | 'manual' | 'practice_default' | 'estimate'
alter table public.consults add column if not exists tx_plan_value numeric;
alter table public.consults add column if not exists tx_plan_value_source text default 'estimate';

-- Recording metadata captured at the confirm step.
alter table public.consults add column if not exists patient_first text;
alter table public.consults add column if not exists patient_last text;
alter table public.consults add column if not exists presenting_doctor text;
alter table public.consults add column if not exists tc_name text;

-- Per-practice default case values per treatment type, e.g.
--   {"dental_implants": 28000, "invisalign": 5500, "cosmetic_veneers": 10000}
alter table public.practices add column if not exists treatment_defaults jsonb default '{}'::jsonb;

-- Optional: a treatment type carried on PMS appointments (so the recording
-- confirm step can pre-populate it). Harmless if pms_appointments lacks it.
alter table public.pms_appointments add column if not exists treatment_type text;
alter table public.pms_appointments add column if not exists tx_plan_value numeric;
