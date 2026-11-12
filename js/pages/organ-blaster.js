// Organ Blaster — pilot a nanobot through the body's tunnels and shoot the right organ before the clock runs out.
import { requireRole } from '../auth.js';
import * as api from '../api.js';
import { rootUrl } from '../supabase.js';
import { AnatomyViewer, loadSystemScene, loadingOverlay, THREE } from '../three/viewer.js';
import { SYSTEMS } from '../data/pathways.js';
import { GameSession } from '../games/session.js';
import { BLASTER, DIFFICULTY, difficultyOf, waveConfig, scoreFor, pickRound, accuracy, startTime, addTime, clockBonus, waveReward } from '../games/logic.js';
import { sfx, unlockAudio, isMuted, setMuted } from '../games/sfx.js';
import { $, esc, param, errorToast, updateXp, getSettings, fullscreenToggle, ICONS } from '../ui.js';

const profile = await requireRole(['student']);
const app = document.getElementById('app');
const level = await api.getMyLevel();
const system = SYSTEMS[param('system')] ? param('system') : 'digestive';
const shortLabel = (l) => l.replace(/\s*\(([^)]*)\)\s*$/, (m, inner) => (inner.split(' ').length >= 3 ? '' : m));
const reduceMotion = () => document.documentElement.classList.contains('reduce-motion');
const low = getSettings().lowGraphics;
const fmtTime = (sec) => { const s = Math.max(0, Math.ceil(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const DIFF_KEY = 'bq-blaster-difficulty';
let difficulty = (() => { try { return DIFFICULTY[localStorage.getItem(DIFF_KEY)] ? localStorage.getItem(DIFF_KEY) : 'normal'; } catch { return 'normal'; } })();

app.innerHTML = `
<div class="row between" style="margin-bottom:10px">
  <div><a href="${rootUrl('student/games.html')}">← Games</a> <strong style="margin-left:8px">🎯 Organ Blaster · ${SYSTEMS[system].icon} ${SYSTEMS[system].name}</strong></div>
  <span class="small muted keys-hint">Space shoot · P pause · M sound · F full screen</span>
</div>
<div class="game-wrap blaster" id="game">
  <div class="time-strip" aria-hidden="true"><span id="time-strip"></span></div>
  <div class="hud blaster-hud">
    <div class="hud-card score-card">
      <div class="hud-label">Score</div>
      <div class="hud-big" id="score">0</div>
      <div class="combo" id="combo"><span id="combo-x"></span><div class="combo-bar"><span id="combo-bar"></span></div></div>
    </div>
    <div class="hud-card prompt-card" id="prompt-card" aria-live="polite">
      <div class="prompt-kind" id="prompt-kind">Get ready</div>
      <div class="prompt-text" id="prompt-text">…</div>
      <div class="wave-line"><span id="wave-label">Wave 1/${BLASTER.maxWaves}</span><span class="pips" id="pips"></span></div>
    </div>
    <div class="hud-card clock-card" id="clock-card">
      <div class="hud-label">Time</div>
      <div class="hud-big clock" id="clock">0:00</div>
      <div class="shields" id="shields" aria-label="Shields"></div>
    </div>
  </div>
  <div class="game-controls">
    <button class="g-btn" id="mute-btn" type="button"></button>
    <button class="g-btn" id="pause-btn" type="button" title="Pause (P)" aria-label="Pause">${ICONS.pause}</button>
    <button class="g-btn" id="fs-btn" type="button"></button>
  </div>
  <div class="zone-tag"><span id="zone"></span><span id="diff-tag"></span></div>
  <div class="crosshair hidden" id="crosshair"></div>
  <div class="banner hidden" id="banner"><div class="b-title"></div><div class="b-sub"></div></div>
  <div class="flash hidden" id="flash"></div>
  <div class="feedback-card hidden" id="feedback"></div>
  <div class="overlay" id="overlay"></div>
</div>`;

const wrap = $('#game');
const viewer = new AnatomyViewer(wrap, { controls: false, fov: 62 });
viewer.camera.position.set(0, 0, 0);
viewer.camera.lookAt(0, 0, -1);
const scene = viewer.scene;

// ------------------------------------------------------------------ tunnel themes (the wall changes every wave / game)
const THEMES = [
  { name: 'Artery', base: '#5a0c12', streak: [[190, 40, 45], [250, 80, 70]], pattern: 'veins', fog: 0x2a0508, light: 0xffc8c0, accent: 0xff5a5a, cell: 0xd2232a, glow: 0x3a0408 },
  { name: 'Vein', base: '#24093a', streak: [[90, 40, 160], [170, 80, 220]], pattern: 'veins', fog: 0x10051c, light: 0xc8b8ff, accent: 0x9f7bff, cell: 0x8a1f4a, glow: 0x1a0630 },
  { name: 'Lymph vessel', base: '#0b3a2c', streak: [[60, 170, 120], [150, 240, 190]], pattern: 'cells', fog: 0x031a12, light: 0xb8ffe0, accent: 0x5dffb0, cell: 0xeaf7ee, glow: 0x032a1c },
  { name: 'Capillary bed', base: '#6a1838', streak: [[230, 90, 140], [255, 160, 200]], pattern: 'folds', fog: 0x2a0816, light: 0xffc4e0, accent: 0xff7ab8, cell: 0xe0405a, glow: 0x3a0820 },
  { name: 'Nerve channel', base: '#081a42', streak: [[60, 160, 255], [160, 230, 255]], pattern: 'folds', fog: 0x020a1f, light: 0xa8dcff, accent: 0x5fd0ff, cell: 0x6fd3ff, glow: 0x041030 },
  { name: 'Gut lining', base: '#4a2a0a', streak: [[220, 150, 70], [255, 205, 120]], pattern: 'cells', fog: 0x1c0e02, light: 0xffe2b8, accent: 0xffb050, cell: 0xd98a3a, glow: 0x2a1404 },
];
let themeIdx = Math.floor(Math.random() * THEMES.length);
let theme = THEMES[themeIdx];

const wallCanvas = document.createElement('canvas'); wallCanvas.width = wallCanvas.height = 512;
const tunnelTex = new THREE.CanvasTexture(wallCanvas);
tunnelTex.wrapS = tunnelTex.wrapT = THREE.RepeatWrapping; tunnelTex.repeat.set(3, 6); tunnelTex.colorSpace = THREE.SRGBColorSpace;
const rnd = (a, b) => a + Math.random() * (b - a);
const mix = ([a, b]) => a.map((v, i) => Math.round(rnd(v, b[i])));

function drawWall(th) {
  const g = wallCanvas.getContext('2d');
  g.fillStyle = th.base; g.fillRect(0, 0, 512, 512);
  if (th.pattern === 'veins') {
    for (let i = 0; i < 70; i++) {
      const [r, gg, b] = mix(th.streak);
      g.strokeStyle = `rgba(${r},${gg},${b},${rnd(0.2, 0.55)})`; g.lineWidth = rnd(2, 9);
      g.beginPath(); let x = Math.random() * 512, y = -20; g.moveTo(x, y);
      while (y < 532) { x += (Math.random() - 0.5) * 60; y += rnd(30, 70); g.lineTo(x, y); }
      g.stroke();
    }
  } else if (th.pattern === 'cells') {
    for (let i = 0; i < 160; i++) {
      const [r, gg, b] = mix(th.streak);
      const x = Math.random() * 512, y = Math.random() * 512, rad = rnd(10, 30);
      const grad = g.createRadialGradient(x, y, rad * 0.2, x, y, rad);
      grad.addColorStop(0, `rgba(${r},${gg},${b},0.55)`); grad.addColorStop(0.7, `rgba(${r},${gg},${b},0.18)`); grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
    }
  } else {                       // folds: wavy rings around the tunnel
    for (let y = 0; y < 512; y += rnd(14, 26)) {
      const [r, gg, b] = mix(th.streak);
      g.strokeStyle = `rgba(${r},${gg},${b},${rnd(0.25, 0.6)})`; g.lineWidth = rnd(3, 8);
      g.beginPath(); g.moveTo(0, y);
      const amp = rnd(4, 12), ph = Math.random() * 6;
      for (let x = 0; x <= 512; x += 16) g.lineTo(x, y + Math.sin(x / 512 * Math.PI * 4 + ph) * amp);
      g.stroke();
    }
  }
  // soft dark speckles for depth
  for (let i = 0; i < 120; i++) { g.fillStyle = `rgba(0,0,0,${rnd(0.05, 0.18)})`; g.beginPath(); g.arc(Math.random() * 512, Math.random() * 512, rnd(2, 10), 0, Math.PI * 2); g.fill(); }
  tunnelTex.needsUpdate = true;
}

const tunnel = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 80, 40, 1, true),
  new THREE.MeshStandardMaterial({ map: tunnelTex, side: THREE.BackSide, roughness: 0.75, metalness: 0.05, emissiveIntensity: 0.9 }));
tunnel.rotation.x = Math.PI / 2; tunnel.position.z = -30;
scene.add(tunnel);
scene.fog = new THREE.Fog(0x000000, 5, 32);
// steady lighting (no heartbeat pulse on the wall)
const headLight = new THREE.PointLight(0xffffff, 18, 22, 1.4);
scene.add(headLight);
// glowing rings of light that stream past — sells the speed
const ringLights = low ? [] : [0, 1, 2].map((i) => { const l = new THREE.PointLight(0xffffff, 14, 9, 1.6); l.position.set(0, 0, -6 - i * 9); scene.add(l); return l; });

function applyTheme(th) {
  theme = th;
  drawWall(th);
  tunnel.material.emissive.setHex(th.glow);
  scene.fog.color.setHex(th.fog);
  headLight.color.setHex(th.light);
  for (const l of ringLights) l.color.setHex(th.accent);
  tint.wall.setHex(0xffffff); tint.ring.setHex(th.accent); tunnel.material.color.setHex(0xffffff);
  cells.material.color.setHex(th.cell);
  haloMat.color.setHex(th.accent);
  $('#zone').textContent = `📍 ${th.name}`;
}
// small per-round variation: wall tint, light hue and which part of the pattern faces you (blended in smoothly)
const tint = { wall: new THREE.Color(0xffffff), ring: new THREE.Color(0xffffff) };
function varyRound() {
  const hsl = {}; new THREE.Color(theme.accent).getHSL(hsl);
  tint.wall.setHSL((hsl.h + rnd(-0.06, 0.06) + 1) % 1, rnd(0.15, 0.35), rnd(0.82, 0.97));
  tint.ring.setHSL((hsl.h + rnd(-0.08, 0.08) + 1) % 1, Math.min(1, hsl.s + 0.1), rnd(0.55, 0.7));
  tunnelTex.offset.x = Math.random();
}
function nextTheme() { themeIdx = (themeIdx + 1 + Math.floor(Math.random() * (THEMES.length - 1))) % THEMES.length; applyTheme(THEMES[themeIdx]); }

// a few cells drifting along the outer wall (not in the middle where the organs are)
const RBC = low ? 18 : 34;
const cells = new THREE.InstancedMesh(new THREE.TorusGeometry(0.13, 0.07, 8, 18),
  new THREE.MeshStandardMaterial({ color: 0xd2232a, roughness: 0.45 }), RBC);
const cellData = Array.from({ length: RBC }, () => {
  const a = Math.random() * Math.PI * 2, r = rnd(2.55, 3.1);
  return { a, r, z: -Math.random() * 40, rot: new THREE.Euler(Math.random() * 3, Math.random() * 3, 0), s: rnd(0.7, 1.4), drift: rnd(-0.15, 0.15) };
});
scene.add(cells);
const tmp = new THREE.Object3D();

// soft glow behind each organ so it pops out of the dark
const glowTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)'); grad.addColorStop(0.35, 'rgba(255,255,255,0.35)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();
const haloMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });

// nanobot (bottom centre) — leans toward where you aim
const bot = new THREE.Group();
const botBody = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 18), new THREE.MeshStandardMaterial({ color: 0xdff4ff, metalness: 0.7, roughness: 0.2 }));
const nose = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.24, 18), new THREE.MeshStandardMaterial({ color: 0x7df9ff, emissive: 0x2299aa, emissiveIntensity: 1.2 }));
nose.rotation.x = -Math.PI / 2; nose.position.z = -0.19;
const ring = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.025, 10, 32), new THREE.MeshStandardMaterial({ color: 0x7df9ff, emissive: 0x7df9ff, emissiveIntensity: 0.9 }));
const engine = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x7df9ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
engine.scale.setScalar(0.5); engine.position.z = 0.16;
bot.add(botBody, nose, ring, engine); bot.scale.setScalar(0.55); bot.position.set(0, -0.72, -1.7);
scene.add(bot);

applyTheme(theme);

// ------------------------------------------------------------------ game state
let organs = [], content = {}, meshes = new Map(), weights = {}, myGames = [];
let state = null;          // see startGame()
let active = [];           // organ clones currently flying
let target = null, promptType = 'name', promptAt = 0, roundBusy = false, roundTimer = null;
let session = null;
const aim = { x: 0, y: 0 };  // container pixels
const sparks = [];

const ld = loadingOverlay(wrap, 'Shrinking your nanobot…');
try {
  const [models, c, mastery, games] = await Promise.all([api.getOrganModels(system, level), api.getContent(system), api.getMastery(),
    api.getGameSessions(null, 200).catch(() => [])]);
  content = c;
  myGames = games.filter((g) => g.game === 'organ_blaster');
  const { organs: loaded } = await loadSystemScene(system, level, (p) => ld.set(`Shrinking your nanobot… ${Math.round(p * 100)}%`));
  meshes = loaded;
  organs = models.filter((m) => meshes.has(m.slug) && content[m.slug]).map((m) => ({ slug: m.slug, label: shortLabel(m.label) }));
  for (const m of mastery) if (m.system === system) weights[m.slug] = m.mastery < 50 ? 2 : m.mastery < 75 ? 1 : 0;
  ld.done();
} catch (e) { ld.error(e.message); errorToast(e); throw e; }

// ------------------------------------------------------------------ overlay screens
function showOverlay(html, cls = '') { const o = $('#overlay'); o.innerHTML = `<div class="card ${cls}">${html}</div>`; o.classList.remove('hidden'); }
function hideOverlay() { $('#overlay').classList.add('hidden'); }

const bestScore = (sys = system) => Math.max(0, ...myGames.filter((g) => g.system === sys).map((g) => g.score || 0));

function difficultyPicker() {
  return `<div class="diff-grid" role="radiogroup" aria-label="Difficulty">${Object.entries(DIFFICULTY).map(([k, d]) => `
    <button type="button" class="diff-card ${k === difficulty ? 'active' : ''}" data-d="${k}" role="radio" aria-checked="${k === difficulty}">
      <span class="d-icon">${d.icon}</span><span class="d-name">${d.label}</span>
      <span class="d-desc">${esc(d.desc)}</span>
      <span class="d-meta">⏱ ${d.startSec}s · +${d.bonusSec}s per hit${d.scoreMult !== 1 ? ` · ×${d.scoreMult} pts` : ''}</span>
    </button>`).join('')}</div>`;
}
function bindDifficultyPicker(root) {
  root.querySelectorAll('.diff-card').forEach((b) => b.addEventListener('click', () => {
    difficulty = b.dataset.d;
    try { localStorage.setItem(DIFF_KEY, difficulty); } catch { /* ignore */ }
    unlockAudio(); sfx.click();
    root.querySelectorAll('.diff-card').forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-checked', String(x === b)); });
  }));
}

function showStart() {
  const best = bestScore();
  showOverlay(`
    <div class="bl-split">
      <div class="bl-main">
        <div class="bl-title"><span class="bl-logo">🎯</span><div><h2>Organ Blaster</h2>
          <div class="muted small">${SYSTEMS[system].icon} ${SYSTEMS[system].name}${best ? ` · your best: <strong>${best}</strong>` : ''}</div></div></div>
        <div class="how-grid">
          <div><span>🎯</span>Shoot the organ in the clue before it flies past</div>
          <div><span>🧠</span>Wave 3+: the clue is only the organ's <strong>job</strong></div>
          <div><span>⏱</span>Beat the clock — every hit wins back time</div>
          <div><span>🛡</span>3 shields. Finish a wave to get one back</div>
        </div>
        <h3 class="bl-h3">Choose your difficulty</h3>
        ${difficultyPicker()}
        <button class="btn big block" id="start-btn">▶ Start mission</button>
        <p class="small muted center" style="margin:10px 0 0">🖱 Aim + click · ⌨️ Arrows + Space · 📱 Tap</p>
      </div>
      <aside class="bl-side" id="board-start"></aside>
    </div>`, 'wide');
  bindDifficultyPicker($('#overlay'));
  $('#start-btn').onclick = () => { unlockAudio(); startGame(); };
  renderBoard($('#board-start'), { scope: 'system', diff: difficulty });
}

// ------------------------------------------------------------------ leaderboard
const DIFF_TABS = [['all', 'All'], ...Object.entries(DIFFICULTY).map(([k, d]) => [k, `${d.icon} ${d.label}`])];
async function renderBoard(box, opts) {
  const o = { scope: 'system', diff: 'all', ...opts };
  box.innerHTML = `<div class="board">
    <div class="board-head"><h3>🏆 Leaderboard</h3>
      <div class="seg" role="tablist"><button data-scope="system" class="${o.scope === 'system' ? 'on' : ''}">${SYSTEMS[system].icon} This system</button><button data-scope="all" class="${o.scope === 'all' ? 'on' : ''}">All systems</button></div></div>
    <div class="seg small-seg">${DIFF_TABS.map(([k, l]) => `<button data-diff="${k}" class="${o.diff === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="board-body"><div class="board-empty">Loading…</div></div></div>`;
  box.querySelectorAll('[data-scope]').forEach((b) => b.onclick = () => renderBoard(box, { ...o, scope: b.dataset.scope }));
  box.querySelectorAll('[data-diff]').forEach((b) => b.onclick = () => renderBoard(box, { ...o, diff: b.dataset.diff }));
  const body = box.querySelector('.board-body');
  try {
    const res = await api.getBlasterLeaderboard({ system: o.scope === 'system' ? system : null, difficulty: o.diff === 'all' ? null : o.diff, limit: 10 });
    if (!body.isConnected) return;
    let rows = res.rows, note = '';
    if (!res.available) {
      // database not upgraded yet: show the player's own best games instead
      note = 'Class rankings appear once your teacher updates SOBO. Your best games:';
      rows = myGames.filter((g) => (o.scope === 'all' || g.system === system) && (o.diff === 'all' || g.difficulty === o.diff))
        .sort((a, b) => b.score - a.score).slice(0, 5)
        .map((g, i) => ({ rank: i + 1, display_name: profile.display_name, score: g.score, duration_ms: g.duration_ms, wave_reached: g.wave_reached, difficulty: g.difficulty, system: g.system, is_me: true }));
    }
    if (!rows.length) { body.innerHTML = `${note ? `<p class="board-note">${note}</p>` : ''}<div class="board-empty">No scores yet — be the first! 🚀</div>`; return; }
    const medal = (r) => ({ 1: '🥇', 2: '🥈', 3: '🥉' }[r] || `#${r}`);
    let prev = 0;
    body.innerHTML = `${note ? `<p class="board-note">${note}</p>` : ''}<ol class="board-list">${rows.map((r) => {
      const gap = r.rank > prev + 1 && prev > 0 ? '<li class="gap" aria-hidden="true">⋯</li>' : '';
      prev = r.rank;
      return `${gap}<li class="${r.is_me ? 'me' : ''}">
        <span class="b-rank">${medal(r.rank)}</span>
        <span class="b-name">${esc(r.display_name)}${r.is_me ? ' <em>(you)</em>' : ''}
          <small>${o.scope === 'all' ? `${SYSTEMS[r.system]?.icon || ''} ` : ''}${r.difficulty ? `${DIFFICULTY[r.difficulty]?.icon || ''} ` : ''}wave ${r.wave_reached ?? '–'}</small></span>
        <span class="b-time" title="Time played">⏱ ${r.duration_ms ? fmtTime(r.duration_ms / 1000) : '–'}</span>
        <span class="b-score">${r.score}</span></li>`;
    }).join('')}</ol>`;
  } catch (e) {
    console.error(e);
    if (body.isConnected) body.innerHTML = '<div class="board-empty">Couldn\'t load the leaderboard right now.</div>';
  }
}

// ------------------------------------------------------------------ game flow
async function startGame() {
  hideOverlay();
  clearTimeout(roundTimer);
  clearActive();
  document.activeElement?.blur?.();
  $('#feedback').classList.add('hidden');
  const d = difficultyOf(difficulty);
  state = { wave: 1, round: 0, shields: BLASTER.shields, score: 0, combo: 0, bestCombo: 0, correct: 0, total: 0, missed: new Map(),
    running: true, paused: false, timeLeft: startTime(difficulty), startSec: d.startSec, played: 0, lastTick: null };
  target = null;
  $('#diff-tag').textContent = ` · ${d.icon} ${d.label}`;
  session = new GameSession('organ_blaster', system, level);
  await session.start();
  $('#crosshair').classList.remove('hidden');
  wrap.classList.add('playing');
  updateHud();
  showBanner(`Entering: ${theme.name}`, `${d.icon} ${d.label} · ${d.startSec}s on the clock`, 1100);
  sfx.wave();
  roundTimer = setTimeout(nextRound, 900);
}

// Drawn shield icon (the 🛡 emoji shows as a thin outline on Windows): solid when you still have it, empty outline when lost
const SHIELD_ICON = `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
  <path class="sh-body" d="M12 2.2l8 3v6.2c0 5-3.4 9.1-8 10.7-4.6-1.6-8-5.7-8-10.7V5.2l8-3z"/>
  <path class="sh-shine" d="M12 4.6l5.7 2.1v4.7c0 3.6-2.3 6.7-5.7 8.1z"/></svg>`;

function updateHud(shieldAnim = null) {
  $('#score').textContent = state.score;
  $('#wave-label').textContent = `Wave ${Math.min(state.wave, BLASTER.maxWaves)}/${BLASTER.maxWaves}`;
  const mult = 1 + Math.min(state.combo, 8) * 0.25;
  $('#combo').classList.toggle('on', state.combo > 1);
  $('#combo-x').textContent = state.combo > 1 ? `🔥 Combo ×${mult.toFixed(2)}` : '';
  $('#combo-bar').style.width = `${Math.min(state.combo, 8) / 8 * 100}%`;
  $('#shields').innerHTML = Array.from({ length: BLASTER.shields }, (_, i) =>
    `<span class="shield ${i < state.shields ? 'full' : 'empty'} ${shieldAnim === 'restore' && i === state.shields - 1 ? 'pop' : ''} ${shieldAnim === 'lost' && i === state.shields ? 'break' : ''}" title="${i < state.shields ? 'Shield' : 'Shield lost'}">${SHIELD_ICON}</span>`).join('');
  $('#shields').setAttribute('aria-label', `${state.shields} of ${BLASTER.shields} shields left`);
  $('#pips').innerHTML = Array.from({ length: BLASTER.rounds }, (_, i) =>
    `<i class="${i < state.round - 1 || (i === state.round - 1 && roundBusy && !state.lostRound) ? 'done' : i === state.round - 1 ? 'now' : ''}"></i>`).join('');
  updateClock();
}

function updateClock() {
  const t = state.timeLeft;
  $('#clock').textContent = fmtTime(t);
  $('#clock-card').classList.toggle('low', t <= 10);
  $('#time-strip').style.width = `${Math.max(0, Math.min(1, t / state.startSec)) * 100}%`;
  $('#time-strip').parentElement.classList.toggle('low', t <= 10);
}

function clearActive() { for (const a of active) scene.remove(a.mesh); active = []; }

function nextRound() {
  if (!state?.running) return;
  if (state.paused) { roundTimer = setTimeout(nextRound, 200); return; }
  roundBusy = false; state.lostRound = false;
  clearActive();
  if (state.round >= BLASTER.rounds) {
    state.round = 0; state.wave++;
    if (state.wave > BLASTER.maxWaves) { endGame('complete'); return; }
    const reward = waveReward(state.shields);
    state.shields = reward.shields; state.score += reward.bonus;
    nextTheme();
    updateHud(reward.restored ? 'restore' : null);
    const jobs = waveConfig(state.wave).promptType === 'function' && state.wave === 3 ? ' · now only the job is shown!' : '';
    showBanner(`Wave ${state.wave} · ${theme.name}`,
      `${reward.restored ? '🛡 +1 shield restored' : `🛡 Full shields bonus +${reward.bonus}`}${jobs}`, 1400);
    sfx.wave();
    if (reward.restored) setTimeout(() => sfx.shieldUp(), 380);
    roundTimer = setTimeout(nextRound, 1400);
    return;
  }
  state.round++;
  if (state.round > 1) varyRound();
  const cfg = waveConfig(state.wave, difficulty);
  const pick = pickRound(organs, cfg.count, weights, Math.random, target?.slug);
  target = pick.target; promptType = cfg.promptType;
  $('#prompt-kind').textContent = promptType === 'name' ? 'Find the organ' : 'Which organ does this job?';
  $('#prompt-text').textContent = promptType === 'name' ? target.label : content[target.slug].function;
  $('#prompt-card').classList.toggle('job', promptType !== 'name');
  const pc = $('#prompt-card'); pc.classList.remove('new'); void pc.offsetWidth; pc.classList.add('new');
  updateHud();
  const n = pick.group.length;
  const list = pick.group.slice().sort(() => Math.random() - 0.5);
  const startZ = -24, travel = startZ - -1.2;
  list.forEach((o, i) => {
    const src = meshes.get(o.slug);
    const mesh = src.clone();                      // note: clone() JSON-copies userData, so read colours from src
    mesh.material = src.material.clone();
    mesh.material.emissive.copy(src.userData.baseColor).multiplyScalar(0.12);
    mesh.geometry.computeBoundingBox();
    const size = mesh.geometry.boundingBox.getSize(new THREE.Vector3());
    const scale = 1.0 / Math.max(size.x, size.y, size.z);
    mesh.scale.setScalar(scale);
    const halo = new THREE.Sprite(haloMat.clone());
    halo.scale.setScalar(2.1 / scale); halo.renderOrder = -1;
    mesh.add(halo);
    const ang = (i / n) * Math.PI * 2 + Math.random() * 0.5;
    const rad = n === 1 ? 0 : rnd(0.9, 1.25);
    const base = new THREE.Vector2(Math.cos(ang) * rad * 1.3, Math.sin(ang) * rad * 0.8);
    mesh.position.set(base.x, base.y, startZ - Math.random() * 3);
    mesh.rotation.set(rnd(-0.3, 0.3), Math.random() * Math.PI * 2, 0);
    mesh.userData.slug = o.slug;
    scene.add(mesh);
    active.push({
      mesh, slug: o.slug, base, halo, speed: -travel / cfg.travelSec, spin: rnd(-1.5, 1.5),
      // each organ weaves along its own looping path (wider and quicker on harder difficulties)
      amp: new THREE.Vector2(rnd(0.5, 1) * cfg.wander, rnd(0.4, 0.8) * cfg.wander),
      freq: rnd(0.9, 1.7) * (0.8 + cfg.wander * 0.6), phase: Math.random() * Math.PI * 2,
    });
  });
  promptAt = performance.now();
}

// ------------------------------------------------------------------ shooting
function shootAt(px, py) {
  if (!state?.running || state.paused || roundBusy || !active.length) return;
  const rect = wrap.getBoundingClientRect();
  const hit = viewer.pickAt(rect.left + px, rect.top + py, active.map((a) => a.mesh)) || nearMiss(px, py);
  laser(px, py, hit);
  sfx.shoot();
  if (!hit) return;
  const ms = performance.now() - promptAt;
  state.total++;
  if (hit.userData.slug === target.slug) {
    state.correct++;
    const pts = scoreFor(state.combo, ms, difficulty);
    sfx.hit(state.combo);
    state.combo++; state.bestCombo = Math.max(state.bestCombo, state.combo); state.score += pts;
    const before = state.timeLeft;
    state.timeLeft = addTime(state.timeLeft, difficulty);
    session.log({ slug: target.slug, promptType, correct: true, responseMs: ms });
    popText(`+${pts}`, px, py - 20, 'pts');
    if (state.timeLeft > before) { popAtClock(`+${Math.round(state.timeLeft - before)}s`); setTimeout(() => sfx.timeBonus(), 90); }
    if (state.combo > 2) flash(`🔥 ×${state.combo} combo!`, 'good', 550);
    burst(hit);
    roundBusy = true;
    updateHud();
    roundTimer = setTimeout(nextRound, 380);
  } else {
    session.log({ slug: target.slug, promptType, correct: false, responseMs: ms });
    sfx.wrong();
    shake();
    loseShield(`That was the ${organs.find((o) => o.slug === hit.userData.slug)?.label}.`);
  }
}

/** Aim assist: a shot that lands just beside an organ (or in the gap of a hollow one, like a colon loop) still counts. */
function nearMiss(px, py) {
  let best = null, bestD = Infinity;
  const c = new THREE.Vector3(), edge = new THREE.Vector3();
  for (const a of active) {
    if (!a.mesh.visible) continue;
    a.mesh.getWorldPosition(c);
    a.mesh.geometry.computeBoundingSphere();
    const rWorld = a.mesh.geometry.boundingSphere.radius * a.mesh.scale.x;
    const s = viewer.toScreen(c);
    const e = viewer.toScreen(edge.copy(c).addScaledVector(viewer.camera.up, rWorld));
    const rPx = Math.hypot(e.x - s.x, e.y - s.y) * 0.8 + 14;      // most of the organ's size plus a little slack
    const d = Math.hypot(s.x - px, s.y - py);
    if (d < rPx && d < bestD) { bestD = d; best = a.mesh; }
  }
  return best;
}

function loseShield(why) {
  roundBusy = true; state.lostRound = true;
  state.shields--; state.combo = 0;
  state.missed.set(target.slug, target.label);
  updateHud('lost');
  setTimeout(() => sfx.shieldLost(), 120);
  const correct = active.find((a) => a.slug === target.slug);
  if (correct) {
    correct.mesh.material.emissive.setRGB(0.25, 0.9, 0.4);
    correct.halo.material.color.setHex(0x5dff9a);
    for (const a of active) if (a !== correct) a.mesh.visible = false;
  }
  for (const a of active) { a.speed = 0; a.amp.set(0, 0); }
  const fb = $('#feedback');
  fb.innerHTML = `<strong>🛡 Shield lost!</strong> ${esc(why)}<br>The answer was <strong>${esc(target.label)}</strong>: ${esc(content[target.slug].function)}`;
  fb.classList.remove('hidden');
  roundTimer = setTimeout(() => {
    fb.classList.add('hidden');
    if (state.shields <= 0) endGame('shields'); else nextRound();
  }, 2000);
}

function laser(px, py, hit) {
  const line = document.createElement('div');
  const s = viewer.toScreen(bot.getWorldPosition(new THREE.Vector3()));
  const sx = s.x, sy = s.y - 6;
  const len = Math.hypot(px - sx, py - sy), ang = Math.atan2(py - sy, px - sx);
  const col = hit ? '#7dffb3' : '#7df9ff';
  line.className = 'laser';
  line.style.cssText = `left:${sx}px;top:${sy}px;width:${len}px;background:linear-gradient(90deg, ${col}, #fff);
    transform:rotate(${ang}rad);box-shadow:0 0 12px ${col}, 0 0 24px ${col}`;
  wrap.append(line);
  setTimeout(() => { line.style.opacity = '0'; setTimeout(() => line.remove(), 180); }, 70);
}

function burst(mesh) {
  const start = performance.now(), s0 = mesh.scale.x;
  const halo = mesh.children[0];
  const off = viewer.onFrame(() => {
    const k = (performance.now() - start) / 320;
    mesh.scale.setScalar(s0 * (1 + k * 0.9));
    mesh.material.transparent = true; mesh.material.opacity = Math.max(0, 1 - k);
    if (halo) halo.material.opacity = Math.max(0, 0.9 * (1 - k));
    if (k >= 1) { off(); scene.remove(mesh); }
  });
  if (reduceMotion()) return;
  const at = mesh.getWorldPosition(new THREE.Vector3());
  for (let i = 0; i < (low ? 8 : 18); i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: i % 2 ? 0x7dffb3 : theme.accent, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    sp.position.copy(at); sp.scale.setScalar(rnd(0.15, 0.35));
    const v = new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-0.5, 1)).normalize().multiplyScalar(rnd(2, 5));
    scene.add(sp); sparks.push({ sp, v, life: 0 });
  }
}

function shake() {
  if (reduceMotion()) return;
  wrap.classList.remove('shake'); void wrap.offsetWidth; wrap.classList.add('shake');
}

function flash(text, kind = 'good', ms = 900) {
  const f = $('#flash');
  f.textContent = text; f.className = `flash ${kind}`;
  clearTimeout(flash.t); flash.t = setTimeout(() => f.classList.add('hidden'), ms);
}

function showBanner(title, sub = '', ms = 1200) {
  const b = $('#banner');
  b.querySelector('.b-title').textContent = title;
  b.querySelector('.b-sub').textContent = sub;
  b.classList.remove('hidden', 'show'); void b.offsetWidth; b.classList.add('show');
  clearTimeout(showBanner.t); showBanner.t = setTimeout(() => b.classList.add('hidden'), ms);
}

/** Floating "+120" / "+3s" text that drifts up and fades. */
function popText(text, x, y, cls = '') {
  const el = document.createElement('div');
  el.className = `pop-text ${cls}`;
  el.textContent = text;
  el.style.left = `${x}px`; el.style.top = `${y}px`;
  wrap.append(el);
  setTimeout(() => el.remove(), 900);
}
function popAtClock(text) {
  const c = $('#clock-card').getBoundingClientRect(), w = wrap.getBoundingClientRect();
  popText(text, c.left - w.left + c.width / 2, c.bottom - w.top + 6, 'time');
}

// ------------------------------------------------------------------ controls
const cross = $('#crosshair');
function moveAim(x, y) {
  aim.x = Math.max(0, Math.min(wrap.clientWidth, x)); aim.y = Math.max(0, Math.min(wrap.clientHeight, y));
  cross.style.left = `${aim.x}px`; cross.style.top = `${aim.y}px`;
}
moveAim(wrap.clientWidth / 2, wrap.clientHeight / 2);
wrap.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') { const r = wrap.getBoundingClientRect(); moveAim(e.clientX - r.left, e.clientY - r.top); } });
wrap.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.overlay, .feedback-card, button, .hud-card, .game-controls')) return;
  const r = wrap.getBoundingClientRect();
  moveAim(e.clientX - r.left, e.clientY - r.top);
  shootAt(aim.x, aim.y);
});
const keys = new Set();
document.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea, select')) return;
  if (e.key === ' ' || e.key === 'Enter') { if (state?.running && !e.target.closest?.('button')) { shootAt(aim.x, aim.y); e.preventDefault(); } }
  else if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') togglePause();
  else if (e.key === 'm' || e.key === 'M') toggleMute();
  else if (e.key === 'f' || e.key === 'F') fs.toggle();
  else if (e.key.startsWith('Arrow')) { keys.add(e.key); e.preventDefault(); }
});
document.addEventListener('keyup', (e) => keys.delete(e.key));
$('#pause-btn').onclick = togglePause;
document.addEventListener('visibilitychange', () => { if (document.hidden && state?.running && !state.paused) togglePause(); });

function syncMute() {
  const b = $('#mute-btn');
  b.innerHTML = isMuted() ? ICONS.mute : ICONS.sound;
  b.title = isMuted() ? 'Sound off — press M to turn on' : 'Sound on — press M to mute';
  b.setAttribute('aria-label', b.title);
  b.setAttribute('aria-pressed', String(isMuted()));
}
function toggleMute() { unlockAudio(); setMuted(!isMuted()); syncMute(); sfx.click(); }
$('#mute-btn').onclick = toggleMute;
syncMute();

const fs = fullscreenToggle(wrap, $('#fs-btn'), { onChange: () => setTimeout(() => moveAim(aim.x, aim.y), 50) });

function togglePause() {
  if (!state?.running) return;
  state.paused = !state.paused;
  const b = $('#pause-btn');
  b.innerHTML = state.paused ? ICONS.play : ICONS.pause;
  b.title = state.paused ? 'Resume (P)' : 'Pause (P)';
  b.setAttribute('aria-label', state.paused ? 'Resume' : 'Pause');
  if (state.paused) {
    showOverlay(`<h2>⏸ Paused</h2>
      <p class="muted">Score <strong>${state.score}</strong> · ⏱ ${fmtTime(state.timeLeft)} left · Wave ${state.wave}/${BLASTER.maxWaves}</p>
      <div class="stack" style="max-width:280px;margin:16px auto 0">
        <button class="btn big block" id="resume-btn">▶ Resume</button>
        <button class="btn ghost block" id="restart-btn">↺ Restart / change difficulty</button>
        <a class="btn ghost block" href="${rootUrl('student/games.html')}">Quit to games</a>
      </div>`);
    $('#resume-btn').onclick = togglePause;
    $('#restart-btn').onclick = () => { state.paused = false; abandon(); };
  } else { hideOverlay(); promptAt = performance.now() - 1000; }
}

/** Leave the current game (it still counts as played) and go back to the start screen. */
async function abandon() {
  state.running = false;
  clearTimeout(roundTimer);
  clearActive();
  wrap.classList.remove('playing');
  cross.classList.add('hidden');
  $('#pause-btn').innerHTML = ICONS.pause;
  await saveSession();
  showStart();
}

// ------------------------------------------------------------------ per-frame update
let gameTime = 0;
viewer.onFrame((dt, t) => {
  const paused = state?.paused;
  const flow = paused ? 0 : 1;
  const fast = state?.running ? (1 + (state.wave - 1) * 0.08) * Math.sqrt(difficultyOf(difficulty).speed) : 0.6;
  tunnelTex.offset.y -= dt * 0.6 * flow * fast;
  const blend = Math.min(1, dt * 2.5);
  tunnel.material.color.lerp(tint.wall, blend);
  for (const l of ringLights) { l.color.lerp(tint.ring, blend); l.position.z += dt * 9 * flow * fast; if (l.position.z > 1) l.position.z -= 27; }
  for (let i = 0; i < RBC; i++) {
    const c = cellData[i];
    c.z += dt * 8 * flow * c.s * fast;
    if (c.z > 1.5) c.z = -40;
    c.a += dt * c.drift * flow;
    c.rot.x += dt * 0.7 * flow; c.rot.y += dt * 0.5 * flow;
    tmp.position.set(Math.cos(c.a) * c.r, Math.sin(c.a) * c.r, c.z); tmp.rotation.copy(c.rot); tmp.scale.setScalar(c.s); tmp.updateMatrix();
    cells.setMatrixAt(i, tmp.matrix);
  }
  cells.instanceMatrix.needsUpdate = true;
  // the bot bobs and leans toward the crosshair
  const ax = (aim.x / (wrap.clientWidth || 1) - 0.5), ay = (aim.y / (wrap.clientHeight || 1) - 0.5);
  bot.position.x += ((ax * 0.5) - bot.position.x) * Math.min(1, dt * 6);
  bot.position.y = -0.72 + Math.sin(t * 2) * 0.025;
  bot.rotation.y = -ax * 0.6; bot.rotation.x = -ay * 0.4; ring.rotation.z += dt * 3;
  engine.material.opacity = 0.6 + Math.sin(t * 20) * 0.2;
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.life += dt; s.sp.position.addScaledVector(s.v, dt); s.v.multiplyScalar(0.94);
    s.sp.material.opacity = Math.max(0, 1 - s.life / 0.55);
    if (s.life > 0.55) { scene.remove(s.sp); s.sp.material.dispose(); sparks.splice(i, 1); }
  }
  if (keys.size) {
    const sp = 620 * dt;
    moveAim(aim.x + ((keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0)) * sp,
      aim.y + ((keys.has('ArrowDown') ? 1 : 0) - (keys.has('ArrowUp') ? 1 : 0)) * sp);
  }
  if (!state?.running || paused) return;
  gameTime += dt;
  for (const a of active) {
    a.mesh.position.z += a.speed * dt;
    // weave around — wider swings while far away, tighter as it gets close so it stays on screen
    const near = THREE.MathUtils.clamp(-a.mesh.position.z / 20, 0.35, 1);
    let x = a.base.x * (0.6 + 0.4 * near) + Math.sin(gameTime * a.freq + a.phase) * a.amp.x * 1.6 * near;
    let y = a.base.y * (0.6 + 0.4 * near) + Math.cos(gameTime * a.freq * 0.8 + a.phase) * a.amp.y * 1.2 * near;
    const r = Math.hypot(x, y);
    if (r > 2.3) { x *= 2.3 / r; y *= 2.3 / r; }          // never through the tunnel wall
    a.mesh.position.x = x; a.mesh.position.y = y;
    a.mesh.rotation.y += a.spin * dt;
  }
  // the clock only runs while organs are in play (not during feedback, banners or pauses)
  if (!roundBusy && active.length) {
    state.played += dt;
    state.timeLeft -= dt;
    const whole = Math.ceil(state.timeLeft);
    if (whole !== state.lastTick) {
      state.lastTick = whole;
      updateClock();
      if (whole <= 5 && whole > 0) sfx.tick(whole <= 3);
    }
    if (state.timeLeft <= 0) { state.timeLeft = 0; updateClock(); roundBusy = true; endGame('time'); return; }
  }
  const escaped = !roundBusy && active.find((a) => a.slug === target?.slug && a.mesh.position.z > -1.2);
  if (escaped) {
    state.total++;
    session.log({ slug: target.slug, promptType, correct: false, responseMs: performance.now() - promptAt });
    shake();
    loseShield('It got past you!');
  }
});

// ------------------------------------------------------------------ end
async function saveSession() {
  const acc = accuracy(state.correct, state.total);
  await session.end({ score: state.score, accuracy: Math.round(acc * 1000) / 1000, wave_reached: Math.min(state.wave, BLASTER.maxWaves),
    duration_ms: Math.round(state.played * 1000), difficulty });
  myGames.unshift({ game: 'organ_blaster', system, score: state.score, duration_ms: Math.round(state.played * 1000),
    wave_reached: Math.min(state.wave, BLASTER.maxWaves), difficulty });
}

async function endGame(reason) {
  if (!state.running) return;
  state.running = false;
  clearTimeout(roundTimer);
  wrap.classList.remove('playing');
  cross.classList.add('hidden');
  $('#feedback').classList.add('hidden');
  const bonus = reason === 'complete' ? clockBonus(state.timeLeft, difficulty) : 0;
  state.score += bonus;
  const prevBest = bestScore();
  const title = { complete: '🏆 Mission complete!', shields: '💥 Out of shields', time: '⏱ Time\'s up!' }[reason];
  if (reason === 'complete') sfx.win(); else sfx.gameOver();
  if (reason === 'time') showBanner('⏱ Time\'s up!', '', 1100);
  await new Promise((r) => setTimeout(r, reason === 'time' ? 900 : 300));
  clearActive();
  await saveSession();
  try { updateXp((await api.getMyProfile()).xp); } catch { /* ignore */ }
  const acc = accuracy(state.correct, state.total);
  const missed = [...state.missed.entries()];
  const d = difficultyOf(difficulty);
  const newBest = state.score > prevBest && state.score > 0;
  showOverlay(`
    <div class="bl-split">
      <div class="bl-main">
        <h2 class="end-title">${title}</h2>
        <p class="muted center" style="margin-top:-4px">${d.icon} ${d.label} · ${SYSTEMS[system].icon} ${SYSTEMS[system].name}</p>
        ${newBest ? '<div class="new-best">🎉 New personal best!</div>' : ''}
        <div class="end-stats">
          <div><b>${state.score}</b><span>score</span></div>
          <div><b>${fmtTime(state.played)}</b><span>time played</span></div>
          <div><b>${Math.round(acc * 100)}%</b><span>accuracy</span></div>
          <div><b>${Math.min(state.wave, BLASTER.maxWaves)}</b><span>wave</span></div>
        </div>
        <p class="small muted center">Best combo ×${state.bestCombo}${bonus ? ` · ⏱ clock bonus <strong>+${bonus}</strong> for ${Math.ceil(state.timeLeft)}s left` : ''}</p>
        ${missed.length ? `<p style="margin-bottom:6px"><strong>Organs to review:</strong></p><div class="chips">${missed.map(([slug, label]) =>
          `<a class="chip" href="${rootUrl(`student/learn.html?system=${system}&slug=${slug}`)}">📖 ${esc(label)}</a>`).join('')}</div>` : '<p class="center">No misses — amazing! 🌟</p>'}
        <div class="row" style="justify-content:center;margin-top:18px">
          <button class="btn big" id="again-btn">▶ Play again</button>
          <button class="btn ghost" id="change-btn">Change difficulty</button>
          <a class="btn ghost" href="${rootUrl('student/games.html')}">Back to games</a>
        </div>
      </div>
      <aside class="bl-side" id="board-end"></aside>
    </div>`, 'wide');
  $('#again-btn').onclick = () => { unlockAudio(); nextTheme(); startGame(); };   // a new wall every new game
  $('#change-btn').onclick = () => { nextTheme(); showStart(); };
  renderBoard($('#board-end'), { scope: 'system', diff: difficulty });
}

showStart();
