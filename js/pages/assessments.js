// Student tests: assigned tests, practice tests, history.
import { requireRole } from '../auth.js';
import * as api from '../api.js';
import { rootUrl } from '../supabase.js';
import { SYSTEMS, SYSTEM_ORDER } from '../data/pathways.js';
import { $, esc, fmtDate, timeAgo, levelLabel, errorToast, toast } from '../ui.js';

await requireRole(['student']);
const app = document.getElementById('app');
const [level, assignments, attempts] = await Promise.all([api.getMyLevel(), api.getMyAssignments(), api.getAttempts()])
  .catch((e) => { errorToast(e); throw e; });

const tests = assignments.filter((a) => a.type === 'assessment' && a.assessment_id);
const systems = SYSTEM_ORDER.filter((s) => s !== 'reproductive' || level === 'full');
const status = (a) => {
  const done = attempts.filter((t) => t.assessment_id === a.assessment_id && t.submitted_at);
  const open = attempts.find((t) => t.assessment_id === a.assessment_id && !t.submitted_at);
  return { done, open, best: done.reduce((m, t) => Math.max(m, t.percent), -1) };
};

const finishedAttempts = attempts.filter((a) => a.submitted_at);
const waiting = tests.filter((a) => { const s = status(a); return !s.done.length || s.open; }).length;
const bestPct = finishedAttempts.reduce((m, a) => Math.max(m, a.percent), 0);
const avgPct = finishedAttempts.length ? Math.round(finishedAttempts.reduce((t, a) => t + Number(a.percent), 0) / finishedAttempts.length) : 0;
const scoreEmoji = (p) => (p >= 90 ? '🌟' : p >= 60 ? '👍' : '💪');
app.innerHTML = `
<section class="hero page-hero">
  <div>
    <h1>📝 Tests</h1>
    <p class="muted">🎓 ${esc(levelLabel(level))} · Show what you know — every answer helps you learn!</p>
    <div class="row" style="margin-top:12px">
      <a class="btn hero-btn" href="#practice">🚀 Quick practice</a>
      <a class="btn ghost hero-btn-ghost" href="${rootUrl('student/learn.html')}">📖 Revise in Learn mode</a>
    </div>
  </div>
  <div class="hero-stats four">
    <div class="hero-stat"><div class="value">📬 ${waiting}</div><div class="label">to do</div></div>
    <div class="hero-stat"><div class="value">✅ ${finishedAttempts.length}</div><div class="label">tests done</div></div>
    <div class="hero-stat"><div class="value">🏆 ${bestPct}%</div><div class="label">best score</div></div>
    <div class="hero-stat"><div class="value">📊 ${avgPct}%</div><div class="label">average</div></div>
  </div>
</section>

<div class="two-col section-gap">
 <div class="col-stack">
  <section class="card">
    <div class="row between"><h2>👩‍🏫 From your teacher</h2><span class="pill ${waiting ? 'warning' : 'success'}">${waiting} to do</span></div>
    ${tests.length ? `<div class="mini-list">${tests.map((a) => {
      const s = status(a);
      const canRetake = a.assessments?.allow_retake;
      const finished = s.done.length > 0;
      return `<div class="mini-row static">
        <span class="mini-icon">${finished && !s.open ? scoreEmoji(s.best) : '📋'}</span>
        <span class="mini-main"><strong>${esc(a.title)}</strong>
          <span class="small muted">🏫 ${esc(a.classes?.name || '')}${a.due_at ? ` · 📅 due ${fmtDate(a.due_at, true)}` : ''}${a.assessments?.time_limit_sec ? ` · ⏱ ${Math.round(a.assessments.time_limit_sec / 60)} min` : ''}</span>
          ${finished ? `<span class="small">Best: <strong>${s.best}%</strong></span>` : ''}</span>
        <span class="row mini-actions">
          ${finished ? `<a class="btn ghost small" href="${rootUrl(`student/take-test.html?review=${s.done[0].id}`)}">👀 Review</a>` : ''}
          ${!finished || canRetake || s.open ? `<a class="btn small" href="${rootUrl(`student/take-test.html?assessment=${a.assessment_id}`)}">${s.open ? '⏩ Continue' : finished ? '🔁 Retake' : '▶ Start'}</a>` : '<span class="pill success">Done ✓</span>'}
        </span></div>`;
    }).join('')}</div>` : '<p class="muted">🎉 No tests from your teacher right now. Try a practice test!</p>'}
  </section>

  <section class="card">
    <h2>📈 My results</h2>
    ${finishedAttempts.length ? `<div class="mini-list">${finishedAttempts.map((a) => `
      <a class="mini-row" href="${rootUrl(`student/take-test.html?review=${a.id}`)}">
        <span class="mini-icon">${scoreEmoji(a.percent)}</span>
        <span class="mini-main"><strong>${esc(a.assessments?.title || 'Practice test')}</strong>
          <span class="small muted">${a.systems.map((s) => SYSTEMS[s]?.icon || s).join(' ')} · ${a.score}/${a.total} correct · ${timeAgo(a.submitted_at)}</span></span>
        <span class="mini-end"><strong>${a.percent}%</strong><span class="small muted">👀 Review</span></span></a>`).join('')}</div>`
      : '<p class="muted">📭 No results yet — your scores will show up here.</p>'}
  </section>
 </div>

 <div class="col-stack">
  <section class="card" id="practice">
    <h2>🎯 Practice test</h2>
    <p class="muted">💡 Practice as much as you like — these don't count, but they do help you find what to review.</p>
    <form id="practice-form">
      <div class="row between" style="margin-bottom:6px"><label style="margin:0">🫀 Body systems</label>
        <button type="button" class="btn ghost small" id="all-sys">✅ Select all</button></div>
      <div class="chips" id="sys-chips" style="margin-bottom:16px">${systems.map((s) => `<button type="button" class="chip" data-s="${s}">${SYSTEMS[s].icon} ${SYSTEMS[s].name.replace(' system', '')}</button>`).join('')}</div>
      <label>🔢 Number of questions</label>
      <div class="seg" id="count" role="radiogroup" aria-label="Number of questions">${[5, 10, 15, 20].map((n) =>
        `<button type="button" role="radio" aria-checked="${n === 10}" class="${n === 10 ? 'active' : ''}" data-n="${n}">${n}</button>`).join('')}</div>
      <button class="btn block" style="margin-top:18px">🚀 Start practice</button>
    </form>
  </section>

 </div>
</div>
  <section class="card tips-card section-gap">
    <h2>🧠 Test tips</h2>
    <ul class="tips">
      <li><span>👀</span>Read each question twice before you answer.</li>
      <li><span>🔄</span>Spin the 3D model to find hidden organs.</li>
      <li><span>⏭️</span>Stuck? Skip it and come back — your answers are saved.</li>
      <li><span>📖</span>Review your mistakes in Learn mode to earn more next time.</li>
    </ul>
  </section>`;

$('#sys-chips').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (b) b.classList.toggle('active'); });
$('#all-sys').addEventListener('click', () => {
  const chips = [...document.querySelectorAll('#sys-chips .chip')];
  const on = !chips.every((c) => c.classList.contains('active'));
  chips.forEach((c) => c.classList.toggle('active', on));
  $('#all-sys').textContent = on ? '✖ Clear' : '✅ Select all';
});
$('#count').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  $('#count').querySelectorAll('button').forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-checked', String(x === b)); });
});
$('#practice-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const chosen = [...document.querySelectorAll('#sys-chips .chip.active')].map((b) => b.dataset.s);
  if (!chosen.length) { toast('Pick at least one body system'); return; }
  const count = $('#count .active')?.dataset.n || 10;
  location.href = rootUrl(`student/take-test.html?practice=1&systems=${chosen.join(',')}&count=${count}`);
});
