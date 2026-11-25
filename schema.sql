-- =====================================================================
-- The Newlywed Game: 40 Years of Love
-- Supabase database schema, Row Level Security, and server-side functions
--
-- Run this whole file once in Supabase: Dashboard > SQL Editor > New query
-- > paste > Run. It is safe to re-run (it drops and recreates functions,
-- and only inserts seed rows that are missing).
--
-- Security model
-- --------------
-- * Parents never touch tables directly. Every table has RLS enabled and
--   the public "anon" role has NO table privileges at all.
-- * Each parent gets a private link containing a random 64-character
--   token (about 244 bits of randomness). Only a SHA-256 hash of the token
--   is stored. The survey_* functions below hash the token on the server,
--   find the ONE participant it belongs to, and only ever read or write
--   that participant's rows. There is no function that accepts a role
--   name from a parent, so a parent cannot ask for the other's answers.
-- * The administrator signs in with Supabase Auth (email + password) and
--   must also be listed in public.admins. RLS policies allow SELECT only
--   when public.is_admin() is true; admin_* functions re-check is_admin().
-- * The service-role key is never used by the website.
-- =====================================================================

-- A private schema for helpers. Supabase does not expose it over the API.
create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

create table if not exists public.questions (
  id      smallint primary key,
  prompt  text not null
);

create table if not exists public.participants (
  role             text primary key check (role in ('mom', 'dad')),
  label            text not null,
  token_hash       bytea unique,          -- sha256 of the private link token
  link_created_at  timestamptz,
  started_at       timestamptz,
  submitted_at     timestamptz,           -- null = not submitted
  updated_at       timestamptz
);

create table if not exists public.answers (
  role         text     not null references public.participants(role) on delete cascade,
  question_id  smallint not null references public.questions(id) on delete cascade,
  answer       text     not null default '' check (char_length(answer) <= 4000),
  updated_at   timestamptz not null default now(),
  updated_by   text not null default 'parent' check (updated_by in ('parent', 'admin')),
  primary key (role, question_id)
);

create table if not exists public.app_settings (
  id         int primary key default 1 check (id = 1),
  locked     boolean not null default false,
  locked_at  timestamptz
);

create table if not exists public.admins (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  email    text
);

-- ---------------------------------------------------------------------
-- Seed data
-- ---------------------------------------------------------------------

insert into public.questions (id, prompt) values
  (1,  'What is your favorite memory from your wedding day?'),
  (2,  'What is the secret to a happy 40-year marriage?'),
  (3,  'If you could relive one vacation or trip together, which would it be?'),
  (4,  'What is one thing your spouse would say you haven’t changed about yourself since you first met?'),
  (5,  'What is the one quality your spouse has that you admire most?'),
  (6,  'What is your favorite family tradition?'),
  (7,  'What is your favorite thing about each of your grandchildren?'),
  (8,  'What is your spouse’s favorite movie?'),
  (9,  'If you had to describe your spouse in three words, what would they be?'),
  (10, 'If your spouse were arrested, what would the most likely reason be?'),
  (11, 'What is your spouse’s catchphrase or the phrase they repeat so often that you could impersonate them?')
on conflict (id) do nothing;

insert into public.participants (role, label) values
  ('mom', 'Mom'),
  ('dad', 'Dad')
on conflict (role) do nothing;

insert into public.app_settings (id, locked) values (1, false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Privileges and Row Level Security
-- Supabase grants broad table privileges to anon/authenticated by
-- default, so we take them away explicitly and then grant back only
-- what the admin dashboard needs (read-only, filtered by RLS).
-- ---------------------------------------------------------------------

alter table public.questions    enable row level security;
alter table public.participants enable row level security;
alter table public.answers      enable row level security;
alter table public.app_settings enable row level security;
alter table public.admins       enable row level security;

alter table public.questions    force row level security;
alter table public.participants force row level security;
alter table public.answers      force row level security;
alter table public.app_settings force row level security;
alter table public.admins       force row level security;

revoke all on public.questions, public.participants, public.answers,
              public.app_settings, public.admins
  from anon, authenticated, public;

-- Admin dashboard reads (still subject to the RLS policies below).
grant select on public.questions, public.answers, public.app_settings
  to authenticated;
-- token_hash is deliberately not readable, even by the admin.
grant select (role, label, link_created_at, started_at, submitted_at, updated_at)
  on public.participants to authenticated;

-- is_admin(): true only for signed-in users listed in public.admins.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admins a where a.user_id = (select auth.uid())
  );
$$;

drop policy if exists "admin reads questions"    on public.questions;
drop policy if exists "admin reads participants" on public.participants;
drop policy if exists "admin reads answers"      on public.answers;
drop policy if exists "admin reads settings"     on public.app_settings;
drop policy if exists "admin reads admins"       on public.admins;

create policy "admin reads questions"    on public.questions
  for select to authenticated using ((select public.is_admin()));
create policy "admin reads participants" on public.participants
  for select to authenticated using ((select public.is_admin()));
create policy "admin reads answers"      on public.answers
  for select to authenticated using ((select public.is_admin()));
create policy "admin reads settings"     on public.app_settings
  for select to authenticated using ((select public.is_admin()));
create policy "admin reads admins"       on public.admins
  for select to authenticated using ((select public.is_admin()));

-- No INSERT/UPDATE/DELETE policies exist, so nobody can write tables
-- directly through the API. All writes go through the functions below.

-- ---------------------------------------------------------------------
-- Private helpers (not callable through the API)
-- ---------------------------------------------------------------------

create or replace function private.role_for_token(p_token text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.participants p
  where p_token ~ '^[0-9a-f]{64}$'
    and p.token_hash = sha256(convert_to(p_token, 'UTF8'));
$$;

create or replace function private.is_locked()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select locked from public.app_settings where id = 1), false);
$$;

-- Writes a parent's answers. p_answers is a JSON object like
-- {"1": "text", "2": "text"}; unknown question ids are ignored.
create or replace function private.write_answers(p_role text, p_answers jsonb, p_by text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    return;
  end if;

  insert into public.answers (role, question_id, answer, updated_at, updated_by)
  select p_role, q.id, left(coalesce(e.value, ''), 4000), now(), p_by
  from jsonb_each_text(p_answers) e
  join public.questions q on q.id::text = e.key
  on conflict (role, question_id) do update
    set answer = excluded.answer,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
    where public.answers.answer is distinct from excluded.answer;
end;
$$;

create or replace function private.answered_count(p_role text)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
  from public.answers a
  where a.role = p_role and btrim(a.answer) <> '';
$$;

revoke all on all functions in schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Parent-facing functions (callable with the public anon key).
-- Each one takes ONLY the private token. The token decides the parent.
-- ---------------------------------------------------------------------

drop function if exists public.survey_get(text);
drop function if exists public.survey_save(text, jsonb);
drop function if exists public.survey_submit(text, jsonb);

-- Returns the parent's own survey: who they are, the questions, their
-- own saved answers (so they can resume or edit), and status.
create function public.survey_get(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := private.role_for_token(p_token);
  v_result jsonb;
begin
  if v_role is null then
    raise exception 'invalid_link' using errcode = 'P0001';
  end if;

  select jsonb_build_object(
    'role', p.role,
    'label', p.label,
    'locked', private.is_locked(),
    'submitted_at', p.submitted_at,
    'questions', (select jsonb_agg(jsonb_build_object('id', q.id, 'prompt', q.prompt) order by q.id)
                  from public.questions q),
    'answers', coalesce((select jsonb_object_agg(a.question_id::text, a.answer)
                         from public.answers a where a.role = p.role), '{}'::jsonb)
  )
  into v_result
  from public.participants p
  where p.role = v_role;

  return v_result;
end;
$$;

-- Saves progress (partial answers allowed). Blocked when locked.
create function public.survey_save(p_token text, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := private.role_for_token(p_token);
  v_total int;
  v_done int;
  v_submitted timestamptz;
begin
  if v_role is null then
    raise exception 'invalid_link' using errcode = 'P0001';
  end if;
  if private.is_locked() then
    raise exception 'survey_locked' using errcode = 'P0001';
  end if;

  perform private.write_answers(v_role, p_answers, 'parent');

  select count(*) into v_total from public.questions;
  v_done := private.answered_count(v_role);

  update public.participants
     set started_at = coalesce(started_at, now()),
         updated_at = now(),
         -- If a submitted survey is edited and an answer is cleared, it is
         -- no longer complete, so it goes back to "in progress".
         submitted_at = case when v_done < v_total then null else submitted_at end
   where role = v_role
  returning submitted_at into v_submitted;

  return jsonb_build_object('saved_at', now(), 'answered', v_done,
                            'total', v_total, 'submitted_at', v_submitted);
end;
$$;

-- Saves and submits. Every question must have an answer.
create function public.survey_submit(p_token text, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := private.role_for_token(p_token);
  v_total int;
  v_done int;
begin
  if v_role is null then
    raise exception 'invalid_link' using errcode = 'P0001';
  end if;
  if private.is_locked() then
    raise exception 'survey_locked' using errcode = 'P0001';
  end if;

  perform private.write_answers(v_role, p_answers, 'parent');

  select count(*) into v_total from public.questions;
  v_done := private.answered_count(v_role);
  if v_done < v_total then
    raise exception 'incomplete' using errcode = 'P0001',
      detail = format('%s of %s questions answered', v_done, v_total);
  end if;

  update public.participants
     set started_at = coalesce(started_at, now()),
         updated_at = now(),
         submitted_at = now()
   where role = v_role;

  -- Deliberately returns no answers.
  return jsonb_build_object('submitted', true);
end;
$$;

revoke all on function public.survey_get(text)           from public;
revoke all on function public.survey_save(text, jsonb)   from public;
revoke all on function public.survey_submit(text, jsonb) from public;
grant execute on function public.survey_get(text)           to anon, authenticated;
grant execute on function public.survey_save(text, jsonb)   to anon, authenticated;
grant execute on function public.survey_submit(text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Admin-only functions (require a signed-in user listed in admins)
-- ---------------------------------------------------------------------

drop function if exists public.admin_generate_link(text);
drop function if exists public.admin_set_locked(boolean);
drop function if exists public.admin_update_answer(text, smallint, text);
drop function if exists public.admin_reset_survey(text);

-- Creates (or replaces) a parent's private link token. The plain token is
-- returned once; only its hash is stored. Replacing it disables the old link.
create function public.admin_generate_link(p_role text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if not public.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_role not in ('mom', 'dad') then
    raise exception 'bad_role' using errcode = 'P0001';
  end if;

  -- Two random v4 UUIDs = 64 hex characters, about 244 random bits.
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  update public.participants
     set token_hash = sha256(convert_to(v_token, 'UTF8')),
         link_created_at = now()
   where role = p_role;

  return v_token;
end;
$$;

create function public.admin_set_locked(p_locked boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.app_settings
     set locked = p_locked,
         locked_at = case when p_locked then now() else null end
   where id = 1;
  return jsonb_build_object('locked', p_locked);
end;
$$;

-- Lets the admin fix a typo or trim an answer before the party.
create function public.admin_update_answer(p_role text, p_question_id smallint, p_answer text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_role not in ('mom', 'dad') then
    raise exception 'bad_role' using errcode = 'P0001';
  end if;
  perform private.write_answers(p_role, jsonb_build_object(p_question_id::text, coalesce(p_answer, '')), 'admin');
end;
$$;

-- Clears one parent's answers and status (for testing before launch).
create function public.admin_reset_survey(p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  delete from public.answers where role = p_role;
  update public.participants
     set started_at = null, submitted_at = null, updated_at = null
   where role = p_role;
end;
$$;

revoke all on function public.is_admin()                                from public, anon;
revoke all on function public.admin_generate_link(text)                 from public, anon;
revoke all on function public.admin_set_locked(boolean)                 from public, anon;
revoke all on function public.admin_update_answer(text, smallint, text) from public, anon;
revoke all on function public.admin_reset_survey(text)                  from public, anon;
grant execute on function public.is_admin()                                to authenticated;
grant execute on function public.admin_generate_link(text)                 to authenticated;
grant execute on function public.admin_set_locked(boolean)                 to authenticated;
grant execute on function public.admin_update_answer(text, smallint, text) to authenticated;
grant execute on function public.admin_reset_survey(text)                  to authenticated;
