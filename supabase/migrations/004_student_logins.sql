-- SOBO · 004 — student logins teachers can read back
-- Run once in the Supabase SQL editor (after 001–003), then re-deploy the manage-students Edge Function.
--
-- * A student's username is now exactly the name the teacher typed (e.g. "Aarav K"), capital letters and spaces included.
--   Two usernames that only differ in capitals or spacing ("Aarav K" / "aarav  k") count as the same name.
-- * Passwords made by SOBO are short "word-number" pairs (e.g. tiger-42) and are kept in student_credentials so the
--   teacher can look them up again from the Students tab. Only that student's teachers can read them.
--   Passwords that students choose themselves (Join a class) are never stored.

-- 1) one "login key" per username: lower case, spaces → dots, other symbols spelled out -------------------
create or replace function public.username_key(u text)
returns text language plpgsql immutable as $$
declare
  s text := regexp_replace(lower(normalize(trim(coalesce(u, '')), NFKC)), '\s+', '.', 'g');
  res text := '';
  ch text;
begin
  for i in 1 .. char_length(s) loop
    ch := substr(s, i, 1);
    if ch ~ '[a-z0-9._-]' then res := res || ch;
    else res := res || 'x' || to_hex(ascii(ch));
    end if;
  end loop;
  return regexp_replace(res, '\.{2,}', '.', 'g');
end $$;

-- usernames must be unique by their login key (catches "Aarav" vs "aarav")
do $$ begin
  create unique index if not exists profiles_username_key_idx on public.profiles (public.username_key(username)) where username is not null;
exception when others then
  raise notice 'Could not add the unique username index (two existing usernames clash): %', sqlerrm;
end $$;

-- keep the username exactly as typed (it used to be lower-cased)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  r text := case when meta->>'role' = 'teacher' then 'teacher' else 'student' end;  -- never 'admin' from signup
  code text := upper(trim(coalesce(meta->>'class_code', '')));
  cls public.classes%rowtype;
  uname text := nullif(regexp_replace(trim(coalesce(meta->>'username', '')), '\s+', ' ', 'g'), '');
begin
  if r = 'student' and code <> '' then
    select * into cls from public.classes where join_code = code;
    if not found then
      raise exception 'Class code % was not found. Check the code with your teacher.', code;
    end if;
  end if;

  insert into public.profiles (id, role, display_name, username, grade)
  values (new.id, r,
          coalesce(nullif(trim(meta->>'display_name'), ''), split_part(coalesce(new.email, ''), '@', 1)),
          uname,
          case when r = 'student' then coalesce(cls.grade, nullif(meta->>'grade', '')::int) end);

  if cls.id is not null then
    insert into public.class_members (class_id, student_id) values (cls.id, new.id);
  end if;
  return new;
end $$;

-- which of these names are already used? (called by the Edge Function only)
create or replace function public.usernames_taken(p_names text[])
returns setof text language sql stable security definer set search_path = public as $$
  select n from unnest(p_names) n
  where exists (select 1 from public.profiles p where p.username is not null
                and public.username_key(p.username) = public.username_key(n))
$$;
revoke all on function public.usernames_taken(text[]) from public, anon, authenticated;

-- 2) saved logins -------------------------------------------------------------------------------------
create table if not exists public.student_credentials (
  student_id uuid primary key references public.profiles(id) on delete cascade,
  username text not null,
  password text not null,
  updated_at timestamptz not null default now()
);
alter table public.student_credentials enable row level security;
drop policy if exists student_credentials_teacher_read on public.student_credentials;
create policy student_credentials_teacher_read on public.student_credentials
  for select to authenticated using (public.teaches_student(student_id));
-- no insert/update/delete policies: only the Edge Function (service role) writes here
