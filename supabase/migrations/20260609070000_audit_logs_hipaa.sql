-- ============================================================================
-- audit_logs — HIPAA access trail, phase 2.
--
-- Builds on 20260529000000_audit_logs.sql. That migration created the table and
-- an own-practice SELECT policy, but the log_audit_event() RPC it referenced was
-- never defined, so every client audit call silently no-op'd. This migration:
--   1. Adds the missing columns the spec needs: user_agent, details, phi_accessed.
--   2. Defines the SECURITY DEFINER log_audit_event() RPC the client already calls.
--   3. Adds a super-admin SELECT policy (own-practice SELECT stays).
--   4. Keeps the table APPEND-ONLY: no UPDATE/DELETE policy is ever granted, so
--      audit rows cannot be edited or removed from the app — a HIPAA integrity
--      requirement (45 CFR 164.312(c)(1)).
--
-- Writes only ever happen through log_audit_event() (SECURITY DEFINER, stamps
-- the caller's own auth.uid()/practice_id so the browser cannot forge rows) or
-- the service-role key (edge functions). No authenticated INSERT policy exists.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- 1. New columns -------------------------------------------------------------
alter table public.audit_logs add column if not exists user_agent   text;
alter table public.audit_logs add column if not exists details      jsonb;
alter table public.audit_logs add column if not exists phi_accessed boolean not null default false;

create index if not exists idx_audit_logs_phi    on public.audit_logs(phi_accessed) where phi_accessed;
create index if not exists idx_audit_logs_action on public.audit_logs(action);
create index if not exists idx_audit_logs_user   on public.audit_logs(user_id);

-- 2. log_audit_event RPC -----------------------------------------------------
-- Called by the browser (src/lib/audit.js). The row is always stamped with the
-- caller's own identity server-side; p_practice_id is only honoured for a
-- super-admin (so impersonation events can be attributed to the target practice).
create or replace function public.log_audit_event(
  p_action        text,
  p_resource_type text    default null,
  p_resource_id   text    default null,
  p_details       jsonb   default null,
  p_phi_accessed  boolean default false,
  p_ip_address    text    default null,
  p_user_agent    text    default null,
  p_practice_id   uuid    default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_email   text;
  v_practice uuid;
begin
  if v_uid is null then
    -- Unauthenticated callers (e.g. a failed login) must go through the
    -- log-audit edge function (service role), not this RPC.
    raise exception 'log_audit_event requires an authenticated session';
  end if;

  select email, practice_id into v_email, v_practice
  from public.users where id = v_uid;

  -- Super-admins may attribute an event to a specific practice (impersonation);
  -- everyone else is pinned to their own practice.
  if p_practice_id is not null and public.is_super_admin() then
    v_practice := p_practice_id;
  end if;

  insert into public.audit_logs (
    user_id, user_email, practice_id, action, resource_type, resource_id,
    details, phi_accessed, ip_address, user_agent
  ) values (
    v_uid, v_email, v_practice, p_action, p_resource_type, p_resource_id,
    p_details, coalesce(p_phi_accessed, false), p_ip_address, p_user_agent
  );
end;
$$;

revoke all on function public.log_audit_event(text, text, text, jsonb, boolean, text, text, uuid) from public, anon;
grant execute on function public.log_audit_event(text, text, text, jsonb, boolean, text, text, uuid) to authenticated;

-- 3. RLS: super-admin reads everything; practices read their own -------------
alter table public.audit_logs enable row level security;

drop policy if exists "audit_logs_select_own_practice" on public.audit_logs;
create policy "audit_logs_select_own_practice" on public.audit_logs
  for select to authenticated
  using (practice_id = public.current_practice_id());

drop policy if exists "audit_logs_select_super_admin" on public.audit_logs;
create policy "audit_logs_select_super_admin" on public.audit_logs
  for select to authenticated
  using (public.is_super_admin());

-- No INSERT/UPDATE/DELETE policies by design (append-only; writes via RPC /
-- service role only).
