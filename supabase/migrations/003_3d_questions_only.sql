-- SOBO · 003 — tests use only the 3D question formats
-- Run once in the Supabase SQL editor (after 001 and 002).
--
-- * Practice tests and new teacher tests only pick 3D questions:
--     click_organ  (click the right part on the 3D model)
--     label_match  (match numbered markers on the 3D model to names)
--   Multiple choice, true/false and "put in order" stay in the database so old results can still be reviewed,
--   but they are never handed out again.
-- * Adds a "Click on the <organ>." question for every organ model, so every body system and level has plenty
--   of 3D questions. Safe to run more than once.

create or replace function public.is_3d_type(t text)
returns boolean language sql immutable as $$ select t in ('click_organ', 'label_match') $$;

-- 1) more click-the-organ questions, one per organ model ------------------------------------------
insert into public.questions (system, level, type, prompt, options, explanation, slug, created_by)
select m.system, m.level, 'click_organ', 'Click on the ' || lower(m.label) || '.', '{}'::jsonb,
       'This is the ' || lower(m.label) || '.', m.slug, null
from public.organ_models m
where not exists (
  select 1 from public.questions q
  where q.system = m.system and q.level = m.level and q.type = 'click_organ'
    and q.created_by is null and q.prompt = 'Click on the ' || lower(m.label) || '.');

insert into public.question_answers (question_id, answer)
select q.id, jsonb_build_object('value', q.slug)
from public.questions q
where q.type = 'click_organ' and q.created_by is null and q.slug is not null
  and not exists (select 1 from public.question_answers a where a.question_id = q.id);

-- 2) practice + teacher tests: 3D questions only ------------------------------------------------------
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
    select * into att from public.assessment_attempts
      where assessment_id = a.id and student_id = auth.uid() and submitted_at is null
      order by started_at desc limit 1;
    if not found then
      if not a.allow_retake and exists (select 1 from public.assessment_attempts
          where assessment_id = a.id and student_id = auth.uid() and submitted_at is not null) then
        raise exception 'You have already finished this test';
      end if;
      -- older tests may still contain multiple-choice questions: hand out only their 3D ones
      select array_agg(aq.question_id order by aq.position) into qids
        from public.assessment_questions aq join public.questions q on q.id = aq.question_id
        where aq.assessment_id = a.id and public.is_3d_type(q.type);
      if qids is null then raise exception 'This test has no 3D questions'; end if;
      insert into public.assessment_attempts (assessment_id, student_id, is_practice, systems, level, question_ids, time_limit_sec)
      values (a.id, auth.uid(), false, a.systems, a.level, qids, a.time_limit_sec) returning * into att;
    end if;
  else
    if p_systems is null or array_length(p_systems, 1) is null then raise exception 'Choose at least one body system'; end if;
    lvl := public.student_level(auth.uid());
    select array_agg(id) into qids from (
      select id from public.questions
      where system = any(p_systems) and level = lvl and created_by is null and public.is_3d_type(type)
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

create or replace function public.create_assessment(p_class uuid, p_title text, p_systems text[], p_level text,
    p_count int, p_time_limit_sec int, p_due_at timestamptz, p_allow_retake boolean,
    p_question_ids uuid[] default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare aid uuid; qids uuid[];
begin
  if not public.owns_class(p_class) then raise exception 'Not your class'; end if;
  if p_question_ids is not null and array_length(p_question_ids, 1) > 0 then
    select array_agg(id) into qids from public.questions
      where id = any(p_question_ids) and (created_by is null or created_by = auth.uid()) and public.is_3d_type(type);
  else
    select array_agg(id) into qids from (
      select id from public.questions
      where system = any(p_systems) and level = p_level and (created_by is null or created_by = auth.uid())
        and public.is_3d_type(type)
      order by random() limit greatest(1, least(coalesce(p_count, 10), 40))) s;
  end if;
  if qids is null then raise exception 'No 3D questions match those choices'; end if;
  insert into public.assessments (teacher_id, class_id, title, systems, level, time_limit_sec, due_at, allow_retake)
  values (auth.uid(), p_class, p_title, p_systems, p_level, p_time_limit_sec, p_due_at, coalesce(p_allow_retake, false))
  returning id into aid;
  insert into public.assessment_questions (assessment_id, question_id, position)
  select aid, q, o from unnest(qids) with ordinality t(q, o);
  insert into public.assignments (class_id, teacher_id, type, title, assessment_id, due_at)
  values (p_class, auth.uid(), 'assessment', p_title, aid, p_due_at);
  return aid;
end $$;

-- 3) teachers can only write 3D questions -----------------------------------------------------------
create or replace function public.add_question(p_system text, p_level text, p_type text, p_prompt text,
                                               p_options jsonb, p_answer jsonb, p_explanation text, p_slug text)
returns uuid language plpgsql security definer set search_path = public as $$
declare qid uuid;
begin
  if public.my_role() not in ('teacher', 'admin') then raise exception 'Only teachers can add questions'; end if;
  if not public.is_3d_type(p_type) then raise exception 'Questions must use the 3D model (click the organ or label the model)'; end if;
  if p_type = 'label_match' and (jsonb_array_length(coalesce(p_options->'markers', '[]'::jsonb)) < 2
      or jsonb_array_length(coalesce(p_answer, '[]'::jsonb)) <> jsonb_array_length(p_options->'markers')) then
    raise exception 'A labelling question needs at least 2 markers, each with a name';
  end if;
  insert into public.questions (system, level, type, prompt, options, explanation, slug, created_by)
  values (p_system, p_level, p_type, p_prompt, coalesce(p_options, '{}'::jsonb), coalesce(p_explanation, ''),
          p_slug, auth.uid()) returning id into qid;
  insert into public.question_answers values (qid, jsonb_build_object('value', p_answer));
  return qid;
end $$;

