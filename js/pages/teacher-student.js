// Student report for teachers (printable as PDF from the browser).
import { requireRole, supabase } from '../auth.js';
import * as api from '../api.js';
import { rootUrl } from '../supabase.js';
import { SYSTEMS, SYSTEM_ORDER } from '../data/pathways.js';
import { esc, param, fmtDate, timeAgo, masteryClass, levelLabel, errorToast } from '../ui.js';

const teacher = await requireRole(['teacher']);
const app = document.getElementById('app');
const studentId = param('id');
const classId = param('class');

let data;
try {
  const [p, progress, mastery, sessions, attempts, checks, badges, myBadges, cls] = await Promise.all([
    api.getStudentProfile(studentId), api.getLearnProgress(studentId), api.getMastery(studentId), api.getGameSessions(studentId, 100),
    api.getAttempts(studentId), api.getQuickChecks(studentId), api.getBadges(), api.getStudentBadges(studentId),
    classId ? api.getClass(classId) : Promise.resolve(null)]);
  data = { p, progress, mastery, sessions, attempts, checks, badges, myBadges, cls };
} catch (e) {
  app.innerHTML = `<div class="card center"><h2>Report not available</h2><p class="muted">This student isn't in one of your classes.</p></div>`;
  errorToast(e); throw e;
}
const { p, progress, mastery, sessions, attempts, checks, badges, myBadges, cls } = data;
const level = cls?.level_override || (p.grade <= 4 ? 'simple' : p.grade <= 6 ? 'medium' : 'full');
const { data: models } = await supabase.from('organ_models').select('system,slug,label').eq('level', level);
const mMap = Object.fromEntries(mastery.map((m) => [`${m.system}/${m.slug}`, m]));
const learned = new Set(progress.filter((x) => x.learned).map((x) => `${x.system}/${x.slug}`));
const bySystem = {};
for (const m of models || []) (bySystem[m.system] ||= []).push(m);
const done = attempts.filter((a) => a.submitted_at);
const avg = (arr) => (arr.length ? Math.round(arr.reduce((s, x) => s + x, 0) / arr.length) : null);
const weakest = mastery.filter((m) => m.game_total + m.quiz_total >= 2).sort((a, b) => a.mastery - b.mastery).slice(0, 8);
const labelOf = (s, slug) => (bySystem[s] || []).find((m) => m.slug === slug)?.label || slug;
const earned = new Set(myBadges.map((b) => b.badge_code));

app.innerHTML = `
<div class="row between no-print">
  <a href="${rootUrl(classId ? `teacher/class.html?id=${classId}` : 'teacher/dashboard.html')}">← Back to class</a>
  <button class="btn" onclick="window.print()">🖨 Print / save as PDF</button>
</div>
<div class="card" style="margin-top:12px">
  <div class="row between">
    <div><h1 style="margin:0">${esc(p.display_name)}</h1>
      <div class="muted">${esc(p.username || '')} · ${cls ? `${esc(cls.name)} · ` : ''}${esc(levelLabel(level))}</div></div>
    <div class="small muted">Report by ${esc(teacher.display_name)} · ${fmtDate(new Date())}</div>
  </div>
  <div class="grid cols-4" style="margin-top:16px">
    <div class="stat"><div class="value">${learned.size}</div><div class="label">organs learned</div></div>
    <div class="stat"><div class="value">${avg(mastery.map((m) => m.mastery)) ?? '—'}${mastery.length ? '%' : ''}</div><div class="label">avg mastery</div></div>
    <div class="stat"><div class="value">${avg(done.filter((a) => !a.is_practice).map((a) => a.percent)) ?? '—'}${done.some((a) => !a.is_practice) ? '%' : ''}</div><div class="label">test average</div></div>
    <div class="stat"><div class="value">${sessions.length}</div><div class="label">games played</div></div>
    <div class="stat"><div class="value">${p.xp}</div><div class="label">XP</div></div>
    <div class="stat"><div class="value">${p.best_streak}</div><div class="label">best streak</div></div>
    <div class="stat"><div class="value">${myBadges.length}/${badges.length}</div><div class="label">badges</div></div>
    <div class="stat"><div class="value small">${p.last_active ? timeAgo(p.last_active) : 'never'}</div><div class="label">last active</div></div>
  </div>
</div>

<section class="card" style="margin-top:16px">
  <h2>Needs attention</h2>
  ${weakest.length ? `<div class="chips">${weakest.map((m) => `<span class="chip ${masteryClass(m.mastery)}">${SYSTEMS[m.system]?.icon || ''} ${esc(labelOf(m.system, m.slug))} — ${m.mastery}%</span>`).join('')}</div>`
    : '<p class="muted">Not enough game or test answers yet to spot weak areas.</p>'}
</section>

<section class="card" style="margin-top:16px">
  <h2>Mastery by organ</h2>
  <p class="small muted">Combines learning (20%), games (40%) and tests (40%). ✓ = marked as learned.</p>
  ${SYSTEM_ORDER.filter((s) => bySystem[s]).map((s) => `
    <h3 style="margin-top:14px">${SYSTEMS[s].icon} ${SYSTEMS[s].name}</h3>
    <div class="heat">${bySystem[s].map((m) => {
      const x = mMap[`${s}/${m.slug}`];
      return `<div class="cell ${masteryClass(x?.mastery)}">${esc(m.label)} ${learned.has(`${s}/${m.slug}`) ? '✓' : ''}
        <small>${x ? `${x.mastery}% · games ${x.game_correct}/${x.game_total} · tests ${x.quiz_correct}/${x.quiz_total}` : 'not started'}</small></div>`;
    }).join('')}</div>`).join('')}
</section>

<div class="grid cols-2" style="margin-top:16px;align-items:start">
  <section class="card">
    <h2>Tests</h2>
    ${done.length ? `<table class="table"><thead><tr><th>Test</th><th>Score</th><th>Date</th><th class="no-print"></th></tr></thead><tbody>${done.map((a) => `<tr>
      <td>${esc(a.assessments?.title || 'Practice')}${a.is_practice ? ' <span class="pill">practice</span>' : ''}</td><td><strong>${a.percent}%</strong> (${a.score}/${a.total})</td>
      <td class="muted">${fmtDate(a.submitted_at)}</td><td class="no-print"><a class="btn ghost small" href="${rootUrl(`student/take-test.html?review=${a.id}`)}">Answers</a></td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">No tests taken yet.</p>'}
    <h3 style="margin-top:16px">Quick checks (Learn mode)</h3>
    ${checks.length ? `<p>${checks.slice(0, 12).map((c) => `${SYSTEMS[c.system]?.icon || ''} ${c.score}/${c.total}`).join(' · ')}</p>` : '<p class="muted">None yet.</p>'}
  </section>
  <section class="card">
    <h2>Games</h2>
    ${sessions.length ? `<table class="table"><thead><tr><th>Game</th><th>System</th><th>Result</th><th>Date</th></tr></thead><tbody>${sessions.slice(0, 15).map((s) => `<tr>
      <td>${s.game === 'organ_blaster' ? '🎯 Blaster' : '🧩 Builder'}</td><td>${SYSTEMS[s.system]?.icon || ''} ${esc(SYSTEMS[s.system]?.name.replace(' system', '') || s.system)}</td>
      <td>${s.score} pts${s.game === 'organ_blaster' ? ` · ${Math.round((s.accuracy || 0) * 100)}% · wave ${s.wave_reached ?? '—'}` : ` · ${'⭐'.repeat(s.stars || 0)} · ${s.attempts ?? '—'} tries`}</td>
      <td class="muted">${fmtDate(s.started_at)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No games played yet.</p>'}
    <h3 style="margin-top:16px">Badges</h3>
    <div class="badge-grid">${badges.map((b) => `<div class="badge-item ${earned.has(b.code) ? '' : 'locked'}"><div class="b-icon">${b.icon}</div><div class="b-name">${esc(b.name)}</div></div>`).join('')}</div>
  </section>
</div>`;
