-- User "role" (job title): Dentist, Office Manager, Treatment Coordinator,
-- Marketing Personnel, or a free-text "Other". Lets the team see who's who.
-- Named job_title to avoid colliding with users.role (access level).

alter table public.users add column if not exists job_title text;

-- Extend the safe self-service profile update to also set job_title. A user can
-- still only edit their OWN display name / avatar / job title (never role or
-- practice_id). Drop the old 2-arg signature so there's a single function.
drop function if exists public.update_my_profile(text, text);
create or replace function public.update_my_profile(
  p_display_name text,
  p_avatar_url   text,
  p_job_title    text default null
)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.users
     set display_name = nullif(btrim(coalesce(p_display_name, '')), ''),
         avatar_url   = nullif(btrim(coalesce(p_avatar_url, '')), ''),
         job_title    = nullif(btrim(coalesce(p_job_title, '')), '')
   where id = auth.uid();
end $$;
grant execute on function public.update_my_profile(text, text, text) to authenticated;
