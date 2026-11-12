// Learn Mode: explore a body system in 3D, read about each organ, take a guided tour + quick check.
import { requireRole } from '../auth.js';
import * as api from '../api.js';
import { AnatomyViewer, loadingOverlay, THREE } from '../three/viewer.js';
import { SYSTEMS, SYSTEM_ORDER, PATHWAYS } from '../data/pathways.js';
import { $, esc, param, toast, errorToast, speak, stopSpeaking, muteToggle, isMuted, setMuted, onMuteChange, getSettings, LEVELS, levelLabel, modal, el, shuffle, celebrate, updateXp } from '../ui.js';

const profile = await requireRole(['student', 'teacher']);
const isTeacher = profile.role !== 'student';
const app = document.getElementById('app');
document.body.classList.add('full-bleed', 'learn-fixed');
const FRONT = new THREE.Vector3(0, 0.12, 1);   // camera direction for the front view

let level = isTeacher ? (param('level') || 'simple') : await api.getMyLevel();
let system = param('system') || 'skeletal';
let models = [], content = {}, learned = new Set(), viewedThisVisit = new Set();
let current = null, tour = null, ghost = null, showLabels = false;

const availableSystems = () => SYSTEM_ORDER.filter((s) => s !== 'reproductive' || level === 'full');
if (!availableSystems().includes(system)) system = 'skeletal';

app.innerHTML = `
<div class="row between" style="margin-bottom:12px">
  <div><h1 style="margin:0">Learn mode</h1><div class="muted small" id="level-line"></div></div>
  <div class="row">
    ${isTeacher ? `<div class="tabs" id="level-tabs">${Object.keys(LEVELS).map((l) => `<button data-level="${l}">${LEVELS[l].short}</button>`).join('')}</div>` : ''}
    <button class="btn secondary" id="tour-btn">🧭 Guided tour</button>
    ${isTeacher ? '<button class="btn ghost" id="present-btn">📽 Present</button>' : ''}
  </div>
</div>
<div class="chips" id="system-chips" style="margin-bottom:12px"></div>
<div class="viewer-layout">
  <aside class="card side-list">
    <h3 id="list-title">Organs</h3>
    <div class="bar" style="margin-bottom:10px"><span id="progress-bar" style="width:0%"></span></div>
    <ul class="organ-list" id="organ-list"></ul>
  </aside>
  <section class="viewer" id="viewer">
    <div class="viewer-overlay">
      <button class="btn ghost small" id="reset-btn">⟲ Whole system</button>
      <button class="btn ghost small" id="labels-btn">🏷 Labels</button>
      <button class="btn ghost small" id="ghost-btn">🦴 Skeleton outline</button>
      <button class="btn ghost small mute-btn" id="mute-btn" type="button"></button>
      <label class="btn ghost small" style="gap:6px">X-ray <input type="range" id="xray" min="0.05" max="1" step="0.05" value="0.25" style="width:90px"></label>
    </div>
    <div class="viewer-bottom hidden" id="tour-bar">
      <button class="btn small" id="tour-prev">◀ Back</button>
      <span class="pill" style="background:rgba(255,255,255,.9)" id="tour-step"></span>
      <button class="btn small" id="tour-next">Next ▶</button>
      <button class="btn ghost small" id="tour-stop">End tour</button>
    </div>
  </section>
  <aside class="card info-panel" id="info"></aside>
</div>`;

const viewer = new AnatomyViewer($('#viewer'));
viewer.setXray(1);

// ------------------------------------------------------------------ system + level switching
function renderChips() {
  $('#system-chips').innerHTML = availableSystems().map((s) =>
    `<button class="chip ${s === system ? 'active' : ''}" data-system="${s}">${SYSTEMS[s].icon} ${SYSTEMS[s].name}</button>`).join('');
  $('#level-line').textContent = isTeacher ? `Showing: ${levelLabel(level)}` : `Your level: ${levelLabel(level)}`;
  if (isTeacher) document.querySelectorAll('#level-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.level === level));
}
$('#system-chips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-system]');
  if (b && b.dataset.system !== system) { system = b.dataset.system; loadSystem(); }
});
if (isTeacher) {
  $('#level-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-level]');
    if (b && b.dataset.level !== level) {
      level = b.dataset.level;
      if (!availableSystems().includes(system)) system = 'skeletal';
      loadSystem();
    }
  });
}

async function loadSystem(selectSlug = null) {
  stopTour();
  renderChips();
  history.replaceState(null, '', `?system=${system}${isTeacher ? `&level=${level}` : ''}`);
  viewer.clear(); ghost = null; current = null;
  showInfo(null);
  $('#organ-list').innerHTML = '';
  const tips = Object.values(content).map((c) => c.fun_fact);
  const ld = loadingOverlay($('#viewer'), 'Loading 3D model…', tips.length ? `Did you know? ${tips[Math.floor(Math.random() * tips.length)]}` : '');
  try {
    const [m, c, prog] = await Promise.all([api.getOrganModels(system, level), api.getContent(system),
      isTeacher ? Promise.resolve([]) : api.getLearnProgress()]);
    models = m; content = c;
    learned = new Set(prog.filter((p) => p.learned && p.system === system).map((p) => p.slug));
    await viewer.loadSystem(system, level, { onProgress: (p) => ld.set(p) });
    if ($('#ghost-btn').classList.contains('active')) await toggleGhost(true);
    ld.done();
    renderList();
    applyLabels();
    viewer.frame(null, { duration: 0 });
    if (selectSlug && viewer.organs.has(selectSlug)) selectOrgan(selectSlug);
  } catch (e) {
    ld.error(e.message);
    errorToast(e);
  }
}

// ------------------------------------------------------------------ organ list
function renderList() {
  $('#list-title').textContent = `${SYSTEMS[system].icon} ${SYSTEMS[system].name}`;
  $('#organ-list').innerHTML = models.map((m) => `<li><button data-slug="${m.slug}" class="${current === m.slug ? 'active' : ''}">
    <span class="dot" style="background:${m.color}"></span>${esc(m.label)}${learned.has(m.slug) ? '<span class="check">✓</span>' : ''}</button></li>`).join('');
  const pct = models.length ? (100 * models.filter((m) => learned.has(m.slug)).length) / models.length : 0;
  $('#progress-bar').style.width = `${pct}%`;
}
$('#organ-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-slug]');
  if (b) selectOrgan(b.dataset.slug);
});
document.addEventListener('keydown', (e) => {
  if (!['ArrowDown', 'ArrowUp'].includes(e.key) || e.target.closest('input,select,textarea') || !models.length) return;
  const i = models.findIndex((m) => m.slug === current);
  const next = models[(i + (e.key === 'ArrowDown' ? 1 : -1) + models.length) % models.length];
  selectOrgan(next.slug);
  e.preventDefault();
});

viewer.onTap((mesh) => { if (mesh) selectOrgan(mesh.userData.slug); else clearSelection(); });

function clearSelection() {
  current = null;
  viewer.select(null);
  viewer.setCalloutActive(null);
  viewer.setXray(1);
  showInfo(null);
  renderList();
}

function selectOrgan(slug) {
  const mesh = viewer.organs.get(slug);
  if (!mesh) return;
  current = slug;
  viewer.setXray(Number($('#xray').value));
  viewer.select(mesh);
  viewer.setCalloutActive(slug);
  // always swing round to the FRONT view of the chosen part, whatever angle the student had rotated to
  viewer.frame(mesh, { padding: 2.4, direction: FRONT.clone() });
  showInfo(slug);
  renderList();
  document.querySelector(`#organ-list [data-slug="${slug}"]`)?.scrollIntoView({ block: 'nearest' });
  try { localStorage.setItem('bq-last-learn', JSON.stringify({ system, slug })); } catch { /* ignore */ }
  if (!isTeacher && !viewedThisVisit.has(slug)) {
    viewedThisVisit.add(slug);
    api.recordView(system, slug, level).catch(console.error);
  }
}

// ------------------------------------------------------------------ info panel
function showInfo(slug) {
  const box = $('#info');
  if (!slug) {
    box.innerHTML = `<h2>Tap an organ</h2><p class="muted">Click any part of the 3D model — or pick one from the list — to find out what it is,
      where it lives and what it does.</p><p class="muted small">🖱 Drag to spin · scroll to zoom · right-drag to move.<br>📱 One finger to spin, two to zoom.</p>
      ${models.length ? `<p><strong>${models.filter((m) => learned.has(m.slug)).length} of ${models.length}</strong> learned in this system.</p>` : ''}`;
    return;
  }
  const m = models.find((x) => x.slug === slug);
  const c = content[slug] || {};
  const neighbours = models.filter((x) => x.slug !== slug).slice(0, 12);
  box.innerHTML = `
    <div class="row between"><h2 style="margin:0">${esc(m.label)}</h2>
      ${getSettings().readAloud !== false ? '<button class="icon-btn" id="read-btn" title="Read aloud" aria-label="Read aloud">🔊</button>' : ''}</div>
    <p class="small muted" style="margin-top:4px">${SYSTEMS[system].icon} ${SYSTEMS[system].name}</p>
    <div class="section"><h4>About</h4><p>${esc(c.about || '')}</p></div>
    <div class="section"><h4>📍 Where is it?</h4><p>${esc(c.location || '')}</p></div>
    <div class="section"><h4>⚙️ What does it do?</h4><p>${esc(c.function || '')}</p></div>
    <div class="section fun-fact"><strong>🤩 Fun fact:</strong> ${esc(c.fun_fact || '')}</div>
    ${isTeacher ? '' : learned.has(slug)
      ? '<p class="success-msg" style="margin-top:14px">✓ You learned this one!</p>'
      : '<button class="btn success block" id="learned-btn" style="margin-top:14px">I\'ve learned this ✓ (+10 XP)</button>'}
    <div class="section" style="margin-top:16px"><h4>Also in this system</h4>
      <div class="chips">${neighbours.map((n) => `<button class="chip small" data-goto="${n.slug}">${esc(n.label)}</button>`).join('')}</div></div>`;
  stopSpeaking();
  const readBtn = $('#read-btn');
  readBtn?.addEventListener('click', () => {
    if (readBtn.classList.contains('speaking')) { stopSpeaking(); setReading(readBtn, false); return; }
    if (isMuted()) setMuted(false);   // asking to hear it turns sound back on
    const started = speak(`${m.label}. ${c.about} Where is it? ${c.location} What does it do? ${c.function} Fun fact: ${c.fun_fact}`,
      { onend: () => setReading(readBtn, false) });
    setReading(readBtn, started);
  });
  $('#learned-btn')?.addEventListener('click', () => markLearned(slug));
  box.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => selectOrgan(b.dataset.goto)));
}

function setReading(btn, on) {
  btn.classList.toggle('speaking', on);
  btn.textContent = on ? '⏹' : '🔊';
  btn.title = on ? 'Stop reading' : 'Read aloud';
  btn.setAttribute('aria-label', btn.title);
}

async function markLearned(slug) {
  try {
    await api.markLearned(system, slug, level);
    learned.add(slug);
    toast('+10 XP — nice work!', 'success');
    renderList(); showInfo(slug);
    const p = await api.getMyProfile(); updateXp(p.xp);
    if (models.every((m) => learned.has(m.slug))) celebrate(`🏆 You learned the whole ${SYSTEMS[system].name}!`);
  } catch (e) { errorToast(e); }
}

// ------------------------------------------------------------------ viewer controls
muteToggle($('#mute-btn'), { withText: true });
onMuteChange((m) => { const b = $('#read-btn'); if (m && b) setReading(b, false); });
window.addEventListener('pagehide', stopSpeaking);
$('#reset-btn').addEventListener('click', () => { clearSelection(); viewer.frame(); });
$('#xray').addEventListener('input', (e) => { if (current) viewer.setXray(Number(e.target.value)); });
$('#labels-btn').addEventListener('click', (e) => { showLabels = !showLabels; e.currentTarget.classList.toggle('active', showLabels); applyLabels(); });
function applyLabels() {
  viewer.clearCallouts();
  if (!showLabels) return;
  viewer.setCallouts(models.filter((m) => viewer.organs.has(m.slug)).map((m) => ({ id: m.slug, text: m.label, mesh: viewer.organs.get(m.slug) })));
  viewer.setCalloutActive(current);
}
$('#ghost-btn').addEventListener('click', async (e) => {
  const on = !e.currentTarget.classList.contains('active');
  e.currentTarget.classList.toggle('active', on);
  await toggleGhost(on);
});
async function toggleGhost(on) {
  if (ghost) { viewer.removeObject(ghost); ghost = null; }
  if (on && system !== 'skeletal') {
    try { ghost = (await viewer.loadSystem('skeletal', 'simple', { ghost: true })).root; } catch (e) { errorToast(e); }
  }
}

// ------------------------------------------------------------------ guided tour + quick check
function tourOrder() {
  const pw = PATHWAYS[system]?.levels?.[level];
  if (!pw) return models.map((m) => m.slug);
  const have = new Set(models.map((m) => m.slug));
  const order = [];
  for (const s of pw.path) { if (have.has(s)) order.push(s); for (const h of pw.helpers) if (h.at === s && have.has(h.slug)) order.push(h.slug); }
  for (const m of models) if (!order.includes(m.slug)) order.push(m.slug);
  return order;
}
function startTour() { tour = { order: tourOrder(), i: 0 }; $('#tour-bar').classList.remove('hidden'); showTourStep(); }
function stopTour() { tour = null; $('#tour-bar').classList.add('hidden'); }
function showTourStep() {
  $('#tour-step').textContent = `Stop ${tour.i + 1} of ${tour.order.length}`;
  $('#tour-prev').disabled = tour.i === 0;
  $('#tour-next').textContent = tour.i === tour.order.length - 1 ? 'Finish ✓' : 'Next ▶';
  selectOrgan(tour.order[tour.i]);
}
$('#tour-btn').addEventListener('click', startTour);
$('#tour-stop').addEventListener('click', stopTour);
$('#tour-prev').addEventListener('click', () => { if (tour && tour.i > 0) { tour.i--; showTourStep(); } });
$('#tour-next').addEventListener('click', () => {
  if (!tour) return;
  if (tour.i < tour.order.length - 1) { tour.i++; showTourStep(); } else { stopTour(); quickCheck(); }
});

async function quickCheck() {
  const pool = models.filter((m) => content[m.slug]);
  if (pool.length < 2) return;
  const qs = shuffle(pool).slice(0, Math.min(3, pool.length)).map((m) => {
    const others = shuffle(pool.filter((o) => o.slug !== m.slug)).slice(0, 3);
    return { text: content[m.slug].function, answer: m.label, choices: shuffle([m.label, ...others.map((o) => o.label)]) };
  });
  const picks = new Array(qs.length).fill(null);
  const body = el('div', {}, el('p', { class: 'muted' }, 'Which organ does each job? Pick one answer for each.'),
    ...qs.map((q, qi) => el('div', { class: 'field' }, el('p', {}, el('strong', {}, `${qi + 1}. ${q.text}`)),
      el('div', { class: 'choices' }, ...q.choices.map((c) => el('button', { class: 'choice', type: 'button',
        onclick: (e) => { picks[qi] = c; e.currentTarget.parentElement.querySelectorAll('.choice').forEach((b) => b.classList.toggle('selected', b === e.currentTarget)); } }, c))))));
  const ok = await modal({ title: '🧠 Quick check', body, wide: true,
    actions: [{ label: 'Skip', class: 'ghost', value: false }, { label: 'Check answers', value: true,
      onClick: () => { if (picks.includes(null)) { toast('Answer every question first'); return false; } return true; } }] });
  if (ok !== true) return;
  const score = qs.filter((q, i) => picks[i] === q.answer).length;
  if (!isTeacher) {
    try { await api.saveQuickCheck(system, level, score, qs.length); const p = await api.getMyProfile(); updateXp(p.xp); } catch (e) { errorToast(e); }
  }
  await modal({ title: score === qs.length ? '🎉 Perfect!' : `You got ${score} of ${qs.length}`,
    body: `<div class="stack">${qs.map((q, i) => `<div class="result-item ${picks[i] === q.answer ? 'ok' : 'no'}"><strong>${esc(q.text)}</strong><br>
      ${picks[i] === q.answer ? '✓' : `✗ You chose ${esc(picks[i])}.`} Answer: <strong>${esc(q.answer)}</strong></div>`).join('')}</div>
      ${isTeacher ? '' : `<p class="muted">+${score * 3} XP</p>`}` });
}

// ------------------------------------------------------------------ presentation mode (teachers)
$('#present-btn')?.addEventListener('click', async () => {
  const on = !document.body.classList.contains('presentation');
  document.body.classList.toggle('presentation', on);
  document.body.classList.toggle('big-labels', on);
  if (on) { document.documentElement.requestFullscreen?.().catch(() => {}); toast('Presentation mode — press Esc to leave'); }
  else if (document.fullscreenElement) document.exitFullscreen();
});
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) { document.body.classList.remove('presentation', 'big-labels'); }
});

await loadSystem(param('slug'));
if (param('tour')) startTour();
