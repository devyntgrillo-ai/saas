-- Pinned messages + per-user read tracking (powers read receipts + unread divider).

-- ── Pins ─────────────────────────────────────────────────────────────────────
alter table public.support_messages add column if not exists pinned_at timestamptz;
alter table public.support_messages add column if not exists pinned_by uuid;

-- Any channel participant can pin/unpin (security definer; checks channel access).
create or replace function public.toggle_pin(p_message_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m record;
begin
  select * into m from public.support_messages where id = p_message_id;
  if m is null then return; end if;
  if not (public.is_platform_admin() or m.practice_id = public.current_practice_id()) then
    raise exception 'not permitted';
  end if;
  if m.pinned_at is null then
    update public.support_messages set pinned_at = now(), pinned_by = auth.uid() where id = p_message_id;
  else
    update public.support_messages set pinned_at = null, pinned_by = null where id = p_message_id;
  end if;
end $$;
grant execute on function public.toggle_pin(uuid) to authenticated;

-- ── Read receipts / unread tracking ──────────────────────────────────────────
create table if not exists public.support_reads (
  chat_id      uuid not null references public.support_chats(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  user_name    text,
  user_avatar  text,
  sender_type  text,
  primary key (chat_id, user_id)
);
alter table public.support_reads replica identity full;
alter table public.support_reads enable row level security;

drop policy if exists support_reads_select on public.support_reads;
create policy support_reads_select on public.support_reads for select to authenticated
  using (
    public.is_platform_admin()
    or exists (select 1 from public.support_chats c where c.id = chat_id and c.practice_id = public.current_practice_id())
  );
drop policy if exists support_reads_insert on public.support_reads;
create policy support_reads_insert on public.support_reads for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists support_reads_update on public.support_reads;
create policy support_reads_update on public.support_reads for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'support_reads') then
    alter publication supabase_realtime add table public.support_reads;
  end if;
end $$;
