-- Makes your Supabase login the administrator. No editing needed.
-- First create your login: Authentication > Users > Add user > Create new user
-- (your email + a password, tick "Auto Confirm User"). Then run this.
--
-- It only works when exactly one login exists (yours), so it can never
-- make the wrong person an admin.

insert into public.admins (user_id, email)
select id, email
from auth.users
where (select count(*) from auth.users) = 1
on conflict (user_id) do nothing;

-- Should show one row with your email. If it shows nothing, more than one
-- login exists: delete the extra ones under Authentication > Users and run again.
select * from public.admins;
