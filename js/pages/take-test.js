// Take a test (assigned or practice) or review a finished one.
import { requireRole } from '../auth.js';
import * as api from '../api.js';
import { rootUrl } from '../supabase.js';
import { AnatomyViewer, loadingOverlay, THREE } from '../three/viewer.js';
import { SYSTEMS } from '../data/pathways.js';
import { $, esc, param, errorToast, confirmDialog, updateXp, celebrate, friendlyError } from '../ui.js';

const profile = await requireRole(['student', 'teacher']);
const app = document.getElementById('app');
const reviewId = param('review');

let renderSeq = 0;
let attempt = null, idx = 0, answers = {}, timerId = null, viewer = null, submitting = false;
const labelCache = {};   // "system/level" -> { slug: label }

async function labelsFor(system, level) {
  const key = `${system}/${level}`;
  if (!labelCache[key]) labelCache[key] = Object.fromEntries((await api.getOrganModels(system, level)).map((m) => [m.slug, m.label]));
  return labelCache[key];
}

function saveLocal() {
  try { sessionStorage.setItem(`bq-answers-${attempt.attempt_id}`, JSON.stringify(answers)); } catch { /* ignore */ }
}

const Q_TYPE = {
  mcq: '🔤 Choose one', true_false: '⚖️ True or false', click_organ: '👆 Click on the body',
  label_match: '🏷️ Label the parts', order: '🔢 Put in order',
};

function renderShell() {
  app.innerHTML = `
  <div class="question-card test-shell">
    <div class="test-head">
      <div class="test-title"><h1>📝 ${esc(attempt.title)}</h1><div class="muted small" id="q-count"></div></div>
      ${attempt.time_limit_sec ? '<div class="pill warning test-timer">⏱ <span class="timer" id="timer"></span></div>' : ''}
    </div>
    <div class="bar"><span id="q-bar"></span></div>
    <div class="q-dots" id="q-dots"></div>
    <div class="card q-card" id="q-body"></div>
    <div class="test-nav">
      <button class="btn ghost" id="prev-btn">⬅️ Back</button>
      <span class="muted small" id="q-answered"></span>
      <button class="btn" id="next-btn">Next ➡️</button>
    </div>
  </div>`;
  $('#prev-btn').onclick = () => { if (idx > 0) { idx--; renderQuestion(); } };
  $('#next-btn').onclick = () => { if (idx < attempt.questions.length - 1) { idx++; renderQuestion(); } else submit(); };
  if (attempt.time_limit_sec) {
    const end = new Date(attempt.started_at).getTime() + attempt.time_limit_sec * 1000;
    const tick = () => {
      const left = Math.max(0, Math.round((end - Date.now()) / 1000));
      const t = $('#timer');
      if (t) { t.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`; t.classList.toggle('low', left < 60); }
      if (left <= 0) { clearInterval(timerId); submit(true); }
    };
    tick(); timerId = setInterval(tick, 1000);
  }
}

function isAnswered(q) {
  const a = answers[q.id];
  if (a == null) return false;
  if (q.type === 'label_match') return Array.isArray(a) && a.every(Boolean);
  return true;
}

function renderDots() {
  $('#q-dots').innerHTML = attempt.questions.map((q, i) =>
    `<button class="chip small ${i === idx ? 'active' : ''} ${isAnswered(q) ? 'done' : ''}" data-i="${i}" aria-label="Question ${i + 1}">${i + 1}</button>`).join('');
  $('#q-dots').querySelectorAll('[data-i]').forEach((b) => b.onclick = () => { idx = Number(b.dataset.i); renderQuestion(); });
  const answered = attempt.questions.filter(isAnswered).length;
  $('#q-answered').textContent = `${answered} of ${attempt.questions.length} answered`;
}

// ------------------------------------------------------------------ question renderers
async function renderQuestion() {
  const seq = ++renderSeq;
  const stale = () => seq !== renderSeq;
  const q = attempt.questions[idx];
  const n = attempt.questions.length;
  $('#q-count').textContent = `Question ${idx + 1} of ${n} · ${SYSTEMS[q.system]?.icon || ''} ${SYSTEMS[q.system]?.name || q.system}`;
  $('#q-bar').style.width = `${(100 * (idx + 1)) / n}%`;
  $('#prev-btn').disabled = idx === 0;
  $('#next-btn').textContent = idx === n - 1 ? '🏁 Finish' : 'Next ➡️';
  renderDots();
  if (viewer) { viewer.dispose(); viewer = null; }
  const body = $('#q-body');
  body.innerHTML = `<div class="q-prompt"><span class="q-num">${idx + 1}</span><div><span class="q-type">${Q_TYPE[q.type] || '❓ Question'}</span><h2>${esc(q.prompt)}</h2></div></div><div id="q-ui" class="q-ui"></div>`;
  const ui = $('#q-ui');
  const set = (v) => { answers[q.id] = v; saveLocal(); renderDots(); };

  if (q.type === 'mcq' || q.type === 'true_false') {
    ui.innerHTML = `<div class="choices ${q.type === 'true_false' ? 'tf' : ''}">${q.options.choices.map((c) =>
      `<button class="choice ${answers[q.id] === c ? 'selected' : ''}" data-c="${esc(c)}">${esc(c)}</button>`).join('')}</div>`;
    ui.querySelectorAll('.choice').forEach((b) => b.onclick = () => {
      set(b.dataset.c);
      ui.querySelectorAll('.choice').forEach((x) => x.classList.toggle('selected', x === b));
    });
  } else if (q.type === 'click_organ') {
    ui.innerHTML = `<p class="muted small">Spin the model and click the right part. You can change your answer.</p>
      <div class="viewer mini-viewer" id="mv"></div><p style="margin-top:10px">Your answer: <strong id="picked">—</strong></p>`;
    const labels = await labelsFor(q.system, q.level);
    if (stale()) return;
    const v = viewer = new AnatomyViewer($('#mv'));
    const ld = loadingOverlay($('#mv'));
    try { await v.loadSystem(q.system, q.level); ld.done(); } catch (e) { if (!stale()) ld.error(e.message); return; }
    if (stale()) return;
    viewer.frame(null, { duration: 0 });
    viewer.setXray(0.35);
    const show = (slug) => { $('#picked').textContent = slug ? labels[slug] || slug : '—'; if (slug) viewer.select(slug); };
    show(answers[q.id]);
    viewer.onTap((mesh) => { if (mesh) { set(mesh.userData.slug); show(mesh.userData.slug); } });
  } else if (q.type === 'label_match') {
    const markers = q.options.markers, labels = q.options.labels;
    const current = Array.isArray(answers[q.id]) ? answers[q.id] : markers.map(() => '');
    ui.innerHTML = `<div class="viewer mini-viewer" id="mv"></div>
      <div class="grid cols-3" style="margin-top:12px">${markers.map((_, i) => `<div class="field"><label>Marker ${i + 1}</label>
        <select data-i="${i}"><option value="">Choose…</option>${labels.map((l) => `<option ${current[i] === l ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`).join('')}</div>`;
    ui.querySelectorAll('select').forEach((s) => s.onchange = () => { current[Number(s.dataset.i)] = s.value; set([...current]); });
    const v = viewer = new AnatomyViewer($('#mv'));
    const ld = loadingOverlay($('#mv'));
    try { await v.loadSystem(q.system, q.level); ld.done(); } catch (e) { if (!stale()) ld.error(e.message); return; }
    if (stale()) return;
    const box = new THREE.Box3();
    markers.forEach((p, i) => {
      const pt = new THREE.Vector3(...p);
      box.expandByPoint(pt);
      viewer.addLabel(`m${i}`, String(i + 1), pt, 'marker');
    });
    box.expandByScalar(Math.max(0.05, box.getSize(new THREE.Vector3()).length() * 0.25));
    viewer.frameBox(box, { duration: 0, padding: 1.3 });
    viewer.setXray(0.6);
  } else if (q.type === 'order') {
    if (!Array.isArray(answers[q.id])) answers[q.id] = q.options.steps.slice();
    const draw = () => {
      const list = answers[q.id];
      ui.innerHTML = `<p class="muted small">Use the arrows to put them in order — first at the top.</p><ol class="order-list">${list.map((s, i) => `
        <li><span class="num">${i + 1}</span>${esc(s)}<span class="spacer"></span>
        <button class="btn ghost small" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">▲</button>
        <button class="btn ghost small" data-down="${i}" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Move down">▼</button></li>`).join('')}</ol>`;
      ui.querySelectorAll('[data-up]').forEach((b) => b.onclick = () => { const i = +b.dataset.up; [list[i - 1], list[i]] = [list[i], list[i - 1]]; set(list); draw(); });
      ui.querySelectorAll('[data-down]').forEach((b) => b.onclick = () => { const i = +b.dataset.down; [list[i + 1], list[i]] = [list[i], list[i + 1]]; set(list); draw(); });
    };
    draw();
    saveLocal(); renderDots();
  }
}

// ------------------------------------------------------------------ submit + results
async function submit(timeUp = false) {
  if (submitting) return;
  const missing = attempt.questions.filter((q) => !isAnswered(q)).length;
  if (!timeUp && missing && !(await confirmDialog('Finish the test?', `You have ${missing} unanswered question${missing > 1 ? 's' : ''}. Submit anyway?`, 'Submit'))) return;
  submitting = true;
  clearInterval(timerId);
  if (viewer) { viewer.dispose(); viewer = null; }
  app.innerHTML = '<div class="card center"><div class="loading" style="position:static;background:none;color:var(--text)"><div><div class="spinner" style="border-color:var(--surface-2);border-top-color:var(--primary)"></div>Marking your answers…</div></div></div>';
  try {
    const res = await api.submitAttempt(attempt.attempt_id, answers);
    sessionStorage.removeItem(`bq-answers-${attempt.attempt_id}`);
    if (res.percent >= 90) celebrate(res.percent === 100 ? '💯 Perfect score!' : '⭐ Brilliant!');
    try { updateXp((await api.getMyProfile()).xp); } catch { /* ignore */ }
    await showResults(res, false, timeUp);
  } catch (e) {
    errorToast(e);
    submitting = false;
    renderShell(); renderQuestion();
  }
}

async function showResults(res, isReview, timeUp = false) {
  const fmt = async (q, v) => {
    if (v == null) return '<em class="muted">no answer</em>';
    if (q.type === 'click_organ') {
      const sys = (await labelsFor(...await systemLevelOf(q)));
      return esc(sys[v] || v);
    }
    if (Array.isArray(v)) return v.map((x, i) => `${q.type === 'label_match' ? `${i + 1}: ` : ''}${esc(x || '—')}`).join(q.type === 'order' ? ' → ' : ', ');
    return esc(v);
  };
  const items = [];
  for (const r of res.results) {
    items.push(`<div class="result-item ${r.correct ? 'ok' : 'no'}">
      <div class="row between"><strong>${esc(r.prompt)}</strong><span class="pill ${r.correct ? 'success' : 'danger'}">${r.correct ? '✅ Correct' : '❌ Not quite'}</span></div>
      <div class="small" style="margin-top:6px">✏️ Your answer: ${await fmt(r, r.response)}</div>
      ${r.correct ? '' : `<div class="small">🎯 Correct answer: <strong>${await fmt(r, r.answer)}</strong></div>`}
      ${r.explanation ? `<div class="small muted" style="margin-top:4px">💡 ${esc(r.explanation)}</div>` : ''}</div>`);
  }
  const pct = Number(res.percent);
  app.innerHTML = `
  <div class="question-card">
    <div class="card center" style="margin-bottom:16px">
      ${timeUp ? '<p class="pill warning">⏱ Time was up — your answers were submitted automatically.</p>' : ''}
      <div style="font-size:3em;line-height:1">${pct >= 90 ? '🏆' : pct >= 60 ? '🎉' : '🌱'}</div>
      <div style="font-size:3em;font-weight:900">${pct}%</div>
      <p class="muted">${res.score} out of ${res.total} correct ${pct >= 90 ? '— amazing! 🌟' : pct >= 60 ? '— good work! 👍' : '— keep practising, you\'ll get there! 💪'}</p>
      ${isReview ? '' : `<p class="small muted">⭐ +${res.score * 5} XP earned</p>`}
      <div class="row" style="justify-content:center">
        <a class="btn ghost" href="${rootUrl(profile.role === 'student' ? 'student/assessments.html' : 'teacher/dashboard.html')}">⬅️ Back</a>
        ${profile.role === 'student' ? `<a class="btn" href="${rootUrl('student/learn.html')}">📖 Review in Learn mode</a>` : ''}
      </div>
    </div>
    <h2>🧾 Answers</h2>
    ${items.join('')}
  </div>`;
}

// click_organ answers are organ slugs: find which system/level the question used
const qMeta = {};
async function systemLevelOf(q) {
  if (q.system && q.level) return [q.system, q.level];
  if (!qMeta[q.id]) {
    const { supabase } = await import('../supabase.js');
    const { data } = await supabase.from('questions').select('system,level').eq('id', q.id).single();
    qMeta[q.id] = [data.system, data.level];
  }
  return qMeta[q.id];
}

// ------------------------------------------------------------------ start (last, so every const above is ready)
try {
  if (reviewId) {
    const res = await api.attemptReview(reviewId);
    await showResults(res, true);
  } else {
    if (profile.role !== 'student') throw new Error('Only students can take tests. Teachers can preview questions in "New test".');
    const systems = (param('systems') || '').split(',').filter((s) => SYSTEMS[s]);
    attempt = await api.startAttempt(param('assessment')
      ? { assessmentId: param('assessment') }
      : { systems, count: Number(param('count')) || 10 });
    try { answers = JSON.parse(sessionStorage.getItem(`bq-answers-${attempt.attempt_id}`) || '{}'); } catch { answers = {}; }
    renderShell();
    renderQuestion();
  }
} catch (e) {
  app.innerHTML = `<div class="card center"><h2>Can't open this test</h2><p class="muted">${esc(friendlyError(e))}</p>
    <a class="btn" href="${rootUrl(profile.role === 'student' ? 'student/assessments.html' : 'teacher/dashboard.html')}">Back</a></div>`;
}
