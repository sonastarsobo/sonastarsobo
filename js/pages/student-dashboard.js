// Student home: progress, assignments, review list, recent activity, badges.
import { requireRole, supabase } from '../auth.js';
import * as api from '../api.js';
import { rootUrl } from '../supabase.js';
import { SYSTEMS, SYSTEM_ORDER } from '../data/pathways.js';
import { esc, ring, levelLabel, fmtDate, timeAgo, toast, errorToast } from '../ui.js';

const profile = await requireRole(['student']);
const app = document.getElementById('app');

const [level, classes, progress, mastery, sessions, attempts, assignments, badges, myBadges] = await Promise.all([
  api.getMyLevel(), api.getMyClasses(), api.getLearnProgress(), api.getMastery(), api.getGameSessions(), api.getAttempts(),
  api.getMyAssignments(), api.getBadges(), api.getStudentBadges(),
]).catch((e) => { errorToast(e); throw e; });

const { data: models } = await supabase.from('organ_models').select('system,slug,label').eq('level', level);
const bySystem = {};
for (const m of models || []) (bySystem[m.system] ||= []).push(m);
const learned = new Set(progress.filter((p) => p.learned).map((p) => `${p.system}/${p.slug}`));
const masteryMap = Object.fromEntries(mastery.map((m) => [`${m.system}/${m.slug}`, m]));
const labelOf = (system, slug) => (bySystem[system] || []).find((m) => m.slug === slug)?.label || slug;

let last = null;
try { last = JSON.parse(localStorage.getItem('bq-last-learn') || 'null'); } catch { /* ignore */ }

function assignmentDone(a) {
  if (a.type === 'learn') {
    const list = bySystem[a.system] || [];
    return list.length > 0 && list.every((m) => learned.has(`${a.system}/${m.slug}`));
  }
  if (a.type === 'game') {
    return sessions.some((s) => s.game === a.game && (!a.system || s.system === a.system) && s.score >= (a.target_score || 0));
  }
  if (a.type === 'assessment') return attempts.some((t) => t.assessment_id === a.assessment_id && t.submitted_at);
  return false;
}
function assignmentLink(a) {
  if (a.type === 'learn') return rootUrl(`student/learn.html?system=${a.system}`);
  if (a.type === 'game') return rootUrl(`student/${a.game === 'organ_blaster' ? 'organ-blaster' : 'system-builder'}.html${a.system ? `?system=${a.system}` : ''}`);
  return rootUrl(`student/take-test.html?assessment=${a.assessment_id}`);
}

const systems = SYSTEM_ORDER.filter((s) => bySystem[s]?.length);
const review = mastery.filter((m) => m.game_total + m.quiz_total > 0 && m.mastery < 60 && bySystem[m.system])
  .sort((a, b) => a.mastery - b.mastery).slice(0, 6);
const earned = new Set(myBadges.map((b) => b.badge_code));
const nextBadge = badges.find((b) => !earned.has(b.code));
const pending = assignments.filter((a) => !assignmentDone(a));
const totalLearned = progress.filter((p) => p.learned).length;

app.innerHTML = `
<section class="hero">
  <div class="row between">
    <div>
      <h1>Hi ${esc(profile.display_name)}! 👋</h1>
      <p class="muted">${esc(levelLabel(level))}${classes[0] ? ` · ${esc(classes[0].name)} with ${esc(classes[0].teacher_name)}` : ''}</p>
      <div class="row" style="margin-top:12px">
        <a class="btn" style="background:#fff;color:var(--primary)" href="${last ? rootUrl(`student/learn.html?system=${last.system}&slug=${last.slug}`) : rootUrl('student/learn.html')}">
          ${last ? `▶ Continue: ${esc(labelOf(last.system, last.slug))}` : '▶ Start learning'}</a>
        <a class="btn ghost" style="color:#fff;border-color:rgba(255,255,255,.5)" href="${rootUrl('student/games.html')}">🎮 Play a game</a>
      </div>
    </div>
    <div class="row" style="gap:12px">
      <div class="card flat stat" style="background:rgba(255,255,255,.15);border:0;color:#fff;min-width:110px"><div class="value">🔥 ${profile.streak}</div><div class="label" style="color:#fff">day streak</div></div>
      <div class="card flat stat" style="background:rgba(255,255,255,.15);border:0;color:#fff;min-width:110px"><div class="value">⭐ ${profile.xp}</div><div class="label" style="color:#fff">XP</div></div>
      <div class="card flat stat" style="background:rgba(255,255,255,.15);border:0;color:#fff;min-width:110px"><div class="value">🔬 ${totalLearned}</div><div class="label" style="color:#fff">organs learned</div></div>
    </div>
  </div>
</section>

<div class="grid cols-2" style="margin-top:20px;align-items:start">
  <section class="card">
    <div class="row between"><h2>📌 To do</h2><span class="pill ${pending.length ? 'warning' : 'success'}">${pending.length} left</span></div>
    ${assignments.length ? `<div class="stack">${assignments.map((a) => {
      const done = assignmentDone(a);
      const due = a.due_at ? new Date(a.due_at) : null;
      const late = due && due < new Date() && !done;
      return `<a class="row between tile card flat" style="padding:12px 14px" href="${assignmentLink(a)}">
        <div><strong>${esc(a.title)}</strong><div class="small muted">${esc(a.classes?.name || '')}${due ? ` · due ${fmtDate(due, true)}` : ''}
          ${a.type === 'game' && a.target_score ? ` · reach ${a.target_score} points` : ''}</div></div>
        <span class="pill ${done ? 'success' : late ? 'danger' : 'primary'}">${done ? 'Done ✓' : late ? 'Late' : { learn: 'Learn', game: 'Game', assessment: 'Test' }[a.type]}</span></a>`;
    }).join('')}</div>` : '<p class="muted">No assignments right now. Explore anything you like!</p>'}
  </section>

  <section class="card">
    <h2>🔁 Review these</h2>
    ${review.length ? `<p class="muted small">You've missed these a few times in games or tests. A quick look will help!</p>
      <div class="stack">${review.map((m) => `<a class="row between tile card flat" style="padding:10px 14px" href="${rootUrl(`student/learn.html?system=${m.system}&slug=${m.slug}`)}">
        <span>${SYSTEMS[m.system]?.icon || ''} <strong>${esc(labelOf(m.system, m.slug))}</strong></span><span class="pill warning">${m.mastery}% mastery</span></a>`).join('')}</div>`
      : '<p class="muted">Nothing to review yet — play a game or take a practice test and we\'ll spot what needs another look.</p>'}
  </section>
</div>

<section class="card" style="margin-top:20px">
  <h2>🧭 My body systems</h2>
  <div class="grid cols-4">${systems.map((s) => {
    const list = bySystem[s];
    const nLearned = list.filter((m) => learned.has(`${s}/${m.slug}`)).length;
    const nMastered = list.filter((m) => (masteryMap[`${s}/${m.slug}`]?.mastery ?? 0) >= 75).length;
    return `<a class="card flat tile center" href="${rootUrl(`student/learn.html?system=${s}`)}">
      <div class="row" style="justify-content:center">${ring(100 * nLearned / list.length, SYSTEMS[s].color, 86, `${SYSTEMS[s].icon}`)}</div>
      <h3 style="margin:8px 0 2px">${SYSTEMS[s].name}</h3>
      <div class="small muted">${nLearned}/${list.length} learned · ${nMastered} mastered</div></a>`;
  }).join('')}</div>
</section>

<div class="grid cols-2" style="margin-top:20px;align-items:start">
  <section class="card">
    <h2>🎮 Recent games</h2>
    ${sessions.length ? `<table class="table"><tbody>${sessions.slice(0, 6).map((s) => `<tr>
      <td>${s.game === 'organ_blaster' ? '🎯 Organ Blaster' : '🧩 System Builder'}</td><td>${SYSTEMS[s.system]?.icon || ''} ${esc(SYSTEMS[s.system]?.name || s.system)}</td>
      <td><strong>${s.score}</strong> pts${s.stars != null ? ` · ${'⭐'.repeat(s.stars)}` : ''}</td><td class="muted small">${timeAgo(s.started_at)}</td></tr>`).join('')}</tbody></table>`
      : `<p class="muted">No games yet. <a href="${rootUrl('student/games.html')}">Play one now!</a></p>`}
  </section>
  <section class="card">
    <h2>📝 Recent tests</h2>
    ${attempts.filter((a) => a.submitted_at).length ? `<table class="table"><tbody>${attempts.filter((a) => a.submitted_at).slice(0, 6).map((a) => `<tr>
      <td>${esc(a.assessments?.title || 'Practice test')}</td><td><strong>${a.percent}%</strong> (${a.score}/${a.total})</td>
      <td class="muted small">${timeAgo(a.submitted_at)}</td><td><a class="btn ghost small" href="${rootUrl(`student/take-test.html?review=${a.id}`)}">Review</a></td></tr>`).join('')}</tbody></table>`
      : `<p class="muted">No tests yet. <a href="${rootUrl('student/assessments.html')}">Try a practice test</a>.</p>`}
  </section>
</div>

<section class="card" style="margin-top:20px">
  <div class="row between"><h2>🏅 Badges</h2>${nextBadge ? `<span class="small muted">Next: <strong>${esc(nextBadge.name)}</strong> — ${esc(nextBadge.description)}</span>` : ''}</div>
  <div class="badge-grid">${badges.map((b) => `<div class="badge-item ${earned.has(b.code) ? '' : 'locked'}" title="${esc(b.description)}">
    <div class="b-icon">${b.icon}</div><div class="b-name">${esc(b.name)}</div></div>`).join('')}</div>
</section>

<section class="card" style="margin-top:20px">
  <h2>🏫 My classes</h2>
  ${classes.length ? `<div class="chips">${classes.map((c) => `<span class="chip">${esc(c.name)} · ${esc(c.teacher_name)}</span>`).join('')}</div>` : '<p class="muted">You are not in a class yet.</p>'}
  <form id="join-form" class="row" style="margin-top:14px">
    <input id="join-code" type="text" maxlength="6" placeholder="Class code" style="max-width:180px;text-transform:uppercase" required>
    <button class="btn secondary">Join another class</button>
  </form>
</section>`;

document.getElementById('join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const c = await api.joinClass(document.getElementById('join-code').value);
    toast(`You joined ${c.name}!`, 'success');
    setTimeout(() => location.reload(), 900);
  } catch (err) { errorToast(err); }
});
