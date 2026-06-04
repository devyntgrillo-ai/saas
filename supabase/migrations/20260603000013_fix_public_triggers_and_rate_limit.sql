-- ============================================================================
-- Fix findings 2 and 3 from the LOW-severity audit:
--
-- 2. Trigger functions not explicitly revoked from public — 11 SECURITY DEFINER
--    trigger functions were callable by anon / authenticated via the API.
-- 3. practices_insert has no rate limiting — any authenticated user could create
--    unlimited practice records.
-- ============================================================================

-- ── Finding 2: revoke trigger functions from public/anon ─────────────────────
-- All are SECURITY DEFINER so direct execution would run with owner privileges.

revoke execute on function public.track_message_sent()            from public, anon;
revoke execute on function public.track_patient_reply()            from public, anon;
revoke execute on function public.track_consult_closed()           from public, anon;
revoke execute on function public.match_consult_to_pms()           from public, anon;
revoke execute on function public.link_consult_to_pms()            from public, anon;
revoke execute on function public.set_consult_attribution()        from public, anon;
revoke execute on function public.log_message_sent_event()         from public, anon;
revoke execute on function public.log_patient_replied_event()      from public, anon;
revoke execute on function public.set_attribution_on_close()       from public, anon;
revoke execute on function public.auto_pause_sequence_on_reply()   from public, anon;
revoke execute on function public.auto_encrypt_practice_secrets()  from public, anon;

-- ── Finding 3: rate-limit practice creation ─────────────────────────────────
-- Add a created_by column so we can enforce a per-user cap.
-- Backfill existing practices from the users table.

alter table public.practices add column if not exists created_by uuid references auth.users(id);

update public.practices p
  set created_by = u.id
  from public.users u
  where u.practice_id = p.id
    and p.created_by is null;

-- Auto-set created_by on INSERT via a trigger (auth.uid() is available here).
create or replace function public.set_practice_created_by()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end;
$$;

revoke execute on function public.set_practice_created_by() from public, anon;

drop trigger if exists trg_set_practice_created_by on public.practices;
create trigger trg_set_practice_created_by
  before insert on public.practices
  for each row
  execute function public.set_practice_created_by();

-- Replace the practices_insert policy with one that limits to 3 per hour
-- per user. The signup flow inserts exactly one practice per signup, so 3/h
-- accommodates retries while preventing abuse.

drop policy if exists "practices_insert" on public.practices;
create policy "practices_insert" on public.practices
  for insert to authenticated
  with check (
    (
      select count(*) from public.practices
      where created_by = auth.uid()
        and created_at > now() - interval '1 hour'
    ) < 3
  );
