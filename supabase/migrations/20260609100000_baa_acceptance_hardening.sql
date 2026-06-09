-- ============================================================================
-- BAA acceptance hardening.
--
-- Before this, BAA acceptance was a single overwritable practices.baa_accepted_at
-- column set to a CLIENT-generated timestamp, with no signer identity, version,
-- IP, or history. This migration makes acceptance a legally-defensible,
-- append-only record:
--   1. Snapshot columns on practices (who/what version/IP of the latest accept).
--   2. An append-only baa_acceptances ledger (one immutable row per acceptance).
--   3. record_baa_acceptance() SECURITY DEFINER RPC that stamps the timestamp
--      SERVER-SIDE (now()), writes the snapshot + ledger row, and emits a
--      tamper-resistant audit_logs entry — all atomically.
--
-- The RPC is granted to service_role only; the accept-baa edge function (which
-- validates the user's JWT and captures the real client IP/user-agent) calls it.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- 1. Latest-acceptance snapshot columns on practices --------------------------
alter table public.practices
  add column if not exists baa_accepted_by    uuid,
  add column if not exists baa_accepted_email text,
  add column if not exists baa_version        text,
  add column if not exists baa_accepted_ip    text;

-- 2. Append-only acceptance ledger -------------------------------------------
create table if not exists public.baa_acceptances (
  id           uuid primary key default gen_random_uuid(),
  accepted_at  timestamptz not null default now(),
  practice_id  uuid references public.practices(id) on delete cascade,
  user_id      uuid,
  user_email   text,
  version      text,
  ip_address   text,
  user_agent   text
);
create index if not exists idx_baa_acceptances_practice on public.baa_acceptances(practice_id);
create index if not exists idx_baa_acceptances_accepted on public.baa_acceptances(accepted_at desc);

alter table public.baa_acceptances enable row level security;

drop policy if exists "baa_acceptances_select_own" on public.baa_acceptances;
create policy "baa_acceptances_select_own" on public.baa_acceptances
  for select to authenticated
  using (practice_id = public.current_practice_id());

drop policy if exists "baa_acceptances_select_super_admin" on public.baa_acceptances;
create policy "baa_acceptances_select_super_admin" on public.baa_acceptances
  for select to authenticated
  using (public.is_super_admin());

-- Append-only: no INSERT/UPDATE/DELETE policy (writes via the RPC / service role).

-- 3. record_baa_acceptance RPC -----------------------------------------------
create or replace function public.record_baa_acceptance(
  p_practice_id uuid,
  p_user_id     uuid,
  p_user_email  text,
  p_version     text,
  p_ip_address  text default null,
  p_user_agent  text default null
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
begin
  if p_practice_id is null then
    raise exception 'practice_id is required';
  end if;

  update public.practices set
    baa_accepted_at    = v_now,
    baa_accepted_by    = p_user_id,
    baa_accepted_email = p_user_email,
    baa_version        = p_version,
    baa_accepted_ip    = p_ip_address
  where id = p_practice_id;

  insert into public.baa_acceptances
    (accepted_at, practice_id, user_id, user_email, version, ip_address, user_agent)
  values
    (v_now, p_practice_id, p_user_id, p_user_email, p_version, p_ip_address, p_user_agent);

  -- Mirror into the append-only HIPAA audit trail.
  insert into public.audit_logs
    (user_id, user_email, practice_id, action, resource_type, resource_id, details, phi_accessed, ip_address, user_agent)
  values
    (p_user_id, p_user_email, p_practice_id, 'baa.accepted', 'practice', p_practice_id::text,
     jsonb_build_object('version', p_version), false, p_ip_address, p_user_agent);

  return v_now;
end;
$$;

revoke all on function public.record_baa_acceptance(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_baa_acceptance(uuid, uuid, text, text, text, text) to service_role;
