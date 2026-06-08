-- ============================================================================
-- Slack-style support chat: one channel per practice + a super-admin master
-- inbox. Tables: support_chats, support_messages, support_message_reactions,
-- support_typing_indicators. Realtime-enabled. RLS: practice users see only
-- their own channel; the platform admin (super-admin email) sees every channel.
-- Idempotent. Run on project eymgqjeudrmeofytnwgs.
-- ============================================================================

-- Super-admin is identified by email (no DB role exists for it; mirrors
-- SUPER_ADMIN_EMAIL in AuthContext). This helper makes that check usable inside
-- RLS so the master inbox + its realtime subscriptions can read all channels.
create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(lower(auth.jwt() ->> 'email') = 'devyntgrillo@gmail.com', false)
$$;

-- ── Tables ──────────────────────────────────────────────────────────────────
create table if not exists public.support_chats (
  id                    uuid primary key default gen_random_uuid(),
  practice_id           uuid references public.practices(id) on delete cascade,
  created_at            timestamptz default now(),
  last_message_at       timestamptz default now(),
  last_message_preview  text,
  unread_count_admin    int default 0,
  unread_count_practice int default 0,
  resolved_at           timestamptz
);
create unique index if not exists uq_support_chats_practice on public.support_chats(practice_id);

create table if not exists public.support_messages (
  id               uuid primary key default gen_random_uuid(),
  chat_id          uuid references public.support_chats(id) on delete cascade,
  practice_id      uuid references public.practices(id),
  sender_id        uuid references public.users(id),
  sender_type      text not null, -- 'practice' | 'caselift_team'
  sender_name      text not null,
  sender_avatar    text,
  message          text,
  edited_at        timestamptz,
  deleted_at       timestamptz,
  thread_parent_id uuid references public.support_messages(id) on delete cascade,
  created_at       timestamptz default now()
);
create index if not exists idx_support_messages_chat on public.support_messages(chat_id, created_at);
create index if not exists idx_support_messages_thread on public.support_messages(thread_parent_id);

create table if not exists public.support_message_reactions (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid references public.support_messages(id) on delete cascade,
  user_id     uuid references public.users(id),
  sender_type text not null,
  emoji       text not null,
  created_at  timestamptz default now(),
  unique (message_id, user_id, emoji)
);
create index if not exists idx_support_reactions_msg on public.support_message_reactions(message_id);

create table if not exists public.support_typing_indicators (
  id            uuid primary key default gen_random_uuid(),
  chat_id       uuid references public.support_chats(id) on delete cascade,
  user_id       uuid references public.users(id),
  sender_type   text not null,
  sender_name   text not null,
  scope         text not null default 'main', -- 'main' or a thread parent id (string)
  last_typed_at timestamptz default now(),
  unique (chat_id, user_id, scope)
);

-- ── Realtime (REPLICA IDENTITY FULL so UPDATE/DELETE payloads carry old row) ──
alter table public.support_chats              replica identity full;
alter table public.support_messages           replica identity full;
alter table public.support_message_reactions  replica identity full;
alter table public.support_typing_indicators  replica identity full;

do $$
declare t text;
begin
  foreach t in array array['support_chats','support_messages','support_message_reactions','support_typing_indicators'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.support_chats              enable row level security;
alter table public.support_messages           enable row level security;
alter table public.support_message_reactions  enable row level security;
alter table public.support_typing_indicators  enable row level security;

-- support_chats: practice sees its own; platform admin sees all.
drop policy if exists support_chats_select on public.support_chats;
create policy support_chats_select on public.support_chats for select to authenticated
  using (practice_id = public.current_practice_id() or public.is_platform_admin());
drop policy if exists support_chats_update on public.support_chats;
create policy support_chats_update on public.support_chats for update to authenticated
  using (practice_id = public.current_practice_id() or public.is_platform_admin());

-- support_messages: read your channel (or all if admin). Practice users post as
-- 'practice' into their own channel; platform admin posts as 'caselift_team'.
drop policy if exists support_messages_select on public.support_messages;
create policy support_messages_select on public.support_messages for select to authenticated
  using (practice_id = public.current_practice_id() or public.is_platform_admin());
drop policy if exists support_messages_insert on public.support_messages;
create policy support_messages_insert on public.support_messages for insert to authenticated
  with check (
    (sender_type = 'practice' and practice_id = public.current_practice_id() and sender_id = auth.uid())
    or (public.is_platform_admin() and sender_type = 'caselift_team')
  );
drop policy if exists support_messages_update on public.support_messages;
create policy support_messages_update on public.support_messages for update to authenticated
  using (sender_id = auth.uid() or public.is_platform_admin())
  with check (sender_id = auth.uid() or public.is_platform_admin());

-- reactions: scoped to a message in a channel you can see.
drop policy if exists support_reactions_select on public.support_message_reactions;
create policy support_reactions_select on public.support_message_reactions for select to authenticated
  using (
    public.is_platform_admin()
    or exists (select 1 from public.support_messages m where m.id = message_id and m.practice_id = public.current_practice_id())
  );
drop policy if exists support_reactions_insert on public.support_message_reactions;
create policy support_reactions_insert on public.support_message_reactions for insert to authenticated
  with check (
    user_id = auth.uid()
    and (
      public.is_platform_admin()
      or exists (select 1 from public.support_messages m where m.id = message_id and m.practice_id = public.current_practice_id())
    )
  );
drop policy if exists support_reactions_delete on public.support_message_reactions;
create policy support_reactions_delete on public.support_message_reactions for delete to authenticated
  using (user_id = auth.uid() or public.is_platform_admin());

-- typing: see others typing in a channel you can access; manage only your own row.
drop policy if exists support_typing_select on public.support_typing_indicators;
create policy support_typing_select on public.support_typing_indicators for select to authenticated
  using (
    public.is_platform_admin()
    or exists (select 1 from public.support_chats c where c.id = chat_id and c.practice_id = public.current_practice_id())
  );
drop policy if exists support_typing_insert on public.support_typing_indicators;
create policy support_typing_insert on public.support_typing_indicators for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists support_typing_update on public.support_typing_indicators;
create policy support_typing_update on public.support_typing_indicators for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists support_typing_delete on public.support_typing_indicators;
create policy support_typing_delete on public.support_typing_indicators for delete to authenticated
  using (user_id = auth.uid() or public.is_platform_admin());

-- ── Triggers ─────────────────────────────────────────────────────────────────
-- Auto-create a channel + post the CaseLift Team welcome message on new practice.
create or replace function public.create_practice_chat()
returns trigger language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  insert into public.support_chats (practice_id) values (NEW.id)
    on conflict (practice_id) do nothing
    returning id into cid;
  if cid is null then
    select id into cid from public.support_chats where practice_id = NEW.id;
  end if;

  insert into public.support_messages (chat_id, practice_id, sender_type, sender_name, message)
  values (
    cid, NEW.id, 'caselift_team', 'CaseLift Team',
    '👋 Welcome to CaseLift, ' || coalesce(NEW.name, 'there') || '!' || E'\n\n'
    || 'This is your direct line to our team. Use this chat for anything:' || E'\n\n'
    || '• Consult reviews — share a tough case, we''ll coach you through it' || E'\n'
    || '• Objection handling — price, fear, spouse, timing — we''ve seen it all' || E'\n'
    || '• Sequence strategy — not sure what to say? Ask us' || E'\n'
    || '• Anything else — no question is too small' || E'\n\n'
    || 'We''re here to make sure you get results.' || E'\n\n'
    || 'To get started: record your first consult and we''ll review it with you personally. 🎙️' || E'\n\n'
    || '— The CaseLift Team'
  );
  return NEW;
end $$;

drop trigger if exists on_practice_created on public.practices;
create trigger on_practice_created after insert on public.practices
  for each row execute function public.create_practice_chat();

-- Keep the channel's preview, timestamp and unread counters current.
create or replace function public.support_message_bump()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.support_chats set
    last_message_at = NEW.created_at,
    last_message_preview = left(coalesce(NEW.message, ''), 140),
    unread_count_admin = unread_count_admin + (case when NEW.sender_type = 'practice' then 1 else 0 end),
    unread_count_practice = unread_count_practice + (case when NEW.sender_type = 'caselift_team' then 1 else 0 end)
  where id = NEW.chat_id;
  return NEW;
end $$;

drop trigger if exists on_support_message_insert on public.support_messages;
create trigger on_support_message_insert after insert on public.support_messages
  for each row execute function public.support_message_bump();

-- Backfill channels for existing practices (no welcome spam; empty-state UI handles it).
insert into public.support_chats (practice_id)
select id from public.practices
where id not in (select practice_id from public.support_chats where practice_id is not null)
on conflict (practice_id) do nothing;
