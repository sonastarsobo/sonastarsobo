// One class: students & progress, insights (weak spots), assignments, tests, settings.
import { requireRole, usernameKey } from '../auth.js';
import * as api from '../api.js';
import { rootUrl } from '../supabase.js';
import { SYSTEMS, SYSTEM_ORDER, PATHWAYS } from '../data/pathways.js';
import { $, $$, el, esc, param, modal, toast, errorToast, confirmDialog, fmtDate, timeAgo, downloadCsv, LEVELS, levelLabel, masteryClass } from '../ui.js';

await requireRole(['teacher']);
const app = document.getElementById('app');
const classId = param('id');
let cls, tab = param('tab') || 'students';

try { cls = await api.getClass(classId); } catch (e) {
  app.innerHTML = `<div class="card center"><h2>Class not found</h2><a class="btn" href="${rootUrl('teacher/dashboard.html')}">Back</a></div>`;
  throw e;
}
const classLevel = () => cls.level_override || (cls.grade <= 4 ? 'simple' : cls.grade <= 6 ? 'medium' : 'full');

function shell() {
  app.innerHTML = `
  <a href="${rootUrl('teacher/dashboard.html')}">← My classes</a>
  <div class="row between" style="margin:8px 0 14px">
    <div><h1 style="margin:0">${esc(cls.name)}</h1><div class="muted">Grade ${cls.grade} · ${esc(levelLabel(classLevel()))}</div></div>
    <div class="card flat row" style="padding:10px 16px">
      <div><div class="small muted">Class code</div><div style="font-size:1.6em;font-weight:900;letter-spacing:.2em">${esc(cls.join_code)}</div></div>
      <button class="btn secondary small" id="copy-link">Copy join link</button>
    </div>
  </div>
  <div class="tabs" id="tabs" style="margin-bottom:16px">
    ${[['students', '👩‍🎓 Students'], ['insights', '📊 Insights'], ['assignments', '📌 Assignments'], ['tests', '📝 Tests'], ['settings', '⚙️ Settings']]
      .map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'active' : ''}">${l}</button>`).join('')}
  </div>
  <div id="pane"></div>`;
  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; history.replaceState(null, '', `?id=${classId}&tab=${tab}`); shell(); } });
  $('#copy-link').onclick = () => {
    const link = rootUrl(`login.html?code=${cls.join_code}`);
    navigator.clipboard?.writeText(link).then(() => toast('Join link copied!', 'success'), () => toast(link));
  };
  ({ students, insights, assignments, tests, settings })[tab]().catch(errorToast);
}

// ------------------------------------------------------------------ students
let creds = new Map();
async function students() {
  const rows = await api.classOverview(classId);
  creds = new Map((await api.getStudentCredentials(rows.map((r) => r.student_id))).map((c) => [c.student_id, c]));
  const pane = $('#pane');
  pane.innerHTML = `
  <div class="card">
    <div class="row between" style="margin-bottom:10px">
      <div><h2 style="margin:0">${rows.length} student${rows.length === 1 ? '' : 's'}</h2>
        ${rows.length ? '<div class="small muted">Click a student\'s name to see their username and password.</div>' : ''}</div>
      <div class="row"><button class="btn secondary" id="add-students">＋ Add students</button><button class="btn ghost" id="csv">⬇ Export CSV</button></div>
    </div>
    ${rows.length ? `<div class="table-wrap"><table class="table"><thead><tr>
      <th>Student</th><th>XP</th><th>🔥</th><th>Organs learned</th><th>Games</th><th>Best Blaster</th><th>Builder ⭐</th><th>Tests avg</th><th>Mastery</th><th>Last active</th><th></th></tr></thead><tbody>
      ${rows.map((r) => {
        const inactive = !r.last_active || (Date.now() - new Date(r.last_active)) / 86400000 > 7;
        return `<tr><td><button type="button" class="name-link" data-login="${r.student_id}" title="Show login details"><strong>${esc(r.display_name)}</strong><span class="small muted">🔑 ${esc(r.username || '')}</span></button></td>
        <td>${r.xp}</td><td>${r.streak}</td><td>${r.organs_learned}</td><td>${r.games_played}</td><td>${r.best_blaster ?? '—'}</td>
        <td>${r.builder_stars}</td><td>${r.avg_test_percent != null ? `${r.avg_test_percent}%` : '—'}</td>
        <td><span class="pill ${masteryClass(r.avg_mastery)}">${r.avg_mastery != null ? `${r.avg_mastery}%` : '—'}</span></td>
        <td class="${inactive ? '' : 'muted'}">${inactive ? '⚠️ ' : ''}${r.last_active ? fmtDate(r.last_active) : 'never'}</td>
        <td><div class="actions-cell">
          <a class="btn small" href="${rootUrl(`teacher/student.html?id=${r.student_id}&class=${classId}`)}">Report</a>
          <button class="btn ghost small" data-reset="${r.student_id}" data-name="${esc(r.display_name)}" title="Reset password">🔑</button>
          <button class="btn ghost small" data-remove="${r.student_id}" data-name="${esc(r.display_name)}" title="Remove from class">✕</button></div></td></tr>`;
      }).join('')}</tbody></table></div>`
    : `<p class="muted">No students yet. Share the class code <strong>${esc(cls.join_code)}</strong> or click “Add students”.</p>`}
  </div>`;
  $('#add-students').onclick = addStudents;
  pane.querySelectorAll('[data-login]').forEach((b) => b.onclick = () => showLogin(rows.find((r) => r.student_id === b.dataset.login)));
  $('#csv').onclick = () => downloadCsv(`${cls.name}-progress.csv`, rows.map((r) => ({
    name: r.display_name, username: r.username, xp: r.xp, streak: r.streak, organs_learned: r.organs_learned, games_played: r.games_played,
    best_blaster: r.best_blaster, builder_stars: r.builder_stars, tests_taken: r.tests_taken, avg_test_percent: r.avg_test_percent,
    avg_mastery: r.avg_mastery, last_active: r.last_active })));
  pane.querySelectorAll('[data-reset]').forEach((b) => b.onclick = () => resetPassword(b.dataset.reset, b.dataset.name));
  pane.querySelectorAll('[data-remove]').forEach((b) => b.onclick = async () => {
    if (!(await confirmDialog('Remove student?', `Remove ${b.dataset.name} from ${cls.name}? Their progress is kept.`, 'Remove', true))) return;
    try { await api.removeStudent(classId, b.dataset.remove); toast('Removed'); students(); } catch (e) { errorToast(e); }
  });
}

async function addStudents() {
  const body = el('div', { html: `<p class="muted">Type one student per line. <strong>The name you type becomes their username exactly</strong>
      (capital letters and spaces included), and each student gets a short password like <code>tiger-42</code>.</p>
    <textarea id="names" rows="8" placeholder="Aarav K&#10;Meera R&#10;Kabir S"></textarea>
    <div id="name-warn" aria-live="polite"></div>
    <p class="help">Two students can't have the same name — add an initial or number (e.g. "Aarav K", "Aarav 2").
      Students can also join on their own: login page → “Join a class” → code <strong>${esc(cls.join_code)}</strong>.</p>` });
  const box = $('#names', body), warn = $('#name-warn', body);
  const listNames = () => box.value.split('\n').map((n) => n.trim().replace(/\s+/g, ' ')).filter(Boolean);
  const key = (n) => usernameKey(n);
  let lastBad = [];
  const showWarn = (taken, repeated) => {
    const before = lastBad.join("|");
    lastBad = [...new Set([...taken, ...repeated])];
    warn.innerHTML = lastBad.length ? `<div class="error-msg name-warn">⚠️ <strong>A student with this exact name already exists:</strong>
      ${lastBad.map((n) => `<span class="pill danger">${esc(n)}</span>`).join(' ')}
      <div class="small">Change these names (for example add an initial) before creating the accounts.</div></div>` : '';
    if (lastBad.length && lastBad.join("|") !== before) toast(`⚠️ “${lastBad[0]}” already exists — please use a different name`);
  };
  const repeatedIn = (names) => {
    const seen = new Set(), rep = [];
    for (const n of names) { if (seen.has(key(n))) rep.push(n); else seen.add(key(n)); }
    return rep;
  };
  let timer = null, checkId = 0;
  const check = async () => {
    const names = listNames(), id = ++checkId;
    if (!names.length) { showWarn([], []); return { taken: [], repeated: [] }; }
    const repeated = repeatedIn(names);
    let taken = [];
    try { taken = (await api.manageStudents({ action: 'check_usernames', names })).taken || []; } catch { /* checked again on create */ }
    if (id === checkId) showWarn(taken, repeated);
    return { taken, repeated };
  };
  box.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(check, 700); });
  await modal({ title: '➕ Add students', body, actions: [{ label: 'Cancel', class: 'ghost' }, { label: 'Create accounts', onClick: async () => {
    const names = listNames();
    if (!names.length) { toast('Add at least one name'); return false; }
    if (names.length > 60) { toast('Up to 60 at a time, please'); return false; }
    const { taken, repeated } = await check();
    if (taken.length || repeated.length) return false;
    try {
      const res = await api.manageStudents({ action: 'bulk_create', class_id: classId, students: names.map((n) => ({ display_name: n })) });
      showCards(res.created, res.failed);
      students();
    } catch (e) {
      if (e.taken?.length || e.repeated?.length) { showWarn(e.taken || [], e.repeated || []); return false; }
      errorToast(e); return false;
    }
  } }] });
}

function showCards(created, failed = []) {
  const loginUrl = rootUrl('login.html');
  const body = el('div', { html: `
    ${failed.length ? `<div class="error-msg">Could not create: ${failed.map((f) => esc(`${f.display_name} (${f.error})`)).join(', ')}</div>` : ''}
    <p class="success-msg">Accounts created! You can see each login again any time by clicking the student's name in the Students tab.</p>
    <div id="cards" class="grid cols-2">${created.map((s) => `<div class="login-card">
      <strong style="font-size:1.2em">🫀 SOBO</strong><div>${esc(s.display_name)} · ${esc(cls.name)}</div>
      <div style="margin-top:8px">Username: <strong>${esc(s.username)}</strong></div><div>Password: <strong>${esc(s.password)}</strong></div>
      <div class="small muted">${esc(loginUrl)}</div></div>`).join('')}</div>` });
  modal({ title: 'Login cards', body, wide: true, actions: [
    { label: 'Download CSV', class: 'ghost', onClick: () => { downloadCsv(`${cls.name}-logins.csv`, created); return false; } },
    { label: '🖨 Print cards', onClick: () => { printCards(body.querySelector('#cards').innerHTML); return false; } },
    { label: 'Done', class: 'secondary' }] });
}

function printCards(html) {
  const w = window.open('', '_blank');
  if (!w) { toast('Allow pop-ups to print'); return; }
  w.document.write(`<html><head><title>Login cards</title><link rel="stylesheet" href="${rootUrl('css/style.css')}"></head>
    <body style="padding:20px"><div class="grid cols-2">${html}</div><script>setTimeout(()=>print(),400)<\/script></body></html>`);
  w.document.close();
}

function loginCardHtml(name, username, password) {
  return `<div class="login-card">
    <strong style="font-size:1.2em">🫀 SOBO</strong><div>${esc(name)} · ${esc(cls.name)}</div>
    <div style="margin-top:8px">Username: <strong>${esc(username)}</strong></div><div>Password: <strong>${esc(password)}</strong></div>
    <div class="small muted">${esc(rootUrl('login.html'))}</div></div>`;
}

function showLogin(r) {
  if (!r) return;
  const c = creds.get(r.student_id);
  const body = el('div', { html: `
    <div class="login-details">
      <div class="ld-row"><span class="ld-label">👤 Username</span><span class="ld-value" id="ld-user">${esc(r.username || '—')}</span>
        <button type="button" class="btn ghost small" data-copy="ld-user">📋 Copy</button></div>
      <div class="ld-row"><span class="ld-label">🔑 Password</span>
        ${c ? `<span class="ld-value" id="ld-pass">${esc(c.password)}</span><button type="button" class="btn ghost small" data-copy="ld-pass">📋 Copy</button>`
          : '<span class="ld-value muted ld-none">Not saved</span>'}</div>
    </div>
    ${c ? `<p class="small muted">Password set ${esc(timeAgo(c.updated_at))}. If the student changed it themselves, use “New password”.</p>`
      : '<p class="small muted">This student chose their own password (Join a class), or the account was made before passwords were saved. Click “New password” to make one you can see here.</p>'}` });
  body.querySelectorAll('[data-copy]').forEach((btn) => btn.onclick = () => {
    const text = $(`#${btn.dataset.copy}`, body).textContent;
    navigator.clipboard?.writeText(text).then(() => toast('Copied!', 'success'), () => toast(text));
  });
  const actions = [
    { label: '🔄 New password', class: 'ghost', onClick: () => { resetPassword(r.student_id, r.display_name); } },
    { label: '📊 Report', class: 'ghost', onClick: () => { location.href = rootUrl(`teacher/student.html?id=${r.student_id}&class=${classId}`); } },
  ];
  if (c) actions.push({ label: '🖨 Print card', class: 'ghost', onClick: () => { printCards(loginCardHtml(r.display_name, r.username, c.password)); return false; } });
  actions.push({ label: 'Done', class: 'secondary' });
  modal({ title: `🔐 ${r.display_name}'s login`, body, actions });
}

async function resetPassword(studentId, name) {
  if (!(await confirmDialog('Reset password?', `Create a new password for ${name}?`, 'Reset'))) return;
  try {
    const res = await api.manageStudents({ action: 'reset_password', student_id: studentId });
    modal({ title: `New password for ${name}`, body: `<p>Username: <strong>${esc(res.username)}</strong></p><p>New password: <strong style="font-size:1.3em">${esc(res.password)}</strong></p><p class="small muted">Saved — you can see it again by clicking the student's name.</p>` });
    if (tab === 'students') students();
  } catch (e) { errorToast(e); }
}

// ------------------------------------------------------------------ insights
async function insights() {
  const [weak, missed, rows] = await Promise.all([api.classWeakSpots(classId), api.classMissedQuestions(classId), api.classOverview(classId)]);
  const inactive = rows.filter((r) => !r.last_active || (Date.now() - new Date(r.last_active)) / 86400000 > 7);
  const heat = (rate) => {
    const r = Number(rate);
    return r >= 0.6 ? '#f8b4b4' : r >= 0.4 ? '#fcd3b0' : r >= 0.25 ? '#fde9a8' : '#cdeccf';
  };
  $('#pane').innerHTML = `
  <div class="grid cols-2" style="align-items:start">
    <section class="card" style="grid-column:1/-1">
      <h2>🔥 Weak-spot heatmap</h2>
      <p class="muted small">Organs the class gets wrong most often in games and tests (at least 3 answers). Redder = more mistakes.</p>
      ${weak.length ? `<div class="heat">${weak.map((w) => `<a class="cell" style="background:${heat(w.wrong_rate)};color:#222;text-decoration:none"
        href="${rootUrl(`student/learn.html?system=${w.system}&level=${classLevel()}`)}" title="Open in Learn mode">
        ${SYSTEMS[w.system]?.icon || ''} ${esc(w.label)}<small>${Math.round(w.wrong_rate * 100)}% wrong · ${w.answers} answers</small></a>`).join('')}</div>`
      : '<p class="muted">Not enough answers yet. Once students play games and take tests, their trouble spots show up here.</p>'}
    </section>
    <section class="card">
      <h2>❓ Most-missed test questions</h2>
      ${missed.length ? `<div class="stack">${missed.map((m) => `<div class="result-item no"><div>${esc(m.prompt)}</div>
        <div class="small muted">${SYSTEMS[m.system]?.icon || ''} ${m.wrong} of ${m.answers} wrong</div></div>`).join('')}</div>`
      : '<p class="muted">No test data yet.</p>'}
    </section>
    <section class="card">
      <h2>😴 Not active this week</h2>
      ${inactive.length ? `<ul>${inactive.map((r) => `<li><strong>${esc(r.display_name)}</strong> — last active ${r.last_active ? timeAgo(r.last_active) : 'never'}</li>`).join('')}</ul>`
      : '<p class="muted">Everyone has been active this week. 🎉</p>'}
    </section>
  </div>`;
}

// ------------------------------------------------------------------ assignments
async function assignments() {
  const list = await api.getClassAssignments(classId);
  $('#pane').innerHTML = `
  <div class="grid cols-2" style="align-items:start">
    <section class="card">
      <h2>Current assignments</h2>
      ${list.length ? `<div class="stack">${list.map((a) => `<div class="card flat row between" style="padding:12px 14px">
        <div><strong>${esc(a.title)}</strong><div class="small muted">${{ learn: '📖 Learn', game: '🎮 Game', assessment: '📝 Test' }[a.type]}
          ${a.due_at ? ` · due ${fmtDate(a.due_at, true)}` : ''}${a.target_score ? ` · target ${a.target_score}` : ''}</div></div>
        <button class="btn ghost small" data-del="${a.id}">Delete</button></div>`).join('')}</div>` : '<p class="muted">No assignments yet.</p>'}
    </section>
    <section class="card">
      <h2>New assignment</h2>
      <form id="asg-form">
        <div class="field"><label>Type</label><div class="tabs" id="asg-type"><button type="button" data-t="learn" class="active">📖 Learn a system</button><button type="button" data-t="game">🎮 Play a game</button></div></div>
        <div class="field"><label for="asg-system">Body system</label><select id="asg-system"></select></div>
        <div id="game-fields" class="hidden">
          <div class="field"><label for="asg-game">Game</label><select id="asg-game"><option value="organ_blaster">Organ Blaster</option><option value="system_builder">System Builder</option></select></div>
          <div class="field"><label for="asg-target">Target score (optional)</label><input id="asg-target" type="number" min="0" step="50" placeholder="e.g. 1500"></div>
        </div>
        <div class="field"><label for="asg-due">Due (optional)</label><input id="asg-due" type="datetime-local"></div>
        <button class="btn block">Assign to class</button>
        <p class="help">Tests are assigned from the “Tests” tab.</p>
      </form>
    </section>
  </div>`;
  let type = 'learn';
  const fillSystems = () => {
    const gameSys = type === 'game' && $('#asg-game').value === 'system_builder' ? Object.keys(PATHWAYS) : SYSTEM_ORDER.filter((s) => s !== 'reproductive' || classLevel() === 'full');
    $('#asg-system').innerHTML = gameSys.map((s) => `<option value="${s}">${SYSTEMS[s].icon} ${SYSTEMS[s].name}</option>`).join('');
  };
  fillSystems();
  $('#asg-game').onchange = fillSystems;
  $('#asg-type').addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    type = b.dataset.t;
    $$('#asg-type button').forEach((x) => x.classList.toggle('active', x === b));
    $('#game-fields').classList.toggle('hidden', type !== 'game');
    fillSystems();
  });
  $('#asg-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const system = $('#asg-system').value, game = $('#asg-game').value;
    const target = Number($('#asg-target').value) || null;
    const title = type === 'learn' ? `Learn the ${SYSTEMS[system].name}`
      : `${game === 'organ_blaster' ? 'Organ Blaster' : 'System Builder'}: ${SYSTEMS[system].name}${target ? ` (${target}+ points)` : ''}`;
    try {
      await api.createAssignment({ class_id: classId, type, title, system, game: type === 'game' ? game : null,
        target_score: type === 'game' ? target : null, due_at: $('#asg-due').value ? new Date($('#asg-due').value).toISOString() : null });
      toast('Assigned!', 'success'); assignments();
    } catch (err) { errorToast(err); }
  });
  $('#pane').querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    if (!(await confirmDialog('Delete assignment?', 'Students will no longer see it.', 'Delete', true))) return;
    try { await api.deleteAssignment(b.dataset.del); assignments(); } catch (e) { errorToast(e); }
  });
}

// ------------------------------------------------------------------ tests
async function tests() {
  const list = await api.getClassAssessments(classId);
  $('#pane').innerHTML = `
  <section class="card">
    <div class="row between"><h2 style="margin:0">Tests</h2><a class="btn" href="${rootUrl(`teacher/assessment-builder.html?class=${classId}`)}">＋ Create a test</a></div>
    ${list.length ? `<div class="table-wrap" style="margin-top:12px"><table class="table"><thead><tr><th>Title</th><th>Systems</th><th>Level</th><th>Time</th><th>Due</th><th></th></tr></thead><tbody>
      ${list.map((a) => `<tr><td><strong>${esc(a.title)}</strong></td><td>${a.systems.map((s) => SYSTEMS[s]?.icon || s).join(' ')}</td>
        <td>${LEVELS[a.level]?.short}</td><td>${a.time_limit_sec ? `${Math.round(a.time_limit_sec / 60)} min` : '—'}</td><td>${fmtDate(a.due_at, true)}</td>
        <td><div class="actions-cell"><button class="btn small" data-results="${a.id}" data-title="${esc(a.title)}">Results</button>
        <button class="btn ghost small" data-del="${a.id}">Delete</button></div></td></tr>`).join('')}</tbody></table></div>`
    : '<p class="muted">No tests yet.</p>'}
  </section>`;
  $('#pane').querySelectorAll('[data-results]').forEach((b) => b.onclick = () => showResults(b.dataset.results, b.dataset.title));
  $('#pane').querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    if (!(await confirmDialog('Delete test?', 'This also deletes all student results for it.', 'Delete', true))) return;
    try { await api.deleteAssessment(b.dataset.del); tests(); } catch (e) { errorToast(e); }
  });
}

async function showResults(id, title) {
  try {
    const rows = await api.assessmentResults(id);
    const done = rows.filter((r) => r.attempt_id);
    const avg = done.length ? Math.round(done.reduce((s, r) => s + r.percent, 0) / done.length) : null;
    const body = el('div', { html: `<p class="muted">${done.length} of ${rows.length} finished${avg != null ? ` · class average <strong>${avg}%</strong>` : ''}</p>
      <div class="table-wrap"><table class="table"><thead><tr><th>Student</th><th>Score</th><th>Submitted</th><th></th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(r.display_name)}</td><td>${r.attempt_id ? `<strong>${r.percent}%</strong> (${r.score}/${r.total})` : '<span class="muted">not yet</span>'}</td>
        <td class="muted">${r.submitted_at ? fmtDate(r.submitted_at, true) : ''}</td>
        <td>${r.attempt_id ? `<a class="btn ghost small" href="${rootUrl(`student/take-test.html?review=${r.attempt_id}`)}">Answers</a>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` });
    modal({ title: `Results: ${title}`, body, wide: true, actions: [
      { label: 'Download CSV', class: 'ghost', onClick: () => { downloadCsv(`${title}-results.csv`, rows.map((r) => ({ student: r.display_name, score: r.score, total: r.total, percent: r.percent, submitted: r.submitted_at }))); return false; } },
      { label: 'Close', class: 'secondary' }] });
  } catch (e) { errorToast(e); }
}

// ------------------------------------------------------------------ settings
async function settings() {
  $('#pane').innerHTML = `
  <div class="grid cols-2" style="align-items:start">
    <section class="card">
      <h2>Class details</h2>
      <form id="cls-form">
        <div class="field"><label for="s-name">Name</label><input id="s-name" type="text" value="${esc(cls.name)}" maxlength="80"></div>
        <div class="field"><label for="s-grade">Grade</label><select id="s-grade">${[4, 5, 6, 7].map((g) => `<option ${cls.grade === g ? 'selected' : ''} value="${g}">Grade ${g}</option>`).join('')}</select></div>
        <div class="field"><label for="s-level">Detail level</label><select id="s-level"><option value="">Automatic (from grade)</option>
          ${Object.entries(LEVELS).map(([k, v]) => `<option value="${k}" ${cls.level_override === k ? 'selected' : ''}>${v.name} (${v.short})</option>`).join('')}</select></div>
        <button class="btn">Save</button>
      </form>
    </section>
    <section class="card">
      <h2>Class code</h2>
      <p>Current code: <strong style="letter-spacing:.2em">${esc(cls.join_code)}</strong></p>
      <button class="btn secondary" id="regen">Make a new code</button>
      <p class="help">The old code stops working. Students already in the class stay in it.</p>
      <h2 style="margin-top:24px">Danger zone</h2>
      <button class="btn danger" id="del-class">Delete class</button>
      <p class="help">Removes the class, its assignments and tests. Student accounts and their progress are kept.</p>
    </section>
  </div>`;
  $('#cls-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.updateClass(classId, { name: $('#s-name').value.trim(), grade: Number($('#s-grade').value), level_override: $('#s-level').value || null });
      cls = await api.getClass(classId); toast('Saved', 'success'); shell();
    } catch (err) { errorToast(err); }
  });
  $('#regen').onclick = async () => {
    try { cls.join_code = await api.regenerateCode(classId); toast(`New code: ${cls.join_code}`, 'success'); shell(); } catch (e) { errorToast(e); }
  };
  $('#del-class').onclick = async () => {
    if (!(await confirmDialog('Delete this class?', `Delete ${cls.name}? This can't be undone.`, 'Delete class', true))) return;
    try { await api.deleteClass(classId); location.href = rootUrl('teacher/dashboard.html'); } catch (e) { errorToast(e); }
  };
}

shell();
