// Shared UI helpers: top bar, toasts, modals, formatting, accessibility settings.
import { rootUrl } from './supabase.js';
import { isMuted, setMuted, onMuteChange, unlockAudio } from './games/sfx.js';
import { mountGuide } from './guide.js';

/** Escape text for safe use inside HTML strings. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Tiny element builder: el('div', { class: 'card', onclick: fn }, 'text', childNode) */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'class') node.className = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const param = (name) => new URLSearchParams(location.search).get(name);

export const LEVELS = {
  simple: { name: 'Explorer', grades: 'Grade 4', short: 'Simple' },
  medium: { name: 'Investigator', grades: 'Grades 5–6', short: 'Medium' },
  full: { name: 'Expert', grades: 'Grade 7', short: 'Full' },
};

export function levelLabel(level) {
  const l = LEVELS[level] || LEVELS.simple;
  return `${l.name} · ${l.grades}`;
}

export function fmtDate(d, withTime = false) {
  if (!d) return '—';
  const date = new Date(d);
  return withTime
    ? date.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function timeAgo(d) {
  if (!d) return 'never';
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const days = Math.floor(s / 86400);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** SVG progress ring */
export function ring(percent, color = 'var(--primary)', size = 90, label = null) {
  const r = (size - 12) / 2, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, percent || 0));
  return `<div class="ring" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="10"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p / 100)}"/></svg>
    <div class="ring-label">${label ?? Math.round(p) + '%'}</div></div>`;
}

export function masteryClass(m) {
  if (m == null) return 'mastery-0';
  if (m < 25) return 'mastery-1';
  if (m < 50) return 'mastery-2';
  if (m < 75) return 'mastery-3';
  return 'mastery-4';
}

// ---------------------------------------------------------------- toasts & modals
export function toast(message, type = '') {
  let box = document.getElementById('toasts');
  if (!box) { box = el('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.append(box); }
  const t = el('div', { class: `toast ${type}` }, message);
  box.append(t);
  setTimeout(() => t.remove(), 4200);
}

export function errorToast(err) {
  console.error(err);
  toast(friendlyError(err), 'error');
}

export function friendlyError(err) {
  const msg = err?.message || String(err);
  if (/Invalid login credentials/i.test(msg)) return 'Wrong username/email or password.';
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Could not reach the server. Check your internet connection.';
  if (/JWT|not signed in/i.test(msg)) return 'Your session has ended. Please log in again.';
  return msg.replace(/^.*?ERROR:\s*/, '');
}

/**
 * Open a modal. `body` may be an HTML string or a Node.
 * actions: [{ label, class, value, onClick(modalEl) -> false to keep open }]
 * Resolves with the clicked action's value (or null when closed).
 */
export function modal({ title, body, actions = [{ label: 'Close', class: 'ghost', value: null }], wide = false }) {
  return new Promise((resolve) => {
    const content = typeof body === 'string' ? el('div', { html: body }) : body;
    const box = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', style: wide ? 'max-width:860px' : null },
      el('h2', {}, title), content);
    const bar = el('div', { class: 'actions' });
    const close = (v) => { backdrop.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    for (const a of actions) {
      bar.append(el('button', {
        class: `btn ${a.class || ''}`, type: 'button',
        onclick: async () => {
          if (a.onClick) {
            const keep = await a.onClick(box);
            if (keep === false) return;
          }
          close(a.value ?? a.label);
        },
      }, a.label));
    }
    box.append(bar);
    const backdrop = el('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === backdrop) close(null); } }, box);
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    document.body.append(backdrop);
    box.querySelector('input,select,textarea,button')?.focus();
  });
}

export async function confirmDialog(title, text, okLabel = 'Yes', danger = false) {
  const v = await modal({ title, body: `<p>${esc(text)}</p>`,
    actions: [{ label: 'Cancel', class: 'ghost', value: false }, { label: okLabel, class: danger ? 'danger' : '', value: true }] });
  return v === true;
}

export function celebrate(text) {
  if (document.documentElement.classList.contains('reduce-motion')) { toast(text, 'success'); return; }
  const fx = el('div', { class: 'level-up' }, el('div', {}, text));
  document.body.append(fx);
  setTimeout(() => fx.remove(), 1900);
}

// ---------------------------------------------------------------- accessibility settings (stored per device)
const SETTINGS_KEY = 'bq-settings';
export function getSettings() {
  try { return { textSize: 'normal', reduceMotion: false, highContrast: false, lowGraphics: false, readAloud: true,
    ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return {}; }
}
export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* private mode */ }
  applySettings();
}
export function applySettings() {
  const s = getSettings(), h = document.documentElement;
  h.classList.toggle('text-lg', s.textSize === 'large');
  h.classList.toggle('text-xl', s.textSize === 'xlarge');
  h.classList.toggle('reduce-motion', !!s.reduceMotion || matchMedia('(prefers-reduced-motion: reduce)').matches);
  h.classList.toggle('high-contrast', !!s.highContrast);
}
applySettings();

export async function openSettings() {
  const s = getSettings();
  const body = el('div', {},
    el('div', { class: 'field' }, el('label', { for: 'set-text' }, 'Text size'),
      el('select', { id: 'set-text' },
        ...['normal', 'large', 'xlarge'].map((v) => el('option', { value: v, selected: s.textSize === v }, { normal: 'Normal', large: 'Large', xlarge: 'Extra large' }[v])))),
    el('label', { class: 'checkbox' }, el('input', { type: 'checkbox', id: 'set-motion', checked: s.reduceMotion }), 'Reduce motion and animations'),
    el('label', { class: 'checkbox' }, el('input', { type: 'checkbox', id: 'set-contrast', checked: s.highContrast }), 'High contrast'),
    el('label', { class: 'checkbox' }, el('input', { type: 'checkbox', id: 'set-low', checked: s.lowGraphics }), 'Low graphics (faster on old computers)'),
    el('label', { class: 'checkbox' }, el('input', { type: 'checkbox', id: 'set-read', checked: s.readAloud }), 'Show read-aloud buttons'));
  const ok = await modal({ title: 'Settings', body, actions: [{ label: 'Cancel', class: 'ghost', value: false }, { label: 'Save', value: true }] });
  if (ok === true) {
    saveSettings({ textSize: $('#set-text', body).value, reduceMotion: $('#set-motion', body).checked,
      highContrast: $('#set-contrast', body).checked, lowGraphics: $('#set-low', body).checked, readAloud: $('#set-read', body).checked });
    toast('Settings saved', 'success');
  }
}

// ---------------------------------------------------------------- read aloud
/**
 * Say `text` out loud. Does nothing while sound is muted (one switch for the whole app).
 * Options: rate, quiet (no "not supported" toast), onend. Returns true if it started speaking.
 */
export function speak(text, { rate = 0.95, quiet = false, onend } = {}) {
  if (!('speechSynthesis' in window)) { if (!quiet) toast('Read-aloud is not supported in this browser'); return false; }
  speechSynthesis.cancel();
  if (isMuted()) return false;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = rate;
  if (onend) { u.onend = onend; u.onerror = onend; }
  speechSynthesis.speak(u);
  return true;
}
export function stopSpeaking() { try { window.speechSynthesis?.cancel(); } catch { /* ignore */ } }
export const isSpeaking = () => !!window.speechSynthesis?.speaking;

/** Wire a button as the app-wide sound on/off switch (also stops any read-aloud when muted). */
export function muteToggle(button, { withText = false } = {}) {
  const sync = () => {
    const m = isMuted();
    button.innerHTML = (m ? ICONS.mute : ICONS.sound) + (withText ? `<span>${m ? 'Sound off' : 'Sound on'}</span>` : '');
    button.title = m ? 'Sound is off — click to turn it on (M)' : 'Sound is on — click to mute (M)';
    button.setAttribute('aria-label', m ? 'Turn sound on' : 'Mute sound');
    button.setAttribute('aria-pressed', String(m));
    button.classList.toggle('is-muted', m);
  };
  button.addEventListener('click', () => { unlockAudio(); setMuted(!isMuted()); });
  onMuteChange(sync);
  sync();
  return sync;
}
export { isMuted, setMuted, onMuteChange };

// ---------------------------------------------------------------- top bar
const NAV = {
  student: [['student/dashboard.html', 'Home'], ['student/learn.html', 'Learn'], ['student/games.html', 'Games'], ['student/assessments.html', 'Tests'], ['about.html', 'About']],
  teacher: [['teacher/dashboard.html', 'My classes'], ['student/learn.html', 'Learn mode'], ['teacher/assessment-builder.html', 'New test'], ['about.html', 'About']],
};

export function renderTopbar(profile) {
  const role = profile?.role === 'teacher' || profile?.role === 'admin' ? 'teacher' : 'student';
  const links = NAV[role].map(([href, label]) => {
    const url = rootUrl(href);
    const active = location.pathname.endsWith(href) ? 'active' : '';
    return `<a class="${active}" href="${url}">${label}</a>`;
  }).join('');
  const initial = (profile?.display_name || '?').trim().charAt(0).toUpperCase();
  const header = el('header', { class: 'topbar' }, el('div', { class: 'topbar-inner', html: `
    <a class="brand" href="${rootUrl(role === 'teacher' ? 'teacher/dashboard.html' : 'student/dashboard.html')}"><img class="brand-logo" src="${rootUrl('assets/img/sobo-logo.png')}" alt="">SOBO</a>
    <button class="icon-btn menu-btn" aria-label="Menu" id="menu-btn">☰</button>
    <nav class="nav" id="main-nav">${links}</nav>
    <div class="spacer"></div>
    ${role === 'student' ? `<span class="xp-chip" id="xp-chip" title="Experience points">⭐ ${profile?.xp ?? 0} XP</span>` : ''}
    <span class="guide-slot" id="guide-slot"></span>
    <button class="icon-btn" id="settings-btn" title="Settings" aria-label="Settings">⚙️</button>
    <a class="user-chip ${location.pathname.endsWith('profile.html') ? 'active' : ''}" href="${rootUrl('profile.html')}" title="My profile">
      <span class="avatar">${esc(initial)}</span><span class="name">${esc(profile?.display_name || '')}</span></a>` }));
  document.body.prepend(header);
  $('#menu-btn').onclick = () => $('#main-nav').classList.toggle('open');
  $('#settings-btn').onclick = openSettings;
  mountGuide($('#guide-slot'), role);
  if (!document.querySelector('.footer')) {
    document.body.append(el('footer', { class: 'footer', html:
      `SOBO · <a href="${rootUrl('credits.html')}">Credits &amp; privacy</a> · 3D models adapted from Z-Anatomy (CC BY-SA 4.0)` }));
  }
}

/**
 * Top bar for pages visitors see before logging in (home, about, credits):
 * SOBO logo · Home / About / Credits · Sona Star logo · Log in.
 */
export function renderPublicBar(active = '') {
  const tabs = [['index.html', 'home', '🏠 Home'], ['about.html', 'about', 'ℹ️ About'], ['credits.html', 'credits', '📜 Credits']];
  const header = el('header', { class: 'topbar public-bar' }, el('div', { class: 'topbar-inner', html: `
    <a class="brand" href="${rootUrl('index.html')}"><img class="brand-logo" src="${rootUrl('assets/img/sobo-logo.png')}" alt="">SOBO</a>
    <button class="icon-btn menu-btn" aria-label="Menu" id="menu-btn">☰</button>
    <nav class="nav" id="main-nav">${tabs.map(([href, key, label]) =>
      `<a class="${key === active ? 'active' : ''}" href="${rootUrl(href)}" ${key === active ? 'aria-current="page"' : ''}>${label}</a>`).join('')}
      <a class="nav-login" href="${rootUrl('login.html')}">🔑 Log in</a></nav>
    <div class="spacer"></div>
    <span class="guide-slot" id="guide-slot"></span>
    <img class="partner-logo" src="${rootUrl('assets/img/sona-star-logo.png')}" alt="Sona Star Innovation" title="Sona Star Innovation">
    <a class="btn small login-btn" href="${rootUrl('login.html')}">🔑 Log in</a>` }));
  document.body.prepend(header);
  $('#menu-btn').onclick = () => $('#main-nav').classList.toggle('open');
  mountGuide($('#guide-slot'), 'public');
}

export function updateXp(xp) {
  const chip = document.getElementById('xp-chip');
  if (chip) chip.textContent = `⭐ ${xp} XP`;
}

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Download rows as a CSV file. rows: array of objects */
export function downloadCsv(filename, rows) {
  if (!rows.length) { toast('Nothing to export yet'); return; }
  const cols = Object.keys(rows[0]);
  const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
  const a = el('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: filename });
  document.body.append(a); a.click(); a.remove();
}

// ---------------------------------------------------------------- icons (inline SVG, so they render the same everywhere)
const svg = (d) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICONS = {
  fullscreen: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  exitFullscreen: svg('<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>'),
  sound: svg('<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>'),
  mute: svg('<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9l5 6M22 9l-5 6"/>'),
  pause: svg('<path d="M8 5v14M16 5v14"/>'),
  play: svg('<path d="M7 5l12 7-12 7z"/>'),
};

// ---------------------------------------------------------------- full screen
/**
 * Wire a button that puts `target` in full screen (and back). Falls back to filling the browser window
 * where the Fullscreen API isn't available for elements (e.g. iPhone Safari). Returns { toggle, isOn }.
 */
export function fullscreenToggle(target, button, { onChange } = {}) {
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
  const isOn = () => fsEl() === target || target.classList.contains('pseudo-fs');
  const sync = () => {
    const on = isOn();
    button.innerHTML = on ? ICONS.exitFullscreen : ICONS.fullscreen;
    button.title = on ? 'Exit full screen (F)' : 'Full screen (F)';
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-pressed', String(on));
    document.body.classList.toggle('has-pseudo-fs', target.classList.contains('pseudo-fs'));
    onChange?.(on);
  };
  const toggle = async () => {
    if (isOn()) {
      if (target.classList.contains('pseudo-fs')) target.classList.remove('pseudo-fs');
      else await (document.exitFullscreen?.() ?? document.webkitExitFullscreen?.());
    } else if (target.requestFullscreen) {
      await target.requestFullscreen({ navigationUI: 'hide' }).catch(() => target.classList.add('pseudo-fs'));
    } else if (target.webkitRequestFullscreen) {
      target.webkitRequestFullscreen();
    } else {
      target.classList.add('pseudo-fs');
    }
    sync();
  };
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && target.classList.contains('pseudo-fs')) { target.classList.remove('pseudo-fs'); sync(); } });
  button.addEventListener('click', toggle);
  sync();
  return { toggle, isOn };
}
