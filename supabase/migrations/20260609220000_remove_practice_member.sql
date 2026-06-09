-- ============================================================================
-- remove_practice_member(p_user_id)
--
-- Lets a practice owner/admin (or super-admin) remove a teammate from their
-- practice. RLS on public.users only allows a user to update their OWN row
-- (users_update_self), so a client-side `update users set practice_id = null`
-- for ANOTHER user is silently filtered to 0 rows — which is why the Team-tab
-- trash button appeared to do nothing. This SECURITY DEFINER RPC performs the
-- removal with proper authorization instead, mirroring set_practice_member_role.
--
-- Clears users.practice_id (removes them from the practice's member list) and
-- the practice_members link (multi-location), and writes an audit_logs entry.
--
-- Idempotent.
-- ============================================================================
create or replace function public.remove_practice_member(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller          uuid := auth.uid();
  v_caller_practice uuid;
  v_caller_role     text;
  v_caller_email    text;
  v_target_practice uuid;
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'error', 'Not authenticated');
  end if;
  if p_user_id = v_caller then
    return jsonb_build_object('ok', false, 'error', 'You cannot remove yourself');
  end if;

  select practice_id, coalesce(access_level, role), email
    into v_caller_practice, v_caller_role, v_caller_email
  from public.users where id = v_caller;

  if not (public.is_super_admin()
          or v_caller_role in ('owner', 'admin', 'practice_owner', 'super_admin')) then
    return jsonb_build_object('ok', false, 'error', 'Only practice admins can remove members');
  end if;

  select practice_id into v_target_practice from public.users where id = p_user_id;
  if v_target_practice is null then
    return jsonb_build_object('ok', true); -- already unlinked
  end if;
  if not public.is_super_admin() and v_target_practice is distinct from v_caller_practice then
    return jsonb_build_object('ok', false, 'error', 'User is not in your practice');
  end if;

  update public.users set practice_id = null, role = 'member' where id = p_user_id;
  delete from public.practice_members where user_id = p_user_id and practice_id = v_target_practice;

  insert into public.audit_logs
    (user_id, user_email, practice_id, action, resource_type, resource_id, details, phi_accessed)
  values
    (v_caller, v_caller_email, v_target_practice, 'user.role_changed', 'user', p_user_id::text,
     jsonb_build_object('change', 'removed_from_practice'), false);

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.remove_practice_member(uuid) from public, anon;
grant execute on function public.remove_practice_member(uuid) to authenticated;
