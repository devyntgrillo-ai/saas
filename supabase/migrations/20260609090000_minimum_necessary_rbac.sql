-- ============================================================================
-- "Minimum necessary" RBAC support (HIPAA 45 CFR 164.514(d)).
--
--   1. audit_logs.user_role — stamp the actor's effective role on every entry so
--      access (and denied attempts) can be reviewed by role, not just user_id.
--   2. log_audit_event() — resolve + stamp user_role server-side (tamper-proof).
--   3. accept_invitation() — set users.role from the invitation so a practice can
--      actually be granted as a viewer / member / owner. Previously only
--      practice_id was set, so every invitee silently stayed 'member' and a
--      read-only "viewer" could never exist.
--
-- Role vocabulary on public.users.role: 'owner' | 'admin' | 'member' | 'viewer'.
-- The app maps member→practice_member, viewer→practice_viewer, else→practice_owner
-- (see AuthContext) and gates PHI off practice_member+ (see lib/permissions.js).
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- 1. New column --------------------------------------------------------------
alter table public.audit_logs add column if not exists user_role text;

-- 2. log_audit_event — also resolve + stamp the caller's role ----------------
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
  v_uid      uuid := auth.uid();
  v_email    text;
  v_practice uuid;
  v_role     text;
begin
  if v_uid is null then
    raise exception 'log_audit_event requires an authenticated session';
  end if;

  -- Effective role: an explicit access_level (e.g. super_admin) wins, else the
  -- in-practice role.
  select u.email, u.practice_id, coalesce(u.access_level, u.role)
    into v_email, v_practice, v_role
  from public.users u where u.id = v_uid;

  if p_practice_id is not null and public.is_super_admin() then
    v_practice := p_practice_id;
  end if;

  insert into public.audit_logs (
    user_id, user_email, user_role, practice_id, action, resource_type, resource_id,
    details, phi_accessed, ip_address, user_agent
  ) values (
    v_uid, v_email, v_role, v_practice, p_action, p_resource_type, p_resource_id,
    p_details, coalesce(p_phi_accessed, false), p_ip_address, p_user_agent
  );
end;
$$;

revoke all on function public.log_audit_event(text, text, text, jsonb, boolean, text, text, uuid) from public, anon;
grant execute on function public.log_audit_event(text, text, text, jsonb, boolean, text, text, uuid) to authenticated;

-- 3. accept_invitation — set users.role from the invitation ------------------
-- Maps both the access-level form the invite UI stores ('practice_viewer', …)
-- and bare role strings to the users.role vocabulary. Unknown/blank → keep the
-- current role (defaults to 'member' for a brand-new user row).
create or replace function public.accept_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.invitations%rowtype;
  uid uuid := auth.uid();
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'Not authenticated');
  end if;

  select * into inv from public.invitations where token = p_token for update;
  if inv is null then
    return jsonb_build_object('ok', false, 'error', 'Invitation not found');
  end if;
  if inv.accepted_at is not null or inv.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'Invitation expired');
  end if;

  update public.invitations set accepted_at = now() where id = inv.id;

  if inv.agency_id is not null then
    insert into public.agency_members (user_id, agency_id, role, accessible_practice_ids)
    values (uid, inv.agency_id, coalesce(inv.role, 'member'), inv.accessible_practice_ids)
    on conflict (user_id, agency_id) do update
      set role = excluded.role,
          accessible_practice_ids = excluded.accessible_practice_ids;
  end if;

  if inv.practice_id is not null then
    update public.users
       set practice_id = inv.practice_id,
           role = case
             when inv.role in ('practice_owner', 'owner', 'admin') then 'owner'
             when inv.role in ('practice_member', 'member')        then 'member'
             when inv.role in ('practice_viewer', 'viewer')        then 'viewer'
             else coalesce(role, 'member')
           end
     where id = uid;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.accept_invitation(text) to authenticated;
