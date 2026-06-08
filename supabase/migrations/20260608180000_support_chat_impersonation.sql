-- Allow a platform admin (impersonating / viewing a practice) to post on the
-- practice side of any channel. Real practice users stay scoped to their own
-- practice via current_practice_id(). Fixes practice-side sends silently failing
-- RLS when a super admin is switched into a practice that isn't their own.
drop policy if exists support_messages_insert on public.support_messages;
create policy support_messages_insert on public.support_messages for insert to authenticated
  with check (
    (sender_type = 'practice' and sender_id = auth.uid()
      and (practice_id = public.current_practice_id() or public.is_platform_admin()))
    or (public.is_platform_admin() and sender_type = 'caselift_team')
  );
