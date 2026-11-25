-- Make your Supabase Auth user an administrator.
-- 1. First create the user: Dashboard > Authentication > Users > Add user
--    > Create new user (enter your email and a strong password, and tick
--    "Auto Confirm User").
-- 2. Replace the email below with that same email, then run this in the
--    SQL Editor.

insert into public.admins (user_id, email)
select id, email
from auth.users
where lower(email) = lower('you@example.com')
on conflict (user_id) do nothing;

-- Check that it worked (should return one row):
select * from public.admins;
