-- =====================================================================
-- BodyQuest 3D — database schema, security (RLS) and server functions
-- Run this whole file once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Then run supabase/seed.sql (organ models, learning content, question bank, badges).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public.level_for_grade(g int)
returns text language sql immutable as $$
  select case when g is null then 'simple' when g <= 4 then 'simple' when g <= 6 then 'medium' else 'full' end
$$;

create or replace function public.random_code(n int default 6)
returns text language plpgsql volatile as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- no 0/O/1/I to avoid confusion
  out text := '';
begin
  for i in 1..n loop
    out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return out;
end $$;

-- ---------------------------------------------------------------------
-- Users & classes
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'student' check (role in ('student', 'teacher', 'admin')),
  display_name text not null default '',
  username text unique,
  grade int check (grade between 4 and 7),
  xp int not null default 0,
  streak int not null default 0,
  best_streak int not null default 0,
  last_active date,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  grade int not null check (grade between 4 and 7),
  level_override text check (level_override in ('simple', 'medium', 'full')),
  join_code text not null unique default public.random_code(6),
  created_at timestamptz not null default now()
);

create table if not exists public.class_members (
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (class_id, student_id)
);
create index if not exists class_members_student_idx on public.class_members(student_id);

-- ---------------------------------------------------------------------
-- Content (filled by seed.sql)
-- ---------------------------------------------------------------------
create table if not exists public.organ_models (
  id bigint generated always as identity primary key,
  system text not null,
  level text not null check (level in ('simple', 'medium', 'full')),
  slug text not null,
  label text not null,
  model_path text not null,
  color text,
  position_x real, position_y real, position_z real,
  size_x real, size_y real, size_z real,
  unique (system, level, slug)
);

create table if not exists public.organ_content (
  system text not null,
  slug text not null,
  about text not null,
  location text not null,
  function text not null,
  fun_fact text not null,
  primary key (system, slug)
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  system text not null,
  level text not null check (level in ('simple', 'medium', 'full')),
  type text not null check (type in ('mcq', 'true_false', 'click_organ', 'label_match', 'order')),
  prompt text not null,
  options jsonb not null default '{}'::jsonb,
  explanation text not null default '',
  slug text,                         -- main organ the question is about (for weak-spot stats)
  created_by uuid references public.profiles(id) on delete cascade,  -- null = built-in bank
  created_at timestamptz not null default now()
);
create index if not exists questions_bank_idx on public.questions(system, level);

-- Answers live in their own table that students can never read directly.
create table if not exists public.question_answers (
  question_id uuid primary key references public.questions(id) on delete cascade,
  answer jsonb not null
);

create table if not exists public.badges (
  code text primary key,
  name text not null,
  description text not null,
  icon text not null default '🏅'
);

-- ---------------------------------------------------------------------
-- Progress data (everything students do is stored)
-- ---------------------------------------------------------------------
create table if not exists public.learn_progress (
  student_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  system text not null,
  slug text not null,
  level text not null,
  learned boolean not null default false,
  views int not null default 1,
  first_viewed_at timestamptz not null default now(),
  learned_at timestamptz,
  primary key (student_id, system, slug)
);

create table if not exists public.quick_checks (
  id bigint generated always as identity primary key,
  student_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  system text not null,
  level text not null,
  score int not null check (score >= 0),
  total int not null check (total > 0 and score <= total),
  created_at timestamptz not null default now()
);

create table if not exists public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  game text not null check (game in ('organ_blaster', 'system_builder')),
  system text not null,
  level text not null,
  score int not null default 0 check (score >= 0 and score <= 1000000),
  accuracy real check (accuracy between 0 and 1),
  wave_reached int,
  stars int check (stars between 0 and 3),
  attempts int,
  duration_ms int,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists game_sessions_student_idx on public.game_sessions(student_id, game);

create table if not exists public.game_events (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  student_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  system text not null,
  slug text not null,
  prompt_type text not null default 'name',   -- name | function | placement
  correct boolean not null,
  response_ms int,
  created_at timestamptz not null default now()
);
create index if not exists game_events_student_idx on public.game_events(student_id);

create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  title text not null,
  systems text[] not null,
  level text not null check (level in ('simple', 'medium', 'full')),
  time_limit_sec int check (time_limit_sec is null or time_limit_sec between 60 and 7200),
  due_at timestamptz,
  allow_retake boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.assessment_questions (
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  position int not null,
  primary key (assessment_id, question_id)
);

create table if not exists public.assessment_attempts (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid references public.assessments(id) on delete cascade,  -- null = practice
  student_id uuid not null references public.profiles(id) on delete cascade,
  is_practice boolean not null default false,
  systems text[] not null,
  level text not null,
  question_ids uuid[] not null,
  time_limit_sec int,
  score int,
  total int,
  percent real,
  started_at timestamptz not null default now(),
  submitted_at timestamptz
);
create index if not exists attempts_student_idx on public.assessment_attempts(student_id);

create table if not exists public.attempt_answers (
  attempt_id uuid not null references public.assessment_attempts(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  system text not null,
  slug text,
  response jsonb,
  correct boolean not null,
  primary key (attempt_id, question_id)
);

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  teacher_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  type text not null check (type in ('learn', 'game', 'assessment')),
  title text not null,
  system text,
  game text check (game in ('organ_blaster', 'system_builder')),
  target_score int,
  assessment_id uuid references public.assessments(id) on delete cascade,
  due_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.student_badges (
  student_id uuid not null references public.profiles(id) on delete cascade,
  badge_code text not null references public.badges(code) on delete cascade,
  earned_at timestamptz not null default now(),
  primary key (student_id, badge_code)
);

-- ---------------------------------------------------------------------
-- Security helper functions (SECURITY DEFINER so they can look across tables without RLS loops)
-- ---------------------------------------------------------------------
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.teaches_student(sid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.class_members cm join public.classes c on c.id = cm.class_id
    where cm.student_id = sid and c.teacher_id = auth.uid())
$$;

create or replace function public.in_class(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.class_members where class_id = cid and student_id = auth.uid())
$$;

create or replace function public.owns_class(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.classes where id = cid and teacher_id = auth.uid())
$$;

-- The level a student sees: their most recent class's override, else from their grade.
create or replace function public.student_level(sid uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select c.level_override from public.class_members cm join public.classes c on c.id = cm.class_id
      where cm.student_id = sid and c.level_override is not null order by cm.joined_at desc limit 1),
    public.level_for_grade((select grade from public.profiles where id = sid)))
$$;

-- ---------------------------------------------------------------------
-- New user → profile (+ join class when a class code was given)
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  r text := case when meta->>'role' = 'teacher' then 'teacher' else 'student' end;  -- never 'admin' from signup
  code text := upper(trim(coalesce(meta->>'class_code', '')));
  cls public.classes%rowtype;
  uname text := nullif(lower(trim(coalesce(meta->>'username', ''))), '');
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- XP, streaks and badges (all server-side)
-- ---------------------------------------------------------------------
create or replace function public.award_badges(uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  p public.profiles%rowtype;
  lvl text;
begin
  select * into p from public.profiles where id = uid;
  if not found then return; end if;
  lvl := public.student_level(uid);

  insert into public.student_badges (student_id, badge_code)
  select uid, b.code from public.badges b
  where not exists (select 1 from public.student_badges sb where sb.student_id = uid and sb.badge_code = b.code)
    and case b.code
      when 'first-organ' then exists (select 1 from public.learn_progress where student_id = uid and learned)
      when 'curious-mind' then (select count(*) from public.learn_progress where student_id = uid and learned) >= 25
      when 'system-master' then exists (
        select 1 from (select system, count(*) n from public.organ_models where level = lvl group by system) t
        where t.n <= (select count(*) from public.learn_progress lp join public.organ_models om
                       on om.system = lp.system and om.slug = lp.slug and om.level = lvl
                      where lp.student_id = uid and lp.learned and lp.system = t.system))
      when 'sharpshooter' then exists (select 1 from public.game_sessions where student_id = uid
        and game = 'organ_blaster' and ended_at is not null and accuracy >= 0.9 and wave_reached >= 3)
      when 'master-builder' then exists (select 1 from public.game_sessions where student_id = uid
        and game = 'system_builder' and stars = 3)
      when 'all-systems-go' then (select count(distinct system) from public.game_sessions where student_id = uid
        and game = 'system_builder' and stars = 3) >= 4
      when 'top-of-class' then exists (select 1 from public.assessment_attempts where student_id = uid
        and submitted_at is not null and percent >= 90)
      when 'perfect-score' then exists (select 1 from public.assessment_attempts where student_id = uid
        and submitted_at is not null and percent = 100 and total >= 5)
      when 'on-fire' then p.best_streak >= 7
      when 'xp-1000' then p.xp >= 1000
      else false end;
end $$;

create or replace function public.add_xp(uid uuid, amount int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if amount is null or amount <= 0 then return; end if;
  update public.profiles set xp = xp + amount where id = uid;
  perform public.award_badges(uid);
end $$;

-- Called by every student page on load: keeps the daily streak.
create or replace function public.touch_activity()
returns public.profiles language plpgsql security definer set search_path = public as $$
declare
  p public.profiles%rowtype;
  today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select * into p from public.profiles where id = auth.uid();
  if not found then raise exception 'Not signed in'; end if;
  if p.last_active is distinct from today then
    update public.profiles set
      streak = case when p.last_active = today - 1 then p.streak + 1 else 1 end,
      best_streak = greatest(best_streak, case when p.last_active = today - 1 then p.streak + 1 else 1 end),
      last_active = today
    where id = p.id returning * into p;
    perform public.award_badges(p.id);
  end if;
  return p;
end $$;

create or replace function public.trg_learn_stamp()
returns trigger language plpgsql as $$
begin
  if new.learned and (tg_op = 'INSERT' or not old.learned) then new.learned_at := now(); end if;
  if tg_op = 'UPDATE' and old.learned then new.learned := true; new.learned_at := old.learned_at; end if;  -- never "unlearn"
  return new;
end $$;
drop trigger if exists learn_xp on public.learn_progress;
drop trigger if exists learn_stamp on public.learn_progress;
create trigger learn_stamp before insert or update on public.learn_progress
  for each row execute function public.trg_learn_stamp();

-- XP in an AFTER trigger: BEFORE INSERT also fires for upserts that end up as updates
create or replace function public.trg_learn_xp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.learned and (tg_op = 'INSERT' or not old.learned) then
    perform public.add_xp(new.student_id, 10);
  end if;
  return null;
end $$;
drop trigger if exists learn_badges on public.learn_progress;
drop trigger if exists learn_xp_after on public.learn_progress;
create trigger learn_xp_after after insert or update on public.learn_progress
  for each row execute function public.trg_learn_xp();

create or replace function public.trg_game_end()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.ended_at is not null and old.ended_at is null then
    perform public.add_xp(new.student_id, 10 + least(new.score / 50, 90));
  end if;
  return null;
end $$;
drop trigger if exists game_end on public.game_sessions;
create trigger game_end after update on public.game_sessions
  for each row execute function public.trg_game_end();

-- A finished game can't be edited again (stops replaying the "end" to farm XP).
create or replace function public.trg_game_lock()
returns trigger language plpgsql as $$
begin
  if old.ended_at is not null then raise exception 'This game session is already finished'; end if;
  if new.student_id <> old.student_id or new.game <> old.game then raise exception 'Not allowed'; end if;
  return new;
end $$;
drop trigger if exists game_lock on public.game_sessions;
create trigger game_lock before update on public.game_sessions
  for each row execute function public.trg_game_lock();

create or replace function public.trg_quick_check_xp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.add_xp(new.student_id, new.score * 3);
  return null;
end $$;
drop trigger if exists quick_check_xp on public.quick_checks;
create trigger quick_check_xp after insert on public.quick_checks
  for each row execute function public.trg_quick_check_xp();

-- ---------------------------------------------------------------------
-- Mastery: one 0–100 score per student per organ, from learning + games + tests
-- ---------------------------------------------------------------------
create or replace view public.organ_mastery with (security_invoker = on) as
with g as (
  select student_id, system, slug, count(*) total, count(*) filter (where correct) ok
  from public.game_events group by 1, 2, 3
), q as (
  select student_id, system, slug, count(*) total, count(*) filter (where correct) ok
  from public.attempt_answers where slug is not null group by 1, 2, 3
), l as (
  select student_id, system, slug, learned from public.learn_progress
), k as (
  select student_id, system, slug from l union select student_id, system, slug from g
  union select student_id, system, slug from q
)
select k.student_id, k.system, k.slug,
       coalesce(l.learned, false) as learned,
       coalesce(g.ok, 0)::int as game_correct, coalesce(g.total, 0)::int as game_total,
       coalesce(q.ok, 0)::int as quiz_correct, coalesce(q.total, 0)::int as quiz_total,
       round(100 * (
         0.2 * (case when coalesce(l.learned, false) then 1 else 0 end)
         + 0.4 * coalesce(g.ok::numeric / nullif(g.total, 0), 0)
         + 0.4 * coalesce(q.ok::numeric / nullif(q.total, 0), 0)
       ) / (0.2 + case when g.total > 0 then 0.4 else 0 end + case when q.total > 0 then 0.4 else 0 end))::int as mastery
from k
left join l using (student_id, system, slug)
left join g using (student_id, system, slug)
left join q using (student_id, system, slug);

-- ---------------------------------------------------------------------
-- RPCs for students
-- ---------------------------------------------------------------------
create or replace function public.join_class(p_code text)
returns public.classes language plpgsql security definer set search_path = public as $$
declare cls public.classes%rowtype;
begin
  if public.my_role() <> 'student' then raise exception 'Only students can join a class'; end if;
  select * into cls from public.classes where join_code = upper(trim(p_code));
  if not found then raise exception 'Class code not found'; end if;
  insert into public.class_members (class_id, student_id) values (cls.id, auth.uid()) on conflict do nothing;
  update public.profiles set grade = cls.grade where id = auth.uid();
  return cls;
end $$;

create or replace function public.my_classes()
returns table (class_id uuid, name text, grade int, teacher_name text, level text)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.grade, t.display_name, coalesce(c.level_override, public.level_for_grade(c.grade))
  from public.class_members cm join public.classes c on c.id = cm.class_id
  join public.profiles t on t.id = c.teacher_id
  where cm.student_id = auth.uid() order by cm.joined_at desc
$$;

create or replace function public.my_level()
returns text language sql stable security definer set search_path = public as $$
  select public.student_level(auth.uid())
$$;

-- Start a test. Assigned test: p_assessment set. Practice: p_systems (+ optional p_count).
-- Returns the questions WITHOUT answers.
create or replace function public.start_attempt(p_assessment uuid default null, p_systems text[] default null,
                                                p_count int default 10)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a public.assessments%rowtype;
  att public.assessment_attempts%rowtype;
  lvl text;
  qids uuid[];
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;

  if p_assessment is not null then
    select * into a from public.assessments where id = p_assessment;
    if not found or not public.in_class(a.class_id) then raise exception 'Test not found'; end if;
    -- resume an unfinished attempt
    select * into att from public.assessment_attempts
      where assessment_id = a.id and student_id = auth.uid() and submitted_at is null
      order by started_at desc limit 1;
    if not found then
      if not a.allow_retake and exists (select 1 from public.assessment_attempts
          where assessment_id = a.id and student_id = auth.uid() and submitted_at is not null) then
        raise exception 'You have already finished this test';
      end if;
      select array_agg(question_id order by position) into qids
        from public.assessment_questions where assessment_id = a.id;
      insert into public.assessment_attempts (assessment_id, student_id, is_practice, systems, level, question_ids, time_limit_sec)
      values (a.id, auth.uid(), false, a.systems, a.level, qids, a.time_limit_sec) returning * into att;
    end if;
  else
    if p_systems is null or array_length(p_systems, 1) is null then raise exception 'Choose at least one body system'; end if;
    lvl := public.student_level(auth.uid());
    select array_agg(id) into qids from (
      select id from public.questions
      where system = any(p_systems) and level = lvl and created_by is null
      order by random() limit greatest(1, least(coalesce(p_count, 10), 30))) s;
    if qids is null then raise exception 'No questions available for that choice yet'; end if;
    insert into public.assessment_attempts (assessment_id, student_id, is_practice, systems, level, question_ids)
    values (null, auth.uid(), true, p_systems, lvl, qids) returning * into att;
  end if;

  return jsonb_build_object(
    'attempt_id', att.id, 'title', coalesce(a.title, 'Practice test'), 'level', att.level,
    'time_limit_sec', att.time_limit_sec, 'started_at', att.started_at,
    'questions', (select jsonb_agg(jsonb_build_object('id', q.id, 'type', q.type, 'prompt', q.prompt,
                    'options', q.options, 'system', q.system, 'level', q.level) order by o.ord)
                  from unnest(att.question_ids) with ordinality o(qid, ord) join public.questions q on q.id = o.qid));
end $$;

create or replace function public.grade_answer(p_type text, p_answer jsonb, p_response jsonb)
returns boolean language sql immutable as $$
  select case
    when p_response is null or p_response = 'null'::jsonb then false
    when p_type in ('mcq', 'true_false', 'click_organ') then
      lower(trim(p_response #>> '{}')) = lower(trim(p_answer->>'value'))
    when p_type in ('label_match', 'order') then p_response = p_answer->'value'
    else false end
$$;

create or replace function public.submit_attempt(p_attempt uuid, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  att public.assessment_attempts%rowtype;
  n_ok int; n_total int;
begin
  select * into att from public.assessment_attempts where id = p_attempt and student_id = auth.uid() for update;
  if not found then raise exception 'Test not found'; end if;
  if att.submitted_at is not null then raise exception 'This test was already submitted'; end if;

  insert into public.attempt_answers (attempt_id, question_id, student_id, system, slug, response, correct)
  select att.id, q.id, att.student_id, q.system, q.slug, p_answers -> q.id::text,
         public.grade_answer(q.type, qa.answer, p_answers -> q.id::text)
  from unnest(att.question_ids) qid join public.questions q on q.id = qid
  join public.question_answers qa on qa.question_id = q.id;

  select count(*) filter (where correct), count(*) into n_ok, n_total
  from public.attempt_answers where attempt_id = att.id;

  update public.assessment_attempts set score = n_ok, total = n_total,
    percent = round(100.0 * n_ok / greatest(n_total, 1), 1), submitted_at = now()
  where id = att.id;

  perform public.add_xp(att.student_id, 5 * n_ok + case when att.is_practice then 0 else 20 end);

  return jsonb_build_object('score', n_ok, 'total', n_total,
    'percent', round(100.0 * n_ok / greatest(n_total, 1), 1),
    'results', (select jsonb_agg(jsonb_build_object('id', q.id, 'prompt', q.prompt, 'type', q.type,
                  'options', q.options, 'response', aa.response, 'correct', aa.correct,
                  'answer', qa.answer->'value', 'explanation', q.explanation, 'system', q.system, 'level', q.level) order by o.ord)
                from unnest(att.question_ids) with ordinality o(qid, ord)
                join public.questions q on q.id = o.qid
                join public.question_answers qa on qa.question_id = q.id
                join public.attempt_answers aa on aa.attempt_id = att.id and aa.question_id = q.id));
end $$;

-- Results of an attempt you already submitted (students: own; teachers: their students)
create or replace function public.attempt_review(p_attempt uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare att public.assessment_attempts%rowtype;
begin
  select * into att from public.assessment_attempts where id = p_attempt;
  if not found or att.submitted_at is null or not (att.student_id = auth.uid() or public.teaches_student(att.student_id)) then
    raise exception 'Not found';
  end if;
  return jsonb_build_object('score', att.score, 'total', att.total, 'percent', att.percent,
    'results', (select jsonb_agg(jsonb_build_object('id', q.id, 'prompt', q.prompt, 'type', q.type,
                  'options', q.options, 'response', aa.response, 'correct', aa.correct,
                  'answer', qa.answer->'value', 'explanation', q.explanation, 'system', q.system, 'level', q.level) order by o.ord)
                from unnest(att.question_ids) with ordinality o(qid, ord)
                join public.questions q on q.id = o.qid
                join public.question_answers qa on qa.question_id = q.id
                join public.attempt_answers aa on aa.attempt_id = att.id and aa.question_id = q.id));
end $$;

-- ---------------------------------------------------------------------
-- RPCs for teachers
-- ---------------------------------------------------------------------
create or replace function public.regenerate_join_code(p_class uuid)
returns text language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.owns_class(p_class) then raise exception 'Not your class'; end if;
  loop
    c := public.random_code(6);
    exit when not exists (select 1 from public.classes where join_code = c);
  end loop;
  update public.classes set join_code = c where id = p_class;
  return c;
end $$;

create or replace function public.remove_student(p_class uuid, p_student uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.owns_class(p_class) then raise exception 'Not your class'; end if;
  delete from public.class_members where class_id = p_class and student_id = p_student;
end $$;

-- Teacher adds their own question (answer stored privately)
create or replace function public.add_question(p_system text, p_level text, p_type text, p_prompt text,
                                               p_options jsonb, p_answer jsonb, p_explanation text, p_slug text)
returns uuid language plpgsql security definer set search_path = public as $$
declare qid uuid;
begin
  if public.my_role() not in ('teacher', 'admin') then raise exception 'Only teachers can add questions'; end if;
  insert into public.questions (system, level, type, prompt, options, explanation, slug, created_by)
  values (p_system, p_level, p_type, p_prompt, coalesce(p_options, '{}'::jsonb), coalesce(p_explanation, ''),
          p_slug, auth.uid()) returning id into qid;
  insert into public.question_answers values (qid, jsonb_build_object('value', p_answer));
  return qid;
end $$;

-- Teacher creates a test: questions picked at random from the bank (+ their own) unless p_question_ids given
create or replace function public.create_assessment(p_class uuid, p_title text, p_systems text[], p_level text,
    p_count int, p_time_limit_sec int, p_due_at timestamptz, p_allow_retake boolean,
    p_question_ids uuid[] default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare aid uuid; qids uuid[];
begin
  if not public.owns_class(p_class) then raise exception 'Not your class'; end if;
  if p_question_ids is not null and array_length(p_question_ids, 1) > 0 then
    select array_agg(id) into qids from public.questions
      where id = any(p_question_ids) and (created_by is null or created_by = auth.uid());
  else
    select array_agg(id) into qids from (
      select id from public.questions
      where system = any(p_systems) and level = p_level and (created_by is null or created_by = auth.uid())
      order by random() limit greatest(1, least(coalesce(p_count, 10), 40))) s;
  end if;
  if qids is null then raise exception 'No questions match those choices'; end if;
  insert into public.assessments (teacher_id, class_id, title, systems, level, time_limit_sec, due_at, allow_retake)
  values (auth.uid(), p_class, p_title, p_systems, p_level, p_time_limit_sec, p_due_at, coalesce(p_allow_retake, false))
  returning id into aid;
  insert into public.assessment_questions (assessment_id, question_id, position)
  select aid, q, o from unnest(qids) with ordinality t(q, o);
  insert into public.assignments (class_id, teacher_id, type, title, assessment_id, due_at)
  values (p_class, auth.uid(), 'assessment', p_title, aid, p_due_at);
  return aid;
end $$;

-- One row per student: the class roster with a progress summary
create or replace function public.class_overview(p_class uuid)
returns table (student_id uuid, display_name text, username text, xp int, streak int, last_active date,
               organs_learned bigint, games_played bigint, best_blaster int, builder_stars bigint,
               tests_taken bigint, avg_test_percent numeric, avg_mastery numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.owns_class(p_class) then raise exception 'Not your class'; end if;
  return query
  select p.id, p.display_name, p.username, p.xp, p.streak, p.last_active,
    (select count(*) from public.learn_progress lp where lp.student_id = p.id and lp.learned),
    (select count(*) from public.game_sessions gs where gs.student_id = p.id and gs.ended_at is not null),
    (select max(gs.score) from public.game_sessions gs where gs.student_id = p.id and gs.game = 'organ_blaster'),
    (select coalesce(sum(m.s), 0) from (select max(gs.stars) s from public.game_sessions gs
       where gs.student_id = p.id and gs.game = 'system_builder' group by gs.system) m),
    (select count(*) from public.assessment_attempts aa where aa.student_id = p.id and aa.submitted_at is not null
       and not aa.is_practice),
    (select round(avg(aa.percent)::numeric, 1) from public.assessment_attempts aa where aa.student_id = p.id
       and aa.submitted_at is not null and not aa.is_practice),
    (select round(avg(om.mastery)::numeric, 0) from public.organ_mastery om where om.student_id = p.id)
  from public.class_members cm join public.profiles p on p.id = cm.student_id
  where cm.class_id = p_class order by p.display_name;
end $$;

-- Which organs the class gets wrong most (games + tests combined)
create or replace function public.class_weak_spots(p_class uuid)
returns table (system text, slug text, label text, answers bigint, wrong bigint, wrong_rate numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.owns_class(p_class) then raise exception 'Not your class'; end if;
  return query
  with s as (select student_id from public.class_members where class_id = p_class),
  e as (
    select ge.system, ge.slug, ge.correct from public.game_events ge join s using (student_id)
    union all
    select aa.system, aa.slug, aa.correct from public.attempt_answers aa join s using (student_id) where aa.slug is not null
  )
  select e.system, e.slug,
    coalesce((select om.label from public.organ_models om where om.system = e.system and om.slug = e.slug limit 1), e.slug),
    count(*), count(*) filter (where not e.correct),
    round(count(*) filter (where not e.correct)::numeric / count(*), 3)
  from e group by e.system, e.slug having count(*) >= 3
  order by 6 desc, 5 desc limit 40;
end $$;

-- Most-missed questions in the class's assigned tests
create or replace function public.class_missed_questions(p_class uuid)
returns table (question_id uuid, prompt text, system text, answers bigint, wrong bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.owns_class(p_class) then raise exception 'Not your class'; end if;
  return query
  select q.id, q.prompt, q.system, count(*), count(*) filter (where not aa.correct)
  from public.attempt_answers aa
  join public.assessment_attempts at on at.id = aa.attempt_id
  join public.assessments a on a.id = at.assessment_id and a.class_id = p_class
  join public.questions q on q.id = aa.question_id
  group by q.id, q.prompt, q.system having count(*) filter (where not aa.correct) > 0
  order by 5 desc, 4 desc limit 15;
end $$;

-- Results table for one assessment (teacher)
create or replace function public.assessment_results(p_assessment uuid)
returns table (student_id uuid, display_name text, attempt_id uuid, score int, total int, percent real,
               submitted_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare cid uuid;
begin
  select class_id into cid from public.assessments where id = p_assessment;
  if cid is null or not public.owns_class(cid) then raise exception 'Not your test'; end if;
  return query
  select p.id, p.display_name, x.id, x.score, x.total, x.percent, x.submitted_at
  from public.class_members cm join public.profiles p on p.id = cm.student_id
  left join lateral (select * from public.assessment_attempts aa where aa.assessment_id = p_assessment
      and aa.student_id = p.id and aa.submitted_at is not null order by aa.percent desc nulls last limit 1) x on true
  where cm.class_id = cid order by p.display_name;
end $$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.classes enable row level security;
alter table public.class_members enable row level security;
alter table public.organ_models enable row level security;
alter table public.organ_content enable row level security;
alter table public.questions enable row level security;
alter table public.question_answers enable row level security;   -- no policies: never readable by clients
alter table public.badges enable row level security;
alter table public.learn_progress enable row level security;
alter table public.quick_checks enable row level security;
alter table public.game_sessions enable row level security;
alter table public.game_events enable row level security;
alter table public.assessments enable row level security;
alter table public.assessment_questions enable row level security;
alter table public.assessment_attempts enable row level security;
alter table public.attempt_answers enable row level security;
alter table public.assignments enable row level security;
alter table public.student_badges enable row level security;

-- profiles: see yourself, teachers see their students; you may only edit your name/settings
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.teaches_student(id));
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated, anon;
grant update (display_name, settings) on public.profiles to authenticated;

-- classes
drop policy if exists classes_select on public.classes;
create policy classes_select on public.classes for select to authenticated
  using (teacher_id = auth.uid() or public.in_class(id));
drop policy if exists classes_insert on public.classes;
create policy classes_insert on public.classes for insert to authenticated
  with check (teacher_id = auth.uid() and public.my_role() in ('teacher', 'admin'));
drop policy if exists classes_update on public.classes;
create policy classes_update on public.classes for update to authenticated
  using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());
drop policy if exists classes_delete on public.classes;
create policy classes_delete on public.classes for delete to authenticated using (teacher_id = auth.uid());

drop policy if exists members_select on public.class_members;
create policy members_select on public.class_members for select to authenticated
  using (student_id = auth.uid() or public.owns_class(class_id));
drop policy if exists members_delete on public.class_members;
create policy members_delete on public.class_members for delete to authenticated using (public.owns_class(class_id));

-- read-only content for everyone signed in
drop policy if exists models_read on public.organ_models;
create policy models_read on public.organ_models for select to authenticated using (true);
drop policy if exists content_read on public.organ_content;
create policy content_read on public.organ_content for select to authenticated using (true);
drop policy if exists badges_read on public.badges;
create policy badges_read on public.badges for select to authenticated using (true);
drop policy if exists questions_read on public.questions;
create policy questions_read on public.questions for select to authenticated
  using (created_by is null or created_by = auth.uid());
drop policy if exists questions_delete on public.questions;
create policy questions_delete on public.questions for delete to authenticated using (created_by = auth.uid());

-- student-owned progress tables: students write their own rows, teachers read their students'
drop policy if exists lp_select on public.learn_progress;
create policy lp_select on public.learn_progress for select to authenticated
  using (student_id = auth.uid() or public.teaches_student(student_id));
drop policy if exists lp_insert on public.learn_progress;
create policy lp_insert on public.learn_progress for insert to authenticated with check (student_id = auth.uid());
drop policy if exists lp_update on public.learn_progress;
create policy lp_update on public.learn_progress for update to authenticated
  using (student_id = auth.uid()) with check (student_id = auth.uid());

drop policy if exists qc_select on public.quick_checks;
create policy qc_select on public.quick_checks for select to authenticated
  using (student_id = auth.uid() or public.teaches_student(student_id));
drop policy if exists qc_insert on public.quick_checks;
create policy qc_insert on public.quick_checks for insert to authenticated with check (student_id = auth.uid());

drop policy if exists gs_select on public.game_sessions;
create policy gs_select on public.game_sessions for select to authenticated
  using (student_id = auth.uid() or public.teaches_student(student_id));
drop policy if exists gs_insert on public.game_sessions;
create policy gs_insert on public.game_sessions for insert to authenticated
  with check (student_id = auth.uid() and ended_at is null);
drop policy if exists gs_update on public.game_sessions;
create policy gs_update on public.game_sessions for update to authenticated
  using (student_id = auth.uid()) with check (student_id = auth.uid());

drop policy if exists ge_select on public.game_events;
create policy ge_select on public.game_events for select to authenticated
  using (student_id = auth.uid() or public.teaches_student(student_id));
drop policy if exists ge_insert on public.game_events;
create policy ge_insert on public.game_events for insert to authenticated
  with check (student_id = auth.uid() and exists (
    select 1 from public.game_sessions s where s.id = session_id and s.student_id = auth.uid()));

drop policy if exists as_select on public.assessments;
create policy as_select on public.assessments for select to authenticated
  using (teacher_id = auth.uid() or public.in_class(class_id));
drop policy if exists as_update on public.assessments;
create policy as_update on public.assessments for update to authenticated
  using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());
drop policy if exists as_delete on public.assessments;
create policy as_delete on public.assessments for delete to authenticated using (teacher_id = auth.uid());

drop policy if exists aq_select on public.assessment_questions;
create policy aq_select on public.assessment_questions for select to authenticated
  using (exists (select 1 from public.assessments a where a.id = assessment_id and a.teacher_id = auth.uid()));

drop policy if exists att_select on public.assessment_attempts;
create policy att_select on public.assessment_attempts for select to authenticated
  using (student_id = auth.uid() or public.teaches_student(student_id));

drop policy if exists aa_select on public.attempt_answers;
create policy aa_select on public.attempt_answers for select to authenticated
  using (student_id = auth.uid() or public.teaches_student(student_id));

drop policy if exists asg_select on public.assignments;
create policy asg_select on public.assignments for select to authenticated
  using (teacher_id = auth.uid() or public.in_class(class_id));
drop policy if exists asg_insert on public.assignments;
create policy asg_insert on public.assignments for insert to authenticated
  with check (teacher_id = auth.uid() and public.owns_class(class_id));
drop policy if exists asg_delete on public.assignments;
create policy asg_delete on public.assignments for delete to authenticated using (teacher_id = auth.uid());

drop policy if exists sb_select on public.student_badges;
create policy sb_select on public.student_badges for select to authenticated
  using (student_id = auth.uid() or public.teaches_student(student_id));

-- internal helpers are not callable from the browser
revoke execute on function public.add_xp(uuid, int) from public, anon, authenticated;
revoke execute on function public.award_badges(uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
