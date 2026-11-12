// Log in / sign up page with four tabs.
import { supabase, isConfigured, rootUrl } from '../supabase.js';
import { signInStudent, signInTeacher, signUpTeacher, joinWithClassCode, dashboardFor, getProfile, USERNAME_RE } from '../auth.js';
import { $, $$, param, esc, friendlyError, renderPublicBar } from '../ui.js';

const app = document.getElementById('app');
const next = param('next');

async function goNext() {
  const p = await getProfile(true);
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
  location.replace(safeNext || dashboardFor(p?.role));
}

const isRecovery = location.hash.includes('type=recovery');
if (isConfigured && !isRecovery) {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) { try { await goNext(); } catch { /* stay */ } }
}

renderPublicBar('login');
app.innerHTML = `
<div class="auth-wrap">
  <section class="auth-welcome">
    <div class="auth-logos">
      <img src="${rootUrl('assets/img/sobo-logo.png')}" alt="SOBO logo">
      <img src="${rootUrl('assets/img/sona-star-logo.png')}" alt="Sona Star logo">
    </div>
    <h1>Welcome! 👋</h1>
    <p>Log in to explore the human body in 3D, play games and take tests.</p>
    <ul class="auth-points">
      <li>🧒 <strong>Students</strong> — use the username and password from your teacher</li>
      <li>🏫 <strong>New student?</strong> — join your class with the class code</li>
      <li>👩‍🏫 <strong>Teachers</strong> — log in with your email</li>
    </ul>
    ${isConfigured ? '' : '<div class="error-msg">Supabase is not set up yet: add your project URL and anon key to <code>js/config.js</code>.</div>'}
  </section>
  <div class="card auth-form">
    <div class="tabs" role="tablist">
      <button data-tab="student" class="active">Student</button>
      <button data-tab="join">Join a class</button>
      <button data-tab="teacher">Teacher</button>
      <button data-tab="signup">New teacher</button>
    </div>
    <div id="msg" style="margin-top:14px"></div>

    <form id="f-student" data-pane="student" style="margin-top:16px">
      <div class="field"><label for="s-user">Username</label><input id="s-user" type="text" autocomplete="username" required autocapitalize="none" placeholder="e.g. Aarav K">
        <div class="help">Type it exactly as your teacher gave it to you.</div></div>
      <div class="field"><label for="s-pass">Password</label><input id="s-pass" type="password" autocomplete="current-password" required placeholder="e.g. tiger-42"></div>
      <button class="btn block big">Log in</button>
      <p class="help center">Forgot your password? Ask your teacher to reset it.</p>
    </form>

    <form id="f-join" data-pane="join" class="hidden" style="margin-top:16px">
      <div class="field"><label for="j-code">Class code</label><input id="j-code" type="text" required maxlength="6" placeholder="e.g. K7P2QX" style="text-transform:uppercase;letter-spacing:.2em;font-weight:900"></div>
      <div class="field"><label for="j-name">Your first name</label><input id="j-name" type="text" required maxlength="40" autocomplete="given-name"></div>
      <div class="field"><label for="j-user">Choose a username</label><input id="j-user" type="text" required autocapitalize="none" maxlength="24">
        <div class="help">3–24 letters or numbers, no spaces. Don't use your full name.</div></div>
      <div class="field"><label for="j-pass">Choose a password</label><input id="j-pass" type="password" required minlength="6" autocomplete="new-password"></div>
      <button class="btn block big">Join class</button>
    </form>

    <form id="f-teacher" data-pane="teacher" class="hidden" style="margin-top:16px">
      <div class="field"><label for="t-email">Email</label><input id="t-email" type="email" autocomplete="email" required></div>
      <div class="field"><label for="t-pass">Password</label><input id="t-pass" type="password" autocomplete="current-password" required></div>
      <button class="btn block big">Log in</button>
      <p class="center"><button type="button" class="btn ghost small" id="forgot">Forgot password?</button></p>
    </form>

    <form id="f-signup" data-pane="signup" class="hidden" style="margin-top:16px">
      <div class="field"><label for="u-name">Your name (shown to students)</label><input id="u-name" type="text" required maxlength="60" placeholder="e.g. Ms Rao"></div>
      <div class="field"><label for="u-email">School email</label><input id="u-email" type="email" required autocomplete="email"></div>
      <div class="field"><label for="u-pass">Password</label><input id="u-pass" type="password" required minlength="8" autocomplete="new-password"></div>
      <button class="btn block big">Create teacher account</button>
    </form>
  </div>
</div>`;

const msg = (text, ok = false) => { $('#msg').innerHTML = text ? `<div class="${ok ? 'success-msg' : 'error-msg'}">${esc(text)}</div>` : ''; };

function showTab(tab) {
  $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('[data-pane]').forEach((f) => f.classList.toggle('hidden', f.dataset.pane !== tab));
  msg('');
}
$$('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
if (param('tab')) showTab(param('tab') === 'teacher' ? 'teacher' : param('tab'));
if (param('code')) { showTab('join'); $('#j-code').value = param('code'); }

async function busy(form, fn) {
  const btn = form.querySelector('button:not([type=button])');
  btn.disabled = true;
  msg('');
  try { await fn(); } catch (e) { msg(friendlyError(e)); } finally { btn.disabled = false; }
}

$('#f-student').addEventListener('submit', (e) => {
  e.preventDefault();
  busy(e.target, async () => { await signInStudent($('#s-user').value, $('#s-pass').value); await goNext(); });
});

$('#f-join').addEventListener('submit', (e) => {
  e.preventDefault();
  const username = $('#j-user').value.trim().toLowerCase();
  if (!USERNAME_RE.test(username)) { msg('Usernames need 3–24 letters, numbers, dots, dashes or underscores (no spaces).'); return; }
  busy(e.target, async () => {
    await joinWithClassCode({ classCode: $('#j-code').value, username, displayName: $('#j-name').value, password: $('#j-pass').value });
    await goNext();
  });
});

$('#f-teacher').addEventListener('submit', (e) => {
  e.preventDefault();
  busy(e.target, async () => { await signInTeacher($('#t-email').value, $('#t-pass').value); await goNext(); });
});

$('#f-signup').addEventListener('submit', (e) => {
  e.preventDefault();
  busy(e.target, async () => {
    const { needsConfirmation } = await signUpTeacher($('#u-name').value, $('#u-email').value, $('#u-pass').value);
    if (needsConfirmation) msg('Check your email to confirm your account, then log in.', true);
    else await goNext();
  });
});

$('#forgot').addEventListener('click', async () => {
  const email = $('#t-email').value.trim();
  if (!email) { msg('Type your email first, then click "Forgot password?".'); return; }
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: rootUrl('login.html?tab=teacher') });
  msg(error ? friendlyError(error) : 'If that email has an account, a reset link is on its way.', !error);
});

// Teacher clicked the password-reset link in their email: let them choose a new password.
if (isRecovery) {
  showTab('teacher');
  const oldForm = $('#f-teacher');
  const form = oldForm.cloneNode(false);   // fresh form without the login listener
  oldForm.replaceWith(form);
  form.innerHTML = `<div class="field"><label for="n-pass">Choose a new password</label>
    <input id="n-pass" type="password" minlength="8" required autocomplete="new-password"></div>
    <button class="btn block big">Save new password</button>`;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(e.target, async () => {
      const { error } = await supabase.auth.updateUser({ password: $('#n-pass').value });
      if (error) throw error;
      history.replaceState(null, '', location.pathname);
      await goNext();
    });
  });
}
