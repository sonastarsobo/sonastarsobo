// All database calls in one place. Every function throws on error.
import { supabase } from './supabase.js';

const must = ({ data, error }) => { if (error) throw error; return data; };
const uid = async () => (await supabase.auth.getUser()).data.user?.id;

// ---------------------------------------------------------------- content
const modelCache = new Map();
export async function getOrganModels(system, level) {
  const key = `${system}/${level}`;
  if (!modelCache.has(key)) {
    modelCache.set(key, must(await supabase.from('organ_models').select('*').eq('system', system).eq('level', level).order('id')));
  }
  return modelCache.get(key);
}

const contentCache = new Map();
/** Returns { slug: {about, location, function, fun_fact} } for a system */
export async function getContent(system) {
  if (!contentCache.has(system)) {
    const rows = must(await supabase.from('organ_content').select('*').eq('system', system));
    contentCache.set(system, Object.fromEntries(rows.map((r) => [r.slug, r])));
  }
  return contentCache.get(system);
}

export async function getMyLevel() {
  return must(await supabase.rpc('my_level')) || 'simple';
}

// ---------------------------------------------------------------- learning
export async function getLearnProgress(studentId = null) {
  const id = studentId || await uid();
  return must(await supabase.from('learn_progress').select('*').eq('student_id', id));
}

export async function recordView(system, slug, level) {
  const id = await uid();
  const existing = must(await supabase.from('learn_progress').select('views,learned').eq('student_id', id)
    .eq('system', system).eq('slug', slug).maybeSingle());
  if (existing) {
    return must(await supabase.from('learn_progress').update({ views: existing.views + 1 })
      .eq('student_id', id).eq('system', system).eq('slug', slug));
  }
  return must(await supabase.from('learn_progress').insert({ system, slug, level, learned: false }));
}

export async function markLearned(system, slug, level) {
  return must(await supabase.from('learn_progress')
    .upsert({ student_id: await uid(), system, slug, level, learned: true }, { onConflict: 'student_id,system,slug' }));
}

export async function saveQuickCheck(system, level, score, total) {
  return must(await supabase.from('quick_checks').insert({ system, level, score, total }));
}

// ---------------------------------------------------------------- games
export async function startGameSession(game, system, level) {
  return must(await supabase.from('game_sessions').insert({ game, system, level }).select('id').single()).id;
}

export async function endGameSession(id, fields) {
  const row = { ...fields, ended_at: new Date().toISOString() };
  let res = await supabase.from('game_sessions').update(row).eq('id', id);
  // database not yet upgraded with migration 002 (no "difficulty" column): save everything else
  if (res.error && 'difficulty' in row && /difficulty/i.test(res.error.message || '')) {
    delete row.difficulty;
    res = await supabase.from('game_sessions').update(row).eq('id', id);
  }
  return must(res);
}

/**
 * Organ Blaster class leaderboard (each player's best game). Returns { rows, available }.
 * available=false when the database hasn't been upgraded with migration 002 yet.
 */
export async function getBlasterLeaderboard({ system = null, difficulty = null, limit = 10 } = {}) {
  const { data, error } = await supabase.rpc('blaster_leaderboard', { p_system: system, p_difficulty: difficulty, p_limit: limit });
  if (error) {
    if (error.code === 'PGRST202' || /blaster_leaderboard|could not find the function/i.test(error.message || '')) return { rows: [], available: false };
    throw error;
  }
  return { rows: data || [], available: true };
}

export async function insertGameEvents(rows) {
  if (!rows.length) return;
  return must(await supabase.from('game_events').insert(rows));
}

export async function getGameSessions(studentId = null, limit = 50) {
  const id = studentId || await uid();
  return must(await supabase.from('game_sessions').select('*').eq('student_id', id).not('ended_at', 'is', null)
    .order('started_at', { ascending: false }).limit(limit));
}

// ---------------------------------------------------------------- profile, classes, badges, mastery
export async function getMyProfile() {
  return must(await supabase.from('profiles').select('*').eq('id', await uid()).single());
}
export async function updateDisplayName(name) {
  return must(await supabase.from('profiles').update({ display_name: name }).eq('id', await uid()));
}
export async function getMyClasses() { return must(await supabase.rpc('my_classes')); }
export async function joinClass(code) { return must(await supabase.rpc('join_class', { p_code: code })); }

export async function getBadges() { return must(await supabase.from('badges').select('*').order('code')); }
export async function getStudentBadges(studentId = null) {
  const id = studentId || await uid();
  return must(await supabase.from('student_badges').select('*').eq('student_id', id));
}

export async function getMastery(studentId = null) {
  const id = studentId || await uid();
  return must(await supabase.from('organ_mastery').select('*').eq('student_id', id));
}

export async function getMyAssignments() {
  return must(await supabase.from('assignments').select('*, classes(name), assessments(title, time_limit_sec, allow_retake)')
    .order('due_at', { ascending: true, nullsFirst: false }));
}

// ---------------------------------------------------------------- tests
export async function startAttempt({ assessmentId = null, systems = null, count = 10 }) {
  return must(await supabase.rpc('start_attempt', { p_assessment: assessmentId, p_systems: systems, p_count: count }));
}
export async function submitAttempt(attemptId, answers) {
  return must(await supabase.rpc('submit_attempt', { p_attempt: attemptId, p_answers: answers }));
}
export async function attemptReview(attemptId) {
  return must(await supabase.rpc('attempt_review', { p_attempt: attemptId }));
}
export async function getAttempts(studentId = null) {
  const id = studentId || await uid();
  return must(await supabase.from('assessment_attempts').select('*, assessments(title)').eq('student_id', id)
    .order('started_at', { ascending: false }));
}

// ---------------------------------------------------------------- teacher
export async function getTeacherClasses() {
  return must(await supabase.from('classes').select('*, class_members(count)').eq('teacher_id', await uid()).order('created_at'));
}
export async function createClass(name, grade, levelOverride = null) {
  return must(await supabase.from('classes').insert({ name, grade, level_override: levelOverride }).select().single());
}
export async function updateClass(id, fields) {
  return must(await supabase.from('classes').update(fields).eq('id', id));
}
export async function deleteClass(id) { return must(await supabase.from('classes').delete().eq('id', id)); }
export async function getClass(id) { return must(await supabase.from('classes').select('*').eq('id', id).single()); }
export async function regenerateCode(id) { return must(await supabase.rpc('regenerate_join_code', { p_class: id })); }
export async function removeStudent(classId, studentId) {
  return must(await supabase.rpc('remove_student', { p_class: classId, p_student: studentId }));
}
export async function classOverview(id) { return must(await supabase.rpc('class_overview', { p_class: id })); }
export async function classWeakSpots(id) { return must(await supabase.rpc('class_weak_spots', { p_class: id })); }
export async function classMissedQuestions(id) { return must(await supabase.rpc('class_missed_questions', { p_class: id })); }

export async function getClassAssignments(classId) {
  return must(await supabase.from('assignments').select('*').eq('class_id', classId).order('created_at', { ascending: false }));
}
export async function createAssignment(row) { return must(await supabase.from('assignments').insert(row)); }
export async function deleteAssignment(id) { return must(await supabase.from('assignments').delete().eq('id', id)); }

export async function getClassAssessments(classId) {
  return must(await supabase.from('assessments').select('*').eq('class_id', classId).order('created_at', { ascending: false }));
}
export async function createAssessment(p) {
  return must(await supabase.rpc('create_assessment', {
    p_class: p.classId, p_title: p.title, p_systems: p.systems, p_level: p.level, p_count: p.count,
    p_time_limit_sec: p.timeLimitSec, p_due_at: p.dueAt, p_allow_retake: p.allowRetake, p_question_ids: p.questionIds || null,
  }));
}
export async function deleteAssessment(id) { return must(await supabase.from('assessments').delete().eq('id', id)); }
export async function assessmentResults(id) { return must(await supabase.rpc('assessment_results', { p_assessment: id })); }

export async function getQuestions(systems, level) {
  return must(await supabase.from('questions').select('id,system,level,type,prompt,slug,created_by')
    .in('system', systems).eq('level', level).in('type', ['click_organ', 'label_match']).order('type'));
}
export async function addQuestion(q) {
  return must(await supabase.rpc('add_question', {
    p_system: q.system, p_level: q.level, p_type: q.type, p_prompt: q.prompt, p_options: q.options,
    p_answer: q.answer, p_explanation: q.explanation, p_slug: q.slug || null,
  }));
}

export async function getStudentProfile(id) {
  return must(await supabase.from('profiles').select('*').eq('id', id).single());
}
export async function getQuickChecks(studentId) {
  return must(await supabase.from('quick_checks').select('*').eq('student_id', studentId).order('created_at', { ascending: false }));
}

/** Edge Function for teacher student-management (bulk accounts, password reset). */
export async function manageStudents(body) {
  const { data, error } = await supabase.functions.invoke('manage-students', { body });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch { /* ignore */ }
    if (error.name === 'FunctionsFetchError' || error.context?.status === 404) {
      msg = 'The manage-students Edge Function is not deployed yet (see README, step 5).';
    }
    throw new Error(msg);
  }
  if (!data?.ok) throw new Error(data?.error || 'Request failed');
  return data;
}
