-- Grant platform super-admin via users.access_level (no hardcoded email in app code).

update public.users u
   set access_level = 'super_admin'
  from auth.users a
 where a.id = u.id
   and lower(a.email) = 'adeoyeadebayo18@gmail.com'
   and coalesce(u.access_level, '') is distinct from 'super_admin';
