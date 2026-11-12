// Guide helper: a "🧭 Guide" button in the top bar opens a side panel that explains the current page, what each part
// is for and how to use it ("Show me" highlights that part), plus a map of every page.
import { rootUrl } from './supabase.js';

const SEEN_KEY = 'bq-guide-seen';

// ------------------------------------------------------------------ what each page is for
const PAGES = {
  home: {
    icon: '🏠', title: 'Home page', what: 'The front door of SOBO. It shows what you can do here and where to log in.',
    steps: [
      { icon: '🧒', title: 'Students', text: 'Click “I\'m a student” and log in with the username and password your teacher gave you.', sel: '.home-hero .hero-btn' },
      { icon: '👩‍🏫', title: 'Teachers', text: 'Click “I\'m a teacher” to log in with your email, or make a new teacher account.', sel: '.home-hero .hero-btn-ghost' },
      { icon: '🧭', title: 'Top menu', text: 'Home, About (what SOBO is) and Credits (models, licences and privacy).', sel: '.public-bar .nav' },
    ],
  },
  about: {
    icon: 'ℹ️', title: 'About', what: 'The story of SOBO, an initiative of Sona Star Innovation: how it began, its mission, what makes it different, and the people behind it.',
    steps: [{ icon: '📖', title: 'Read top to bottom', text: 'Four numbered sections: 01 Our Story, 02 Our Mission, 03 Why SOBO?, 04 Our Vision & Acknowledgements. “Get started” at the end takes you to log in.' }],
  },
  credits: {
    icon: '📜', title: 'Credits & privacy', what: 'Who made the 3D models and software, and how student data is kept safe.',
    steps: [{ icon: '🔒', title: 'Privacy', text: 'Students need no email. Only their own teachers can see their progress.' }],
  },
  login: {
    icon: '🔑', title: 'Log in', what: 'Log in or create an account. Pick the tab that matches you.',
    steps: [
      { icon: '🧒', title: 'Student', text: 'Type your username exactly as your teacher gave it (e.g. “Aarav K”) and your password (e.g. tiger-42).', sel: '#f-student' },
      { icon: '🏫', title: 'Join a class', text: 'New student with a class code? Use this tab to make your own account.', sel: '[data-tab="join"]' },
      { icon: '👩‍🏫', title: 'Teacher / New teacher', text: 'Teachers log in with email. New teachers can create an account.', sel: '[data-tab="teacher"]' },
    ],
  },
  profile: {
    icon: '👤', title: 'My profile', what: 'Your name, your progress, your classes and badges — and the Log out button.',
    steps: [
      { icon: '✏️', title: 'Change your name', text: 'Click “Edit” next to your name to change how it is shown.', sel: '#edit-name' },
      { icon: '⚙️', title: 'Settings', text: 'Bigger text, high contrast, less motion and low graphics for slow computers.', sel: '#settings-open' },
      { icon: '🚪', title: 'Log out', text: 'Logs you out (it asks first, so you don\'t do it by accident).', sel: '#logout-btn' },
    ],
  },
  'student-home': {
    icon: '🏠', title: 'Your home', what: 'Your starting point: progress, things to do, what to review, and your recent games and tests.',
    steps: [
      { icon: '▶', title: 'Quick start', text: 'Continue learning where you stopped, play a game or take a test.', sel: '.hero' },
      { icon: '🧭', title: 'My body systems', text: 'Each ring shows how much of a system you have learned. Click one to learn it.', sel: '.sys-grid' },
      { icon: '📌', title: 'To do', text: 'Work your teacher has set for you. Click a row to start it.', sel: '.mini-list' },
      { icon: '⭐', title: 'XP, streak and badges', text: 'You earn XP for learning, playing and tests. Come back every day to grow your 🔥 streak.' },
    ],
  },
  learn: {
    icon: '🔬', title: 'Learn mode', what: 'Explore each body system in 3D and find out what every part does.',
    steps: [
      { icon: '🧬', title: 'Pick a system', text: 'Choose a body system from the buttons at the top.', sel: '#system-chips' },
      { icon: '🖱', title: 'Spin and zoom', text: 'Drag to spin the model, scroll (or pinch) to zoom. Click any organ to select it.', sel: '#viewer' },
      { icon: '📋', title: 'Organ list', text: 'Or pick an organ by name here. A ✓ means you have learned it.', sel: '.side-list' },
      { icon: 'ℹ️', title: 'Organ facts', text: 'Where it is, what it does and a fun fact. 🔊 reads it aloud. “I\'ve learned this” gives XP.', sel: '#info' },
      { icon: '🏷', title: 'Tools', text: 'Labels, skeleton outline, sound on/off and the x-ray slider.', sel: '.viewer-overlay' },
      { icon: '🧭', title: 'Guided tour', text: 'Visits every organ in order and ends with a quick 3-question check.', sel: '#tour-btn' },
    ],
  },
  games: {
    icon: '🎮', title: 'Games', what: 'Two games that train what you learned. Pick a game and a body system.',
    steps: [
      { icon: '🎯', title: 'Organ Blaster', text: 'Shoot the organ that is named or described before the clock runs out. Trains: finding organs.', sel: '#blaster' },
      { icon: '🧩', title: 'System Builder', text: 'Put a body system back together and switch it on. Trains: how systems work.', sel: '#builder' },
    ],
  },
  blaster: {
    icon: '🎯', title: 'Organ Blaster', what: 'An organ is named (or its job is described). Shoot the right one before time runs out.',
    steps: [
      { icon: '⚙️', title: 'Choose and start', text: 'Pick Easy, Normal or Hard, then press Start. The leaderboard shows your class\'s best scores.', sel: '#overlay' },
      { icon: '🖱', title: 'Aim and fire', text: 'Move the mouse to aim and click to fire (or arrow keys + Space). On a tablet, tap the organ.' },
      { icon: '⏱', title: 'Clock and shields', text: 'Each right hit adds time. A wrong hit breaks a shield 🛡. Finish a wave to get one back.', sel: '#clock-card' },
      { icon: '🔊', title: 'Buttons', text: 'Sound on/off (M), pause (P) and full screen (F).', sel: '#pause-btn' },
    ],
  },
  builder: {
    icon: '🧩', title: 'System Builder', what: 'Put every organ back in its place, then switch the system on to see it work.',
    steps: [
      { icon: '🧰', title: 'Organ box', text: 'Tap an organ — you\'ll hear its name — then tap its glowing spot. Or drag it onto the body.', sel: '#tray-panel' },
      { icon: '⚡', title: 'Switch on', text: 'Food, air, blood or urine flows through. If it gets blocked, a hint shows which organ is wrong.', sel: '#switch-btn' },
      { icon: '🔍', title: 'Zoom, sound and full screen', text: 'Zoom in for small organs. 🔊 turns names and sounds on or off.', sel: '.zoom-ctrl' },
      { icon: '⭐', title: 'Stars', text: 'Get it right on the first try for 3 stars.' },
    ],
  },
  tests: {
    icon: '📝', title: 'Tests', what: 'Tests from your teacher and practice tests. Every question is answered on the 3D model.',
    steps: [
      { icon: '👩‍🏫', title: 'From your teacher', text: 'Tests your teacher set. Start, continue or review them here.' },
      { icon: '🎯', title: 'Practice test', text: 'Pick body systems and how many questions, then start. Practice doesn\'t count — it helps you learn.', sel: '#practice' },
      { icon: '📈', title: 'My results', text: 'Every finished test. Click one to see the right answers.' },
    ],
  },
  'take-test': {
    icon: '📝', title: 'Taking a test', what: 'Answer each question on the 3D model, then press Finish.',
    steps: [
      { icon: '👆', title: 'Click the organ', text: 'Spin the model and click the part the question asks for.', sel: '#q-body' },
      { icon: '🏷️', title: 'Label the model', text: 'Pick the right name for each numbered marker.' },
      { icon: '🔢', title: 'Move around', text: 'The dots show answered questions — click one to jump to it. Back / Next to move.', sel: '#q-dots' },
      { icon: '🏁', title: 'Finish', text: 'On the last question “Finish” marks your test straight away.', sel: '#next-btn' },
    ],
  },
  'teacher-home': {
    icon: '🏫', title: 'My classes', what: 'All your classes. Make a new class or open one to see its students.',
    steps: [
      { icon: '➕', title: 'New class', text: 'Give it a name and grade. SOBO makes a class code students can join with.', sel: '#new-class' },
      { icon: '📂', title: 'Open a class', text: 'Click a class to see students, insights, assignments, tests and settings.' },
      { icon: '📝', title: 'New test', text: 'Make a 3D test from the top menu.' },
    ],
  },
  'teacher-class': {
    icon: '👩‍🎓', title: 'Class page', what: 'Everything about one class, in tabs.',
    steps: [
      { icon: '🗂', title: 'Tabs', text: 'Students, Insights (weak spots), Assignments, Tests and Settings.', sel: '#tabs' },
      { icon: '➕', title: 'Add students', text: 'Type one name per line. The name becomes the username exactly; each gets a short password like tiger-42. SOBO warns you if a name already exists.', sel: '#add-students' },
      { icon: '🔑', title: 'See a login', text: 'Click a student\'s name to see their username and password, copy it, print a card or make a new password.', sel: '[data-login]' },
      { icon: '🔗', title: 'Class code', text: 'Students can also join by themselves with this code.', sel: '#copy-link' },
    ],
  },
  'teacher-student': {
    icon: '📊', title: 'Student report', what: 'One student\'s progress: what they learned, games, tests and which organs they find hard.',
    steps: [{ icon: '🔁', title: 'Weak spots', text: 'Organs with low mastery are the ones to review with this student.' }],
  },
  'test-builder': {
    icon: '🛠', title: 'Create a 3D test', what: 'Make a test for a class. Every question is answered on the 3D model.',
    steps: [
      { icon: '🏫', title: 'Class and systems', text: 'Pick the class, give the test a title and choose body systems.', sel: '#form' },
      { icon: '🎲', title: 'Random or choose', text: 'Let SOBO pick a random mix, or tick the exact questions yourself.', sel: '#mode' },
      { icon: '✍️', title: 'Make your own', text: 'Opens the 3D model: click the right organ, or click 2–5 organs to make a labelling question.', sel: '#add-q' },
    ],
  },
};

function pageKey() {
  const p = location.pathname.toLowerCase();
  const map = [
    ['student/dashboard', 'student-home'], ['student/learn', 'learn'], ['student/games', 'games'], ['organ-blaster', 'blaster'],
    ['system-builder', 'builder'], ['student/assessments', 'tests'], ['take-test', 'take-test'], ['teacher/dashboard', 'teacher-home'],
    ['teacher/class', 'teacher-class'], ['teacher/student', 'teacher-student'], ['assessment-builder', 'test-builder'],
    ['about', 'about'], ['credits', 'credits'], ['login', 'login'], ['profile', 'profile'],
  ];
  for (const [frag, key] of map) if (p.includes(frag)) return key;
  return 'home';
}

const SITE_MAP = {
  public: [['index.html', 'home'], ['about.html', 'about'], ['credits.html', 'credits'], ['login.html', 'login']],
  student: [['student/dashboard.html', 'student-home'], ['student/learn.html', 'learn'], ['student/games.html', 'games'],
    ['student/assessments.html', 'tests'], ['profile.html', 'profile'], ['about.html', 'about']],
  teacher: [['teacher/dashboard.html', 'teacher-home'], ['student/learn.html', 'learn'], ['teacher/assessment-builder.html', 'test-builder'],
    ['profile.html', 'profile'], ['about.html', 'about']],
};

const escHtml = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ------------------------------------------------------------------ panel
let panel = null, role = 'public';

function highlight(sel) {
  const target = [...document.querySelectorAll(sel)].find((e) => e.offsetParent !== null || e.getClientRects().length);
  if (!target) return false;
  close();
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => {
    const r = target.getBoundingClientRect();
    const ring = document.createElement('div');
    ring.className = 'guide-spot';
    Object.assign(ring.style, { left: `${r.left - 8}px`, top: `${r.top - 8}px`, width: `${r.width + 16}px`, height: `${r.height + 16}px` });
    document.body.append(ring);
    const done = () => { ring.remove(); removeEventListener('scroll', done, true); };
    addEventListener('scroll', done, true);
    setTimeout(done, 2600);
  }, 420);
  return true;
}

function render(view = 'page') {
  const g = PAGES[pageKey()];
  const list = SITE_MAP[role] || SITE_MAP.public;
  panel.querySelector('.guide-body').innerHTML = view === 'page' ? `
    <div class="guide-page-head"><span class="guide-page-icon">${g.icon}</span><div><div class="guide-kicker">You are on</div><h3>${escHtml(g.title)}</h3></div></div>
    <p class="guide-what">${escHtml(g.what)}</p>
    <ol class="guide-steps">${g.steps.map((st, i) => `<li>
      <span class="gs-icon">${st.icon}</span>
      <div><strong>${escHtml(st.title)}</strong><p>${escHtml(st.text)}</p>
        ${st.sel && document.querySelector(st.sel) ? `<button type="button" class="btn ghost small" data-show="${i}">👀 Show me</button>` : ''}</div></li>`).join('')}</ol>`
    : `<p class="guide-what">Every page you can visit${role === 'public' ? ' (log in to see the rest)' : ''}:</p>
    <div class="guide-map">${list.map(([href, key]) => {
      const pg = PAGES[key];
      return `<a class="guide-map-row ${key === pageKey() ? 'here' : ''}" href="${rootUrl(href)}"><span>${pg.icon}</span>
        <div><strong>${escHtml(pg.title)}</strong><small>${escHtml(pg.what)}</small></div></a>`;
    }).join('')}</div>`;
  panel.querySelectorAll('.guide-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  panel.querySelectorAll('[data-show]').forEach((b) => b.onclick = () => highlight(g.steps[Number(b.dataset.show)].sel));
}

function open() {
  if (!panel) {
    panel = document.createElement('aside');
    panel.className = 'guide-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Guide');
    panel.innerHTML = `
      <div class="guide-head"><strong>🧭 Guide</strong><button type="button" class="icon-btn guide-close" aria-label="Close guide">✕</button></div>
      <div class="guide-tabs"><button type="button" data-view="page" class="active">📍 This page</button><button type="button" data-view="map">🗺️ All pages</button></div>
      <div class="guide-body"></div>
      <div class="guide-foot">Tip: press <kbd>?</kbd> any time to open this guide.</div>`;
    document.body.append(panel);
    panel.querySelector('.guide-close').onclick = close;
    panel.querySelectorAll('.guide-tabs button').forEach((b) => b.onclick = () => render(b.dataset.view));
  }
  render('page');
  panel.classList.add('open');
  document.querySelector('.guide-btn')?.classList.remove('guide-new');
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
  panel.querySelector('.guide-close').focus();
}
function close() { panel?.classList.remove('open'); }
const toggle = () => (panel?.classList.contains('open') ? close() : open());

/** Add the Guide button to the top bar. `who` = 'student' | 'teacher' | 'public'. */
export function mountGuide(container, who = 'public') {
  role = who;
  if (!container || container.querySelector('.guide-btn')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn ghost small guide-btn';
  btn.title = 'How to use this page (?)';
  btn.setAttribute('aria-label', 'Open the guide');
  btn.innerHTML = '🧭 <span>Guide</span>';
  let seen = false;
  try { seen = localStorage.getItem(SEEN_KEY) === '1'; } catch { /* ignore */ }
  if (!seen) btn.classList.add('guide-new');
  btn.onclick = toggle;
  container.append(btn);
  if (!document.body.dataset.guideKeys) {
    document.body.dataset.guideKeys = '1';
    document.addEventListener('keydown', (e) => {
      if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
      if (e.key === '?') { e.preventDefault(); toggle(); }
      if (e.key === 'Escape' && panel?.classList.contains('open')) close();
    });
  }
}
