-- =====================================================================
-- SOBO — Organ Blaster difficulty + class leaderboard
-- Run AFTER 001_schema.sql: Supabase Dashboard → SQL Editor → paste → Run.
-- Safe to run more than once.
-- =====================================================================

-- Which difficulty a game was played on (null for games played before this migration).
alter table public.game_sessions add column if not exists difficulty text;
do $$ begin
  alter table public.game_sessions add constraint game_sessions_difficulty_chk
    check (difficulty is null or difficulty in ('easy', 'normal', 'hard'));
exception when duplicate_object then null; end $$;

create index if not exists game_sessions_blaster_board_idx
  on public.game_sessions(game, system, difficulty, score desc) where ended_at is not null;

-- ---------------------------------------------------------------------
-- Leaderboard: each player's BEST finished Organ Blaster game.
--   * students see themselves + classmates (anyone sharing a class)
--   * teachers see the students in the classes they teach
-- Only display names are returned (no ids). The caller's own row is always included,
-- even when outside the top p_limit, so a student can see their rank.
-- p_system / p_difficulty = null means "all".
-- ---------------------------------------------------------------------
drop function if exists public.blaster_leaderboard(text, text, int);
create or replace function public.blaster_leaderboard(p_system text default null, p_difficulty text default null, p_limit int default 10)
returns table (rank bigint, display_name text, score int, duration_ms int, wave_reached int, difficulty text,
               system text, ended_at timestamptz, is_me boolean)
language sql stable security definer set search_path = public as $$
  with peers as (
    select auth.uid() as id
    union
    select cm2.student_id
      from class_members cm1 join class_members cm2 on cm2.class_id = cm1.class_id
     where cm1.student_id = auth.uid()
    union
    select cm.student_id
      from class_members cm join classes c on c.id = cm.class_id
     where c.teacher_id = auth.uid()
  ),
  best as (
    select distinct on (gs.student_id)
           gs.student_id, gs.score, gs.duration_ms, gs.wave_reached, gs.difficulty, gs.system, gs.ended_at
      from game_sessions gs join peers p on p.id = gs.student_id
     where gs.game = 'organ_blaster' and gs.ended_at is not null
       and (p_system is null or gs.system = p_system)
       and (p_difficulty is null or gs.difficulty = p_difficulty)
     order by gs.student_id, gs.score desc, gs.duration_ms desc nulls last, gs.ended_at asc
  ),
  ranked as (
    select rank() over (order by b.score desc, b.duration_ms desc nulls last) as rank,
           b.*, pr.display_name
      from best b join profiles pr on pr.id = b.student_id
     where pr.role = 'student'
  )
  select r.rank, r.display_name, r.score, r.duration_ms, r.wave_reached, r.difficulty, r.system, r.ended_at,
         r.student_id = auth.uid()
    from ranked r
   where r.rank <= greatest(1, least(coalesce(p_limit, 10), 50)) or r.student_id = auth.uid()
   order by r.rank, r.display_name;
$$;

revoke all on function public.blaster_leaderboard(text, text, int) from public, anon;
grant execute on function public.blaster_leaderboard(text, text, int) to authenticated;
