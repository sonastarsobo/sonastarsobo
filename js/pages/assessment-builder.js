// Teacher creates a test: random from the question bank, or hand-picked, plus their own questions.
import { requireRole } from '../auth.js';
import * as api from '../api.js';
import { rootUrl } from '../supabase.js';
import { SYSTEMS, SYSTEM_ORDER } from '../data/pathways.js';
import { $, $$, el, esc, param, modal, toast, errorToast, shuffle, LEVELS } from '../ui.js';
import { AnatomyViewer, loadingOverlay } from '../three/viewer.js';

await requireRole(['teacher']);
const app = document.getElementById('app');
const classes = await api.getTeacherClasses().catch((e) => { errorToast(e); return []; });
if (!classes.length) {
  app.innerHTML = `<div class="card center"><h2>Create a class first</h2><a class="btn" href="${rootUrl('teacher/dashboard.html')}">My classes</a></div>`;
  throw new Error('no classes');
}
const levelFor = (c) => c.level_override || (c.grade <= 4 ? 'simple' : c.grade <= 6 ? 'medium' : 'full');
const TYPE_NAMES = { click_organ: '👆 Click the organ', label_match: '🏷️ Label the model' };
let picked = new Set(), bank = [];

app.innerHTML = `
<a href="${rootUrl('teacher/dashboard.html')}">← My classes</a>
<h1 style="margin-top:8px">📝 Create a 3D test</h1>
<p class="muted">Every question is answered on the 3D model: students click the right organ, or match numbered markers to names.</p>
<div class="grid cols-2" style="align-items:start">
  <form class="card" id="form">
    <div class="field"><label for="cls">Class</label><select id="cls">${classes.map((c) => `<option value="${c.id}" ${c.id === param('class') ? 'selected' : ''}>${esc(c.name)} (grade ${c.grade})</option>`).join('')}</select></div>
    <div class="field"><label for="title">Title</label><input id="title" type="text" maxlength="100" placeholder="e.g. Digestive system check"></div>
    <div class="field"><label>Body systems</label><div class="chips" id="systems">${SYSTEM_ORDER.map((s) => `<button type="button" class="chip" data-s="${s}">${SYSTEMS[s].icon} ${SYSTEMS[s].name.replace(' system', '')}</button>`).join('')}</div></div>
    <div class="field"><label for="level">Level</label><select id="level">${Object.entries(LEVELS).map(([k, v]) => `<option value="${k}">${v.name} · ${v.grades}</option>`).join('')}</select></div>
    <div class="field"><label>Questions</label>
      <div class="tabs" id="mode"><button type="button" data-m="random" class="active">🎲 Random from bank</button><button type="button" data-m="pick">✋ I'll choose</button></div></div>
    <div class="field" id="count-field"><label for="count">Number of questions: <span id="count-val">10</span></label><input id="count" type="range" min="3" max="30" value="10" style="width:100%"></div>
    <div class="grid cols-2">
      <div class="field"><label for="time">Time limit (minutes)</label><input id="time" type="number" min="1" max="120" placeholder="No limit"></div>
      <div class="field"><label for="due">Due date</label><input id="due" type="datetime-local"></div>
    </div>
    <label class="checkbox" style="margin-bottom:14px"><input type="checkbox" id="retake"> Allow students to retake</label>
    <button class="btn block big">Create &amp; assign test</button>
  </form>
  <section class="card">
    <div class="row between"><h2 style="margin:0">🧠 Question bank</h2><button class="btn secondary small" id="add-q">✍️ Make my own 3D question</button></div>
    <p class="muted small" id="bank-info">Choose body systems to see questions.</p>
    <div class="chips" id="type-filter" style="margin-bottom:10px"></div>
    <div id="bank" style="max-height:60vh;overflow-y:auto"></div>
  </section>
</div>`;

const selectedSystems = () => $$('#systems .chip.active').map((b) => b.dataset.s);
let mode = 'random', typeFilter = 'all';

function syncLevel() { $('#level').value = levelFor(classes.find((c) => c.id === $('#cls').value)); loadBank(); }
$('#cls').onchange = syncLevel;
$('#level').onchange = loadBank;
$('#count').oninput = (e) => { $('#count-val').textContent = e.target.value; };
$('#systems').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (b) { b.classList.toggle('active'); loadBank(); } });
$('#mode').addEventListener('click', (e) => {
  const b = e.target.closest('[data-m]'); if (!b) return;
  mode = b.dataset.m;
  $$('#mode button').forEach((x) => x.classList.toggle('active', x === b));
  $('#count-field').classList.toggle('hidden', mode === 'pick');
  renderBank();
});

async function loadBank() {
  const systems = selectedSystems();
  picked = new Set([...picked].filter((id) => bank.some((q) => q.id === id && systems.includes(q.system))));
  if (!systems.length) { bank = []; renderBank(); return; }
  try { bank = await api.getQuestions(systems, $('#level').value); } catch (e) { errorToast(e); bank = []; }
  renderBank();
}

function renderBank() {
  const types = [...new Set(bank.map((q) => q.type))];
  $('#type-filter').innerHTML = bank.length ? ['all', ...types].map((t) => `<button type="button" class="chip ${typeFilter === t ? 'active' : ''}" data-t="${t}">${t === 'all' ? 'All' : TYPE_NAMES[t]}</button>`).join('') : '';
  $('#type-filter').querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { typeFilter = b.dataset.t; renderBank(); });
  const shown = bank.filter((q) => typeFilter === 'all' || q.type === typeFilter);
  $('#bank-info').textContent = bank.length
    ? `${bank.length} questions available${mode === 'pick' ? ` · ${picked.size} selected` : ' · a random mix will be picked'}`
    : 'Choose body systems to see questions.';
  $('#bank').innerHTML = shown.map((q) => `<label class="card flat" style="display:flex;gap:10px;padding:10px 12px;margin-bottom:8px;font-weight:600;cursor:${mode === 'pick' ? 'pointer' : 'default'}">
    ${mode === 'pick' ? `<input type="checkbox" data-id="${q.id}" ${picked.has(q.id) ? 'checked' : ''} style="width:20px;height:20px;flex:none">` : ''}
    <span>${esc(q.prompt)}<br><span class="pill">${TYPE_NAMES[q.type]}</span> <span class="pill">${SYSTEMS[q.system]?.icon}</span>${q.created_by ? ' <span class="pill primary">mine</span>' : ''}</span></label>`).join('');
  $('#bank').querySelectorAll('[data-id]').forEach((c) => c.onchange = () => {
    if (c.checked) picked.add(c.dataset.id); else picked.delete(c.dataset.id);
    $('#bank-info').textContent = `${bank.length} questions available · ${picked.size} selected`;
  });
}

// ------------------------------------------------------------------ write my own: built on the 3D model
const MAX_MARKERS = 5;
$('#add-q').onclick = () => openMaker();

async function openMaker() {
  const level = $('#level').value;
  const sysList = SYSTEM_ORDER.filter((s) => s !== 'reproductive' || level === 'full');
  const first = selectedSystems().find((s) => sysList.includes(s)) || sysList[0];
  const body = el('div', { class: 'q-maker', html: `
    <div class="qm-top">
      <div class="field"><label for="qm-sys">Body system</label>
        <select id="qm-sys">${sysList.map((s) => `<option value="${s}" ${s === first ? 'selected' : ''}>${SYSTEMS[s].icon} ${SYSTEMS[s].name}</option>`).join('')}</select></div>
      <div class="field"><label>Question type</label>
        <div class="seg" id="qm-type">
          <button type="button" data-t="click_organ" class="active">👆 Click the organ</button>
          <button type="button" data-t="label_match">🏷️ Label the model</button></div></div>
      <div class="field qm-level"><label>Model level</label><span class="pill">${esc(LEVELS[level].name)}</span></div>
    </div>
    <div class="qm-main">
      <div class="viewer qm-viewer" id="qm-viewer">
        <div class="qm-hint" id="qm-hint"></div>
        <div class="zoom-ctrl"><button class="btn ghost small" type="button" id="qm-reset" title="Show the whole system" aria-label="Show the whole system">⤢</button></div>
      </div>
      <div class="qm-side">
        <div id="qm-answer"></div>
        <div class="field"><label for="qm-prompt">Question students will see</label><textarea id="qm-prompt" rows="3"></textarea></div>
        <div class="field"><label for="qm-expl">Explanation shown after marking (optional)</label><input id="qm-expl" type="text" placeholder="e.g. The liver cleans your blood."></div>
      </div>
    </div>` });

  let type = 'click_organ', viewer = null, labels = {}, answerSlug = null, markers = [], promptEdited = false, loadId = 0;
  const promptBox = $('#qm-prompt', body);
  promptBox.addEventListener('input', () => { promptEdited = true; });
  const defaultPrompt = () => (type === 'click_organ'
    ? (answerSlug ? `Click on the ${(labels[answerSlug] || answerSlug).toLowerCase()}.` : '')
    : 'Match each numbered marker on the model to the right name.');
  const setPrompt = () => { if (!promptEdited) promptBox.value = defaultPrompt(); };

  function renderSide() {
    $('#qm-hint', body).textContent = type === 'click_organ'
      ? '👆 Click the organ that is the correct answer. Drag to spin, scroll to zoom.'
      : `🏷️ Click up to ${MAX_MARKERS} different organs to put numbered markers on them.`;
    const box = $('#qm-answer', body);
    if (type === 'click_organ') {
      box.innerHTML = `<label>Correct answer</label>${answerSlug
        ? `<div class="qm-picked">✅ <strong>${esc(labels[answerSlug] || answerSlug)}</strong></div>`
        : '<div class="qm-picked empty">Nothing picked yet — click an organ on the model.</div>'}`;
    } else {
      box.innerHTML = `<label>Markers (${markers.length}/${MAX_MARKERS}) — students match each number to its name</label>
        ${markers.length ? `<ol class="qm-markers">${markers.map((m, i) => `<li><span class="qm-num">${i + 1}</span>${esc(labels[m.slug] || m.slug)}
          <button type="button" class="icon-btn" data-rm="${i}" aria-label="Remove marker ${i + 1}">✕</button></li>`).join('')}</ol>`
          : '<div class="qm-picked empty">No markers yet — click at least 2 organs on the model.</div>'}`;
      box.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { markers.splice(Number(b.dataset.rm), 1); drawMarkers(); renderSide(); });
    }
  }
  function drawMarkers() {
    if (!viewer) return;
    viewer.clearLabels();
    markers.forEach((m, i) => viewer.addLabel(`m${i}`, String(i + 1), m.point, 'marker'));
  }

  async function loadModel() {
    const id = ++loadId;
    const sys = $('#qm-sys', body).value;
    answerSlug = null; markers = [];
    if (!viewer) {
      viewer = new AnatomyViewer($('#qm-viewer', body));
      viewer.onTap((mesh, e) => {
        if (!mesh) return;
        const slug = mesh.userData.slug;
        if (type === 'click_organ') {
          answerSlug = slug; viewer.select(slug);
        } else {
          if (markers.some((m) => m.slug === slug)) { toast('That organ already has a marker'); return; }
          if (markers.length >= MAX_MARKERS) { toast(`Up to ${MAX_MARKERS} markers`); return; }
          const hit = viewer.pickHit(e.clientX, e.clientY);
          markers.push({ slug, point: (hit?.point || viewer.worldCenter(mesh)).clone() });
          drawMarkers();
        }
        setPrompt(); renderSide();
      });
    }
    viewer.clear();
    const ld = loadingOverlay($('#qm-viewer', body));
    try {
      const [models] = await Promise.all([api.getOrganModels(sys, level), viewer.loadSystem(sys, level)]);
      if (id !== loadId) return;
      labels = Object.fromEntries(models.map((m) => [m.slug, m.label]));
      ld.done();
      viewer.setXray(1);
      viewer.frame(null, { duration: 0 });
    } catch (err) { ld.error(err.message); }
    setPrompt(); renderSide();
  }

  $('#qm-sys', body).onchange = loadModel;
  $('#qm-reset', body).onclick = () => viewer?.frame();
  $('#qm-type', body).addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]'); if (!b || b.dataset.t === type) return;
    type = b.dataset.t;
    $$('#qm-type button', body).forEach((x) => x.classList.toggle('active', x === b));
    answerSlug = null; markers = []; promptEdited = false;
    viewer?.select(null); viewer?.setXray(type === 'label_match' ? 0.6 : 1); drawMarkers();
    setPrompt(); renderSide();
  });

  const save = async () => {
    const sys = $('#qm-sys', body).value, prompt = promptBox.value.trim();
    let options, answer, slug, explanation = $('#qm-expl', body).value.trim();
    if (type === 'click_organ') {
      if (!answerSlug) { toast('Click the correct organ on the model'); return false; }
      options = {}; answer = answerSlug; slug = answerSlug;
      explanation ||= `This is the ${(labels[answerSlug] || answerSlug).toLowerCase()}.`;
    } else {
      if (markers.length < 2) { toast('Put markers on at least 2 organs'); return false; }
      const names = markers.map((m) => labels[m.slug] || m.slug);
      const round = (v) => Math.round(v * 10000) / 10000;
      options = { markers: markers.map((m) => [round(m.point.x), round(m.point.y), round(m.point.z)]), labels: shuffle(names.slice()) };
      answer = names; slug = markers[0].slug;
      explanation ||= names.map((n, i) => `${i + 1} = ${n}`).join('; ');
    }
    if (!prompt) { toast('Write the question students will see'); return false; }
    try {
      await api.addQuestion({ system: sys, level, type, prompt, options, answer, explanation, slug });
      toast('3D question saved to your bank', 'success');
      document.querySelector(`#systems [data-s="${sys}"]`)?.classList.add('active');
      await loadBank();
    } catch (err) { errorToast(err); return false; }
  };

  const done = modal({ title: '✍️ Make a 3D question', body, wide: true,
    actions: [{ label: 'Cancel', class: 'ghost' }, { label: '💾 Save question', onClick: save }] });
  body.closest('.modal')?.classList.add('modal-xl');
  renderSide();
  loadModel();
  await done;
  viewer?.dispose();
}

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const systems = selectedSystems();
  const title = $('#title').value.trim();
  if (!title) { toast('Give the test a title'); return; }
  if (!systems.length) { toast('Choose at least one body system'); return; }
  if (mode === 'pick' && !picked.size) { toast('Tick the questions you want'); return; }
  const mins = Number($('#time').value);
  try {
    await api.createAssessment({ classId: $('#cls').value, title, systems, level: $('#level').value, count: Number($('#count').value),
      timeLimitSec: mins ? mins * 60 : null, dueAt: $('#due').value ? new Date($('#due').value).toISOString() : null,
      allowRetake: $('#retake').checked, questionIds: mode === 'pick' ? [...picked] : null });
    toast('Test created and assigned!', 'success');
    location.href = rootUrl(`teacher/class.html?id=${$('#cls').value}&tab=tests`);
  } catch (err) { errorToast(err); }
});

syncLevel();
