-- TEST ONLY. Run after supabase_stub.sql and schema.sql (see run_sql_tests.sh).
-- Every check raises an exception on failure, so the script stops at the
-- first broken guarantee.
\set ON_ERROR_STOP 1
\set QUIET 1

-- Two auth users: the real admin, and a random person who signed up.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000aaaa', 'admin@example.com'),
  ('00000000-0000-0000-0000-00000000bbbb', 'stranger@example.com')
on conflict do nothing;
-- Same statement as supabase/make_admin.sql, with the test email.
insert into public.admins (user_id, email)
select id, email from auth.users where lower(email) = lower('Admin@Example.com')
on conflict (user_id) do nothing;

create temporary table t_tokens (role text primary key, token text);
grant all on t_tokens to anon, authenticated;

create or replace function pg_temp.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'EXPECTED ERROR "%" but statement succeeded: %', p_like, p_sql;
exception when others then
  if sqlerrm like 'EXPECTED ERROR%' then raise; end if;
  if sqlerrm not like p_like then
    raise exception 'Expected error like "%" but got "%" for: %', p_like, sqlerrm, p_sql;
  end if;
end $$;
grant execute on function pg_temp.expect_error(text, text) to anon, authenticated;

\echo '--- 1. Anonymous visitor cannot read or write any table directly'
set role anon;
select set_config('request.jwt.claims', '', false);
select pg_temp.expect_error('select * from public.answers', 'permission denied%');
select pg_temp.expect_error('select * from public.participants', 'permission denied%');
select pg_temp.expect_error('select * from public.questions', 'permission denied%');
select pg_temp.expect_error('select * from public.app_settings', 'permission denied%');
select pg_temp.expect_error('select * from public.admins', 'permission denied%');
select pg_temp.expect_error($q$insert into public.answers(role, question_id, answer) values ('mom', 1, 'x')$q$, 'permission denied%');
select pg_temp.expect_error($q$update public.app_settings set locked = false$q$, 'permission denied%');
\echo '--- 2. Anonymous visitor cannot call admin functions or private helpers'
select pg_temp.expect_error($q$select public.admin_generate_link('mom')$q$, 'permission denied%');
select pg_temp.expect_error($q$select public.admin_set_locked(false)$q$, 'permission denied%');
select pg_temp.expect_error($q$select public.admin_update_answer('mom', 1::smallint, 'x')$q$, 'permission denied%');
select pg_temp.expect_error($q$select private.role_for_token('x')$q$, 'permission denied%');
\echo '--- 3. Bad or missing tokens are rejected'
select pg_temp.expect_error($q$select public.survey_get('')$q$, 'invalid_link');
select pg_temp.expect_error($q$select public.survey_get(null)$q$, 'invalid_link');
select pg_temp.expect_error($q$select public.survey_get('mom')$q$, 'invalid_link');
select pg_temp.expect_error($q$select public.survey_get(repeat('a', 64))$q$, 'invalid_link');
select pg_temp.expect_error($q$select public.survey_get(''' or 1=1 --')$q$, 'invalid_link');
reset role;

\echo '--- 4. A signed-up stranger (authenticated but not admin) sees nothing'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000bbbb","role":"authenticated"}', false);
do $$ begin
  if public.is_admin() then raise exception 'stranger should not be admin'; end if;
  if (select count(*) from public.answers) <> 0 then raise exception 'stranger can see answers'; end if;
  if (select count(*) from public.participants) <> 0 then raise exception 'stranger can see participants'; end if;
  if (select count(*) from public.questions) <> 0 then raise exception 'stranger can see questions'; end if;
end $$;
select pg_temp.expect_error($q$select public.admin_generate_link('mom')$q$, 'not_authorized');
select pg_temp.expect_error($q$select public.admin_set_locked(true)$q$, 'not_authorized');
select pg_temp.expect_error($q$select public.admin_update_answer('dad', 1::smallint, 'hacked')$q$, 'not_authorized');
select pg_temp.expect_error($q$select public.admin_reset_survey('dad')$q$, 'not_authorized');
select pg_temp.expect_error($q$insert into public.admins(user_id) values ('00000000-0000-0000-0000-00000000bbbb')$q$, 'permission denied%');
reset role;

\echo '--- 5. Admin generates both private links'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000aaaa","role":"authenticated"}', false);
do $$ begin
  if not public.is_admin() then raise exception 'admin should be admin'; end if;
end $$;
insert into t_tokens values ('mom', public.admin_generate_link('mom')), ('dad', public.admin_generate_link('dad'));
do $$ begin
  if (select count(distinct token) from t_tokens where token ~ '^[0-9a-f]{64}$') <> 2 then
    raise exception 'tokens malformed';
  end if;
end $$;
-- Admin cannot read token hashes.
select pg_temp.expect_error('select token_hash from public.participants', 'permission denied%');
reset role;

\echo '--- 6. Mom saves progress; Dad submits; neither sees the other'
set role anon;
select set_config('request.jwt.claims', '', false);
do $$
declare
  mom text := (select token from t_tokens where role = 'mom');
  dad text := (select token from t_tokens where role = 'dad');
  r jsonb;
begin
  r := public.survey_get(mom);
  if r->>'role' <> 'mom' or r->>'label' <> 'Mom' then raise exception 'mom link resolved to %', r->>'role'; end if;
  if jsonb_array_length(r->'questions') <> 11 then raise exception 'expected 11 questions'; end if;

  r := public.survey_save(mom, '{"1":"MOM-SECRET-1 Dancing to our song","2":"MOM-SECRET-2 Patience"}');
  if (r->>'answered')::int <> 2 or r->>'submitted_at' is not null then raise exception 'mom save wrong: %', r; end if;

  -- Mom cannot submit an incomplete survey.
  begin
    perform public.survey_submit(mom, '{}');
    raise exception 'incomplete submit allowed';
  exception when others then
    if sqlerrm <> 'incomplete' then raise; end if;
  end;

  -- Dad answers everything and submits.
  r := public.survey_submit(dad, (select jsonb_object_agg(g::text, 'DAD-SECRET-' || g) from generate_series(1, 11) g));
  if (r->>'submitted')::boolean is not true then raise exception 'dad submit failed'; end if;
  if r ? 'answers' then raise exception 'submit should not echo answers'; end if;

  -- Mom's view contains only Mom's answers.
  r := public.survey_get(mom);
  if r::text like '%DAD-SECRET%' then raise exception 'MOM CAN SEE DAD ANSWERS'; end if;
  if r->'answers'->>'1' not like 'MOM-SECRET-1%' then raise exception 'mom lost her own draft'; end if;

  -- Dad's view contains only Dad's answers.
  r := public.survey_get(dad);
  if r::text like '%MOM-SECRET%' then raise exception 'DAD CAN SEE MOM ANSWERS'; end if;
  if r->>'role' <> 'dad' or r->>'submitted_at' is null then raise exception 'dad status wrong'; end if;

  -- Writing through one token never changes the other parent's rows,
  -- even if the payload is crafted to look like the other parent.
  perform public.survey_save(mom, '{"role":"dad","3":"MOM-SECRET-3"}');
  r := public.survey_get(dad);
  if r->'answers'->>'3' <> 'DAD-SECRET-3' then raise exception 'mom overwrote dad'; end if;
end $$;
reset role;

\echo '--- 7. Admin sees both parents side by side'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000aaaa","role":"authenticated"}', false);
do $$ begin
  if (select count(*) from public.answers where role = 'dad') <> 11 then raise exception 'admin cannot see dad answers'; end if;
  if (select count(*) from public.answers where role = 'mom') <> 3 then raise exception 'admin cannot see mom answers'; end if;
  if (select submitted_at from public.participants where role = 'dad') is null then raise exception 'dad not marked complete'; end if;
  if (select submitted_at from public.participants where role = 'mom') is not null then raise exception 'mom wrongly complete'; end if;
end $$;
select public.admin_update_answer('dad', 8::smallint, 'Casablanca (admin edit)');
select public.admin_set_locked(true);
reset role;

\echo '--- 8. Locked survey rejects parent edits'
set role anon;
select set_config('request.jwt.claims', '', false);
select pg_temp.expect_error(format($q$select public.survey_save(%L, '{"4":"late"}')$q$, (select token from t_tokens where role = 'mom')), 'survey_locked');
select pg_temp.expect_error(format($q$select public.survey_submit(%L, '{"4":"late"}')$q$, (select token from t_tokens where role = 'dad')), 'survey_locked');
do $$ begin
  if (public.survey_get((select token from t_tokens where role = 'mom'))->>'locked')::boolean is not true then
    raise exception 'lock flag not reported';
  end if;
end $$;
reset role;

\echo '--- 9. Reopen, then clearing an answer returns a submitted survey to in-progress'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000aaaa","role":"authenticated"}', false);
select public.admin_set_locked(false);
reset role;
set role anon;
do $$
declare dad text := (select token from t_tokens where role = 'dad'); r jsonb;
begin
  r := public.survey_save(dad, '{"5":"   "}');
  if r->>'submitted_at' is not null then raise exception 'cleared answer should un-submit'; end if;
  perform public.survey_submit(dad, '{"5":"DAD-SECRET-5 again"}');
  if public.survey_get(dad)->>'submitted_at' is null then raise exception 'resubmit failed'; end if;
end $$;
reset role;

\echo '--- 10. Regenerating a link disables the old one'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000aaaa","role":"authenticated"}', false);
insert into t_tokens select 'mom_old', token from t_tokens where role = 'mom';
update t_tokens set token = public.admin_generate_link('mom') where role = 'mom';
reset role;
set role anon;
select pg_temp.expect_error(format('select public.survey_get(%L)', (select token from t_tokens where role = 'mom_old')), 'invalid_link');
do $$ begin
  if public.survey_get((select token from t_tokens where role = 'mom'))->>'role' <> 'mom' then raise exception 'new link broken'; end if;
end $$;
reset role;

\echo 'ALL DATABASE SECURITY TESTS PASSED'
