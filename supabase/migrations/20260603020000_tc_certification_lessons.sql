-- ============================================================================
-- TC CERTIFICATION COURSE — schema, RLS, push-log, and 44-lesson seed. Idempotent.
--
-- training_modules is a single shared table every subaccount reads from. This
-- migration:
--   1. Adds status + module_group columns (status drives the publish/draft/push
--      model: 'draft' never shown, 'published' = live, 'updated' = edited since
--      last push, also hidden from practices until re-pushed).
--   2. Replaces the old "any authenticated can read all" policy so practices only
--      see published lessons, while the super admin (devyntgrillo@gmail.com) sees
--      and manages everything.
--   3. Creates training_push_log to record each "push to all subaccounts".
--   4. Seeds the 44 TC Certification lessons as drafts.
--
-- Run in the Supabase SQL editor (project eymgqjeudrmeofytnwgs) if not applied
-- via the CLI. Safe to run repeatedly.
-- ============================================================================

-- 1) Columns -----------------------------------------------------------------
alter table public.training_modules add column if not exists status       text default 'published';
alter table public.training_modules add column if not exists module_group text;

-- 2) RLS: published-for-everyone, full control for the super admin ------------
alter table public.training_modules enable row level security;

drop policy if exists "training_select" on public.training_modules;
drop policy if exists "Users can view published modules" on public.training_modules;
create policy "Users can view published modules"
  on public.training_modules for select
  using (status = 'published' or auth.jwt() ->> 'email' = 'devyntgrillo@gmail.com');

drop policy if exists "Super admin can manage modules" on public.training_modules;
create policy "Super admin can manage modules"
  on public.training_modules for all
  using (auth.jwt() ->> 'email' = 'devyntgrillo@gmail.com')
  with check (auth.jwt() ->> 'email' = 'devyntgrillo@gmail.com');

-- 3) Push log ----------------------------------------------------------------
create table if not exists public.training_push_log (
  id             uuid default gen_random_uuid() primary key,
  pushed_at      timestamptz default now(),
  pushed_by      text,
  lessons_pushed integer,
  notes          text
);
alter table public.training_push_log enable row level security;
drop policy if exists "Super admin manage push log" on public.training_push_log;
create policy "Super admin manage push log"
  on public.training_push_log for all
  using (auth.jwt() ->> 'email' = 'devyntgrillo@gmail.com')
  with check (auth.jwt() ->> 'email' = 'devyntgrillo@gmail.com');

-- 4) Seed the 44 TC Certification lessons (drafts). Idempotent: only seeds when
--    the canonical 44-lesson set isn't already present (module_group is set on
--    the real course), clearing any stale/demo TC rows first. Re-running once the
--    course exists is a no-op (and preserves super-admin edits).
do $$
begin
  if (select count(*) from public.training_modules
        where category = 'TC Certification' and module_group is not null) < 44 then
    delete from public.training_modules where category = 'TC Certification';
    insert into public.training_modules (title, category, status, duration, video_url, description, module_group, order_index) values
      ('You''re Here For 1 of 3 Reasons',                      'TC Certification','draft',900,null,'','Module 1: Foundation',1),
      ('What This Course Will Do',                              'TC Certification','draft',900,null,'','Module 1: Foundation',2),
      ('Who''s Teaching You',                                   'TC Certification','draft',900,null,'','Module 1: Foundation',3),
      ('How To Use This Course',                                'TC Certification','draft',900,null,'','Module 1: Foundation',4),
      ('Sales Is Not A Dirty Word',                             'TC Certification','draft',900,null,'','Module 1: Foundation',5),
      ('The Mindset That Separates Great TCs',                  'TC Certification','draft',900,null,'','Module 1: Foundation',6),
      ('Get The Doctor Out Of The Room',                        'TC Certification','draft',900,null,'','Module 1: Foundation',7),
      ('The Myth of the Qualified Patient',                     'TC Certification','draft',900,null,'','Module 1: Foundation',8),
      ('Track What Matters or Never Improve',                   'TC Certification','draft',900,null,'','Module 1: Foundation',9),
      ('The Consult Starts Before They Arrive',                 'TC Certification','draft',900,null,'','Module 1: Foundation',10),
      ('Dental Implants 101',                                   'TC Certification','draft',900,null,'','Module 1: Foundation',11),
      ('Know The Timeline, Own The Conversation',               'TC Certification','draft',900,null,'','Module 1: Foundation',12),
      ('The Appointment Model: Every Minute Has a Job',         'TC Certification','draft',900,null,'','Module 1: Foundation',13),
      ('Pre-Appointment Verification: Walk In With All the Cards','TC Certification','draft',900,null,'','Module 1: Foundation',14),
      ('The First 90 Seconds Decide Everything',                'TC Certification','draft',900,null,'','Module 2: The Consult',15),
      ('Attuning to Different Patient Types',                   'TC Certification','draft',900,null,'','Module 2: The Consult',16),
      ('The 4X Rule: Why Rapport Is Everything',                'TC Certification','draft',900,null,'','Module 2: The Consult',17),
      ('The Questions That Unlock The Sale',                    'TC Certification','draft',900,null,'','Module 2: The Consult',18),
      ('Finding And Using The Emotional Anchor',                'TC Certification','draft',900,null,'','Module 2: The Consult',19),
      ('Internet Leads vs Warm Referrals',                      'TC Certification','draft',900,null,'','Module 2: The Consult',20),
      ('The Handoff: Getting The Doctor In & Out',              'TC Certification','draft',900,null,'','Module 2: The Consult',21),
      ('Complexity Kills. Present ONE Option.',                 'TC Certification','draft',900,null,'','Module 3: The Close',22),
      ('Speak Like A 5th Grader',                               'TC Certification','draft',900,null,'','Module 3: The Close',23),
      ('When They Jump To Price Too Early',                     'TC Certification','draft',900,null,'','Module 3: The Close',24),
      ('The Power of Silence',                                  'TC Certification','draft',900,null,'','Module 3: The Close',25),
      ('Financing: The 85% Close Rate Lever',                   'TC Certification','draft',900,null,'','Module 3: The Close',26),
      ('Financing Mastery',                                     'TC Certification','draft',900,null,'','Module 3: The Close',27),
      ('Full-Arch Specific Tactics',                            'TC Certification','draft',900,null,'','Module 3: The Close',28),
      ('Social Proof: The Closer''s Secret Weapon',             'TC Certification','draft',900,null,'','Module 3: The Close',29),
      ('Getting The Signature And The Deposit',                 'TC Certification','draft',900,null,'','Module 3: The Close',30),
      ('When To Let Them Walk',                                 'TC Certification','draft',900,null,'','Module 3: The Close',31),
      ('Your Certification And What Comes Next',                'TC Certification','draft',900,null,'','Module 3: The Close',32),
      ('What An Objection Really Is',                           'TC Certification','draft',900,null,'','Module 4: Objections',33),
      ('Intro to Objection Handling',                          'TC Certification','draft',900,null,'','Module 4: Objections',34),
      ('"It''s Too Expensive"',                                 'TC Certification','draft',900,null,'','Module 4: Objections',35),
      ('"I Need To Think About It"',                            'TC Certification','draft',900,null,'','Module 4: Objections',36),
      ('"I Need To Talk To My Spouse"',                         'TC Certification','draft',900,null,'','Module 4: Objections',37),
      ('"I''m Too Busy Right Now"',                             'TC Certification','draft',900,null,'','Module 4: Objections',38),
      ('"I''m Too Old For This"',                               'TC Certification','draft',900,null,'','Module 4: Objections',39),
      ('"I Want To Shop Around"',                               'TC Certification','draft',900,null,'','Module 4: Objections',40),
      ('"I''ve Had A Bad Experience"',                          'TC Certification','draft',900,null,'','Module 4: Objections',41),
      ('"What If It Doesn''t Work?"',                           'TC Certification','draft',900,null,'','Module 4: Objections',42),
      ('"Another Dentist Said I Don''t Need This"',             'TC Certification','draft',900,null,'','Module 4: Objections',43),
      ('"Can We Make Payments Directly To You?"',               'TC Certification','draft',900,null,'','Module 4: Objections',44);
  end if;
end $$;
