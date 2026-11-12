// My profile: name, account details, stats — and the log out button (with a confirmation pop-up).
import { requireRole, logout } from '../auth.js';
import * as api from '../api.js';
import { $, esc, levelLabel, fmtDate, toast, errorToast, confirmDialog, openSettings } from '../ui.js';

let profile = await requireRole(['student', 'teacher']);
const isStudent = profile.role === 'student';
const app = document.getElementById('app');

const [level, classes, badges, myBadges] = isStudent
  ? await Promise.all([api.getMyLevel(), api.getMyClasses(), api.getBadges(), api.getStudentBadges()]).catch((e) => { errorToast(e); return ['simple', [], [], []]; })
  : [null, [], [], []];

function render() {
  const initial = (profile.display_name || '?').trim().charAt(0).toUpperCase();
  const earned = new Set(myBadges.map((b) => b.badge_code));
  app.innerHTML = `
  <div class="profile-page">
    <section class="card profile-head">
      <div class="profile-avatar">${esc(initial)}</div>
      <div class="profile-id">
        <h1 id="pf-name">${esc(profile.display_name)}</h1>
        <div class="muted">${isStudent ? `@${esc(profile.username || '')} · ${esc(levelLabel(level))}` : 'Teacher account'}</div>
        <div class="small muted">Member since ${fmtDate(profile.created_at)}</div>
      </div>
      <button class="btn ghost small" id="edit-name">✏️ Edit name</button>
    </section>

    <form class="card hidden" id="name-form">
      <label for="name-input">Display name</label>
      <div class="row"><input id="name-input" type="text" maxlength="40" value="${esc(profile.display_name)}" style="flex:1;min-width:200px" required>
        <button class="btn">Save</button><button class="btn ghost" type="button" id="name-cancel">Cancel</button></div>
    </form>

    ${isStudent ? `
    <div class="grid cols-3">
      <div class="card stat"><div class="value">⭐ ${profile.xp}</div><div class="label">XP</div></div>
      <div class="card stat"><div class="value">🔥 ${profile.streak}</div><div class="label">day streak</div></div>
      <div class="card stat"><div class="value">🏆 ${profile.best_streak ?? 0}</div><div class="label">best streak</div></div>
    </div>
    <section class="card">
      <h2>🏫 My classes</h2>
      ${classes.length ? `<div class="chips">${classes.map((c) => `<span class="chip">${esc(c.name)} · ${esc(c.teacher_name)}</span>`).join('')}</div>` : '<p class="muted">You are not in a class yet.</p>'}
    </section>
    <section class="card">
      <h2>🏅 Badges <span class="pill">${earned.size} / ${badges.length}</span></h2>
      <div class="badge-grid">${badges.map((b) => `<div class="badge-item ${earned.has(b.code) ? '' : 'locked'}" title="${esc(b.description)}">
        <div class="b-icon">${b.icon}</div><div class="b-name">${esc(b.name)}</div></div>`).join('')}</div>
    </section>` : ''}

    <section class="card">
      <h2>⚙️ Account</h2>
      <div class="row between profile-row"><div><strong>Settings</strong><div class="small muted">Text size, contrast, motion and graphics</div></div>
        <button class="btn secondary" id="settings-open">Open settings</button></div>
      <div class="row between profile-row"><div><strong>Log out</strong><div class="small muted">Sign out of SOBO on this device</div></div>
        <button class="btn danger" id="logout-btn">🚪 Log out</button></div>
    </section>
  </div>`;

  $('#settings-open').onclick = openSettings;
  $('#logout-btn').onclick = async () => {
    if (await confirmDialog('Log out?', 'Are you sure you want to log out of SOBO?', 'Log out', true)) {
      toast('Logging you out…');
      await logout();
    }
  };
  const form = $('#name-form');
  $('#edit-name').onclick = () => { form.classList.remove('hidden'); $('#name-input').focus(); };
  $('#name-cancel').onclick = () => form.classList.add('hidden');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const name = $('#name-input').value.trim();
    if (!name) return;
    try {
      await api.updateDisplayName(name);
      profile = { ...profile, display_name: name };
      document.querySelectorAll('.user-chip .name').forEach((n) => { n.textContent = name; });
      document.querySelectorAll('.user-chip .avatar').forEach((n) => { n.textContent = name.charAt(0).toUpperCase(); });
      toast('Name updated', 'success');
      render();
    } catch (err) { errorToast(err); }
  };
}
render();
