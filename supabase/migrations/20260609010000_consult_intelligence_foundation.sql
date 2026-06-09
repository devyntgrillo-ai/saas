-- Foundation for the enhanced consult-analysis + sequence-generation rebuild.
-- Purely additive — does NOT alter the live message-sending pipeline.

-- Part 1: rich structured intelligence extracted from the transcript.
alter table public.consults add column if not exists consult_intelligence jsonb;
-- Urgency classification (HOT | WARM | NURTURE | LONG_TERM). Kept separate from
-- the legacy exit_intent_level so the existing pipeline is untouched.
alter table public.consults add column if not exists urgency_classification text;
alter table public.consults add column if not exists decision_readiness int; -- 1-10

-- Part 5: structured Knowledge Base (USPs, financing, testimonials, protocols…).
create table if not exists public.practice_knowledge_base (
  id          uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id) on delete cascade,
  category    text not null,            -- USP | financing | testimonial | protocol | guarantee | team
  content     text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_pkb_practice on public.practice_knowledge_base(practice_id, is_active);
alter table public.practice_knowledge_base enable row level security;
drop policy if exists pkb_select on public.practice_knowledge_base;
create policy pkb_select on public.practice_knowledge_base for select to authenticated
  using (practice_id = public.current_practice_id() or public.is_platform_admin());
drop policy if exists pkb_write on public.practice_knowledge_base;
create policy pkb_write on public.practice_knowledge_base for all to authenticated
  using (practice_id = public.current_practice_id() or public.is_platform_admin())
  with check (practice_id = public.current_practice_id() or public.is_platform_admin());

-- Part 6: per-message performance (complements the existing message_outcomes
-- learning table; this one tracks the spec's exact fields for channel/position
-- optimization).
create table if not exists public.message_performance (
  id                 uuid primary key default gen_random_uuid(),
  message_id         uuid references public.messages(id) on delete cascade,
  practice_id        uuid not null references public.practices(id) on delete cascade,
  channel            text,            -- sms | email | call
  sequence_position  int,
  sent_at            timestamptz,
  opened             boolean default false,
  replied            boolean default false,
  reply_led_to_close boolean default false,
  days_to_reply      int,
  created_at         timestamptz not null default now()
);
create index if not exists idx_msgperf_practice on public.message_performance(practice_id, channel);
create index if not exists idx_msgperf_message on public.message_performance(message_id);
alter table public.message_performance enable row level security;
drop policy if exists msgperf_select on public.message_performance;
create policy msgperf_select on public.message_performance for select to authenticated
  using (practice_id = public.current_practice_id() or public.is_platform_admin());
