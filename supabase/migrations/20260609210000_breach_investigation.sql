-- ============================================================================
-- breach_investigation() - HIPAA breach-notification support (super-admin only).
--
-- For a given time window, returns every audit-log event that touched patient
-- PHI, joined to the practice (name + contact) and, when the event targeted a
-- consult, the patient (name + contact). Lets a platform admin hand each
-- affected practice the exact list of patients whose PHI may have been accessed
-- during a breach window (supports 45 CFR 164.404 affected-individual ID).
--
-- IMPORTANT: audit_logs has NO `phi_accessed` boolean (it was never added to the
-- schema). PHI access is therefore identified by the canonical PHI action names
-- written by src/lib/audit.js. If new PHI-touching actions are introduced, add
-- them to the action list below.
--
-- SECURITY DEFINER + an explicit is_platform_admin() guard: this is the only
-- path that bypasses the per-practice RLS on audit_logs, and only for the
-- platform admin. Everyone else gets "not authorized".
--
-- Run in the Supabase SQL editor (project eymgqjeudrmeofytnwgs).
-- (Could not run from the agent session - no DB connection available.)
-- ============================================================================

create or replace function public.breach_investigation(
  window_start timestamptz,
  window_end   timestamptz
)
returns table (
  created_at     timestamptz,
  action         text,
  user_email     text,
  practice_id    uuid,
  practice_name  text,
  practice_email text,
  practice_phone text,
  resource_id    text,
  patient_name   text,
  patient_phone  text,
  patient_email  text,
  ip_address     text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Hard gate: platform admin only. Mirrors the original query's intent while
  -- safely bypassing audit_logs RLS (which otherwise scopes to one practice).
  if not public.is_platform_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Columns are cast to the declared return types, and the consults join casts
  -- BOTH sides to text: production audit_logs.resource_id is uuid (the original
  -- migration declared it text), so an unqualified c.id::text = al.resource_id
  -- raised "operator does not exist: text = uuid".
  return query
    select
      al.created_at::timestamptz,
      al.action::text,
      al.user_email::text,
      al.practice_id::uuid,
      p.name::text,
      p.email::text,
      p.phone::text,
      al.resource_id::text,
      c.patient_name::text,
      c.patient_phone::text,
      c.patient_email::text,
      al.ip_address::text
    from public.audit_logs al
    left join public.practices p on p.id = al.practice_id
    left join public.consults  c on c.id::text = al.resource_id::text
    where al.created_at between window_start and window_end
      and al.action in (
        'consult.viewed',
        'patient.accessed',
        'message.sent',
        'conversation.viewed',
        'consult.analyzed'
      )
    order by al.created_at desc;
end;
$$;

grant execute on function public.breach_investigation(timestamptz, timestamptz) to authenticated;
