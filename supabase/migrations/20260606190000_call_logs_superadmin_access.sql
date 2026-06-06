-- Super-admin impersonation: allow reading/updating call_logs and conversation_messages
-- for any practice (matches consults/conversations superadmin policies).

drop policy if exists "call_logs_superadmin_select" on public.call_logs;
create policy "call_logs_superadmin_select" on public.call_logs
  for select to authenticated
  using (public.is_super_admin());

drop policy if exists "call_logs_superadmin_update" on public.call_logs;
create policy "call_logs_superadmin_update" on public.call_logs
  for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists "conversation_messages_superadmin_all" on public.conversation_messages;
create policy "conversation_messages_superadmin_all" on public.conversation_messages
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());
