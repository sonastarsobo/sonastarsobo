// Teacher home: classes, create a class, quick links.
import { requireRole } from '../auth.js';
import * as api from '../api.js';
import { rootUrl } from '../supabase.js';
import { $, el, esc, modal, toast, errorToast, LEVELS, levelLabel } from '../ui.js';

const profile = await requireRole(['teacher']);
const app = document.getElementById('app');

async function render() {
  const classes = await api.getTeacherClasses().catch((e) => { errorToast(e); return []; });
  const totalStudents = classes.reduce((n, c) => n + (c.class_members?.[0]?.count || 0), 0);
  app.innerHTML = `
  <div class="row between">
    <div><h1>Welcome, ${esc(profile.display_name)}</h1><p class="muted">${classes.length} class${classes.length === 1 ? '' : 'es'} · ${totalStudents} students</p></div>
    <div class="row">
      <a class="btn ghost" href="${rootUrl('student/learn.html')}">🔍 Open Learn mode</a>
      <button class="btn" id="new-class">＋ New class</button>
    </div>
  </div>
  ${classes.length ? `<div class="grid cols-3">${classes.map((c) => `
    <a class="card tile" href="${rootUrl(`teacher/class.html?id=${c.id}`)}">
      <div class="row between"><h2 style="margin:0">${esc(c.name)}</h2><span class="pill primary">Grade ${c.grade}</span></div>
      <p class="muted small" style="margin:6px 0 12px">${esc(levelLabel(c.level_override || (c.grade <= 4 ? 'simple' : c.grade <= 6 ? 'medium' : 'full')))}</p>
      <div class="row between"><span><strong>${c.class_members?.[0]?.count || 0}</strong> students</span>
        <span class="small">Code: <strong style="letter-spacing:.15em">${esc(c.join_code)}</strong></span></div>
    </a>`).join('')}</div>`
    : `<div class="card center" style="padding:40px"><div style="font-size:3em">🏫</div><h2>Create your first class</h2>
       <p class="muted">You'll get a class code. Students use it to join — or you can create their accounts for them.</p>
       <button class="btn big" id="new-class-2">＋ New class</button></div>`}
  <section class="card" style="margin-top:20px">
    <h2>How it works</h2>
    <ol class="muted">
      <li>Create a class and share the <strong>class code</strong> (students choose "Join a class" on the login page), or use <strong>Add students</strong> to make accounts and print login cards.</li>
      <li>Students explore Learn mode, play games and take tests. Everything they do is saved.</li>
      <li>Open a class to see progress, the <strong>weak-spot heatmap</strong>, set assignments and create tests.</li>
    </ol>
  </section>`;
  $('#new-class')?.addEventListener('click', newClass);
  $('#new-class-2')?.addEventListener('click', newClass);
}

async function newClass() {
  const body = el('div', { html: `
    <div class="field"><label for="c-name">Class name</label><input id="c-name" type="text" placeholder="e.g. Grade 5 B" maxlength="80"></div>
    <div class="field"><label for="c-grade">Grade</label><select id="c-grade">${[4, 5, 6, 7].map((g) => `<option value="${g}" ${g === 5 ? 'selected' : ''}>Grade ${g}</option>`).join('')}</select></div>
    <div class="field"><label for="c-level">Detail level</label><select id="c-level"><option value="">Automatic (from grade)</option>
      ${Object.entries(LEVELS).map(([k, v]) => `<option value="${k}">${v.name} (${v.short})</option>`).join('')}</select>
      <div class="help">Automatic: grade 4 → Explorer, grades 5–6 → Investigator, grade 7 → Expert.</div></div>` });
  await modal({ title: 'New class', body, actions: [{ label: 'Cancel', class: 'ghost' }, { label: 'Create class', onClick: async () => {
    const name = $('#c-name', body).value.trim();
    if (!name) { toast('Give the class a name'); return false; }
    try {
      const c = await api.createClass(name, Number($('#c-grade', body).value), $('#c-level', body).value || null);
      toast(`Class created! Code: ${c.join_code}`, 'success');
      location.href = rootUrl(`teacher/class.html?id=${c.id}`);
    } catch (e) { errorToast(e); return false; }
  } }] });
}

render();
