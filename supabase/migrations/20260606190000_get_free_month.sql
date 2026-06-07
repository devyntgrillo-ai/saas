-- "Get a Free Month" rewards: a 3-task checklist (review, video testimonial,
-- refer a friend). Progress + the granted reward live in a jsonb blob so we can
-- add tasks without more migrations.
--   free_month = { review_at, video_at, referral_at, video_path, granted_at }
alter table public.practices add column if not exists free_month jsonb not null default '{}'::jsonb;

-- Private bucket for the inline video testimonials uploaded from the rewards page.
insert into storage.buckets (id, name, public)
values ('testimonials', 'testimonials', false)
on conflict (id) do nothing;

-- Authenticated users may upload + read testimonial videos (low-risk content).
drop policy if exists "testimonials_insert" on storage.objects;
create policy "testimonials_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'testimonials');

drop policy if exists "testimonials_select" on storage.objects;
create policy "testimonials_select" on storage.objects
  for select to authenticated using (bucket_id = 'testimonials');
