-- ============================================================================
-- set_practice_member_role(p_user_id, p_role)
--
-- Lets a practice owner/admin change a teammate's role (incl. demoting to a
-- read-only 'viewer'). RLS on public.users only allows a user to update their
-- OWN row, so role changes for others must go through this SECURITY DEFINER RPC,
-- which enforces: caller is an owner/admin (or super-admin), target is in the
-- caller's practice, can't change your own role, and the role is valid.
--
-- Keeps users.role (authoritative for effective access level) and
-- practice_members.role (multi-location) in sync.
--
-- Idempotent.
-- ============================================================================
create or replace function public.set_practice_member_role(p_user_id uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller          uuid := auth.uid();
  v_caller_practice uuid;
  v_caller_role     text;
  v_target_practice uuid;
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'error', 'Not authenticated');
  end if;
  if p_role not in ('owner', 'admin', 'member', 'viewer') then
    return jsonb_build_object('ok', false, 'error', 'Invalid role');
  end if;
  if p_user_id = v_caller then
    return jsonb_build_object('ok', false, 'error', 'You cannot change your own role');
  end if;

  select practice_id, coalesce(access_level, role)
    into v_caller_practice, v_caller_role
  from public.users where id = v_caller;

  if not (public.is_super_admin()
          or v_caller_role in ('owner', 'admin', 'practice_owner', 'super_admin')) then
    return jsonb_build_object('ok', false, 'error', 'Only practice admins can change roles');
  end if;

  select practice_id into v_target_practice from public.users where id = p_user_id;
  if v_target_practice is null then
    return jsonb_build_object('ok', false, 'error', 'User not found');
  end if;
  if not public.is_super_admin() and v_target_practice is distinct from v_caller_practice then
    return jsonb_build_object('ok', false, 'error', 'User is not in your practice');
  end if;

  update public.users set role = p_role where id = p_user_id;
  update public.practice_members set role = p_role
    where user_id = p_user_id and practice_id = v_target_practice;

  return jsonb_build_object('ok', true, 'role', p_role);
end;
$$;

revoke all on function public.set_practice_member_role(uuid, text) from public, anon;
grant execute on function public.set_practice_member_role(uuid, text) to authenticated;
