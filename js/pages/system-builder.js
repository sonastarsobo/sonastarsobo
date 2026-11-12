// System Builder — put a body system back together, then switch it on.
import { requireRole } from '../auth.js';
import * as api from '../api.js';
import { rootUrl } from '../supabase.js';
import { AnatomyViewer, loadingOverlay, THREE } from '../three/viewer.js';
import { SYSTEMS, PATHWAYS } from '../data/pathways.js';
import { GameSession } from '../games/session.js';
import { flowOrder, checkPlacement, builderStars, builderScore, builderHint } from '../games/logic.js';
import { $, esc, param, errorToast, updateXp, celebrate, shuffle, fullscreenToggle, muteToggle, speak, setMuted, isMuted } from '../ui.js';
import { sfx, unlockAudio } from '../games/sfx.js';

await requireRole(['student']);
const app = document.getElementById('app');
const level = await api.getMyLevel();
const system = PATHWAYS[param('system')] ? param('system') : 'digestive';
const pathway = PATHWAYS[system].levels[level];
const substance = PATHWAYS[system].substance;
const COLORS = { food: 0xf4b860, air: 0xbfe9ff, blood: 0xe53935, urine: 0xf6d743 };
const SLOT_COLOR = 0x7df9ff, SLOT_HOVER = 0xffffff;

app.innerHTML = `
<div class="row between" style="margin-bottom:10px">
  <div><a href="${rootUrl('student/games.html')}">← Games</a> <strong style="margin-left:8px">🧩 System Builder · ${SYSTEMS[system].icon} ${SYSTEMS[system].name}</strong></div>
  <div class="row"><span class="pill">⏱ <span id="timer">0:00</span></span><span class="pill">Tries: <span id="tries">0</span></span></div>
</div>
<div class="builder-layout" id="shell">
  <div class="game-wrap builder-stage" id="game" style="background:var(--viewer-bg)">
    <div class="hud">
      <div class="box prompt-box" id="prompt"><div class="kind">Your mission</div>
        <div>Put every organ from the box onto its glowing spot, then press <strong>Switch on</strong> to send ${esc(substance)} through.</div></div>
    </div>
    <div class="zoom-ctrl">
      <button class="btn ghost small" id="zoom-in" title="Zoom in" aria-label="Zoom in">＋</button>
      <button class="btn ghost small" id="zoom-out" title="Zoom out" aria-label="Zoom out">－</button>
      <button class="btn ghost small" id="zoom-fit" title="Fit to screen" aria-label="Fit to screen">⤢</button>
      <button class="btn ghost small" id="mute-btn" type="button"></button>
      <button class="btn ghost small" id="fs-btn" type="button"></button>
    </div>
    <div class="viewer-bottom" style="z-index:4">
      <button class="btn big accent" id="switch-btn">⚡ Switch on</button>
      <button class="btn ghost" id="reset-btn">↺ Reset</button>
    </div>
    <div class="feedback-card hidden" id="feedback"></div>
  </div>
  <aside class="builder-tray-panel" id="tray-panel">
    <div class="row between" style="gap:8px"><h3 style="margin:0">🧰 Organ box</h3><span class="pill primary" id="placed-count"></span></div>
    <p class="small muted" style="margin:6px 0 10px">Tap an organ, then tap a glowing spot — or drag it onto the body. Scroll or pinch to zoom.</p>
    <div class="tray-grid" id="tray"></div>
  </aside>
  <div class="overlay hidden" id="overlay"></div>
</div>`;

const wrap = $('#game');
const viewer = new AnatomyViewer(wrap, { controls: false, fov: 30 });
const session = new GameSession('system_builder', system, level);
const canvas = viewer.renderer.domElement;

let order = [], labels = {}, items = new Map(), slots = new Map(), placements = {}, organAt = {}, clusterOf = new Map();
let attempts = 0, startTime = 0, timerId = null, firstCheckLogged = false, flowing = false, done = false;
let sysBox, sysSize, dragPlaneZ, selected = null, hoverSlot = null, alertSlot = null;
const view = { zoom: 1, pan: new THREE.Vector2(), basePos: new THREE.Vector3(), baseTarget: new THREE.Vector3() };

const ld = loadingOverlay(wrap, 'Unpacking the organs…');
try {
  const models = await api.getOrganModels(system, level);
  const { organs } = await viewer.loadSystem(system, level, { onProgress: (p) => ld.set(p) });
  await viewer.loadSystem('skeletal', 'simple', { ghost: true }).catch(() => null);
  for (const m of models) labels[m.slug] = m.label.replace(/\s*\(([^)]*)\)\s*$/, (x, inner) => (inner.split(' ').length >= 3 ? '' : x));
  order = flowOrder(pathway, [...organs.keys()]);
  setup(organs);
  ld.done();
} catch (e) { ld.error(e.message); errorToast(e); throw e; }

// ------------------------------------------------------------------ setup
function setup(organs) {
  sysBox = new THREE.Box3();
  for (const m of organs.values()) sysBox.expandByObject(m);
  sysSize = sysBox.getSize(new THREE.Vector3());
  dragPlaneZ = sysBox.max.z + sysSize.z * 0.1;
  const markerR = Math.max(sysSize.y * 0.018, 0.006);

  for (const [slug, mesh] of organs) items.set(slug, { slug, mesh, card: null });

  // Some organs share (almost) the same spot — e.g. kidneys & renal pelvis. Group them, then spread their markers
  // in a small ring with a line to the real spot, so every spot can be seen and tapped.
  const minSep = sysSize.y * 0.06;
  const groups = [];
  for (const slug of organs.keys()) {
    const home = items.get(slug).mesh.userData.home;
    const g = groups.find((gr) => gr.some((s) => Math.hypot(items.get(s).mesh.userData.home.x - home.x, items.get(s).mesh.userData.home.y - home.y) < minSep));
    if (g) g.push(slug); else groups.push([slug]);
  }
  for (const g of groups) {
    const centre = new THREE.Vector3();
    for (const s of g) centre.add(items.get(s).mesh.userData.home);
    centre.divideScalar(g.length).setZ(dragPlaneZ);
    g.forEach((slug, i) => {
      clusterOf.set(slug, g);
      const pos = centre.clone();
      if (g.length > 1) {
        const ang = Math.PI + (i / g.length) * Math.PI * 2;      // first spot to the left, then round
        pos.x += Math.cos(ang) * minSep * 0.85; pos.y += Math.sin(ang) * minSep * 0.85;
      }
      const marker = new THREE.Mesh(new THREE.SphereGeometry(markerR, 18, 14),
        new THREE.MeshBasicMaterial({ color: SLOT_COLOR, transparent: true, opacity: 0.9, depthTest: false }));
      const halo = new THREE.Mesh(new THREE.SphereGeometry(markerR * 1.9, 18, 14),
        new THREE.MeshBasicMaterial({ color: SLOT_COLOR, transparent: true, opacity: 0.18, depthTest: false }));
      halo.renderOrder = 9; marker.add(halo);
      marker.position.copy(pos);
      marker.renderOrder = 10; marker.userData.slot = slug;
      viewer.scene.add(marker);
      let line = null;
      if (g.length > 1) {
        line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([pos, centre]),
          new THREE.LineBasicMaterial({ color: SLOT_COLOR, transparent: true, opacity: 0.6, depthTest: false }));
        line.renderOrder = 9; viewer.scene.add(line);
      }
      slots.set(slug, { marker, line, pos });
    });
  }

  // pulse the empty spots so they're easy to find
  viewer.onFrame((dt, t) => {
    const k = 1 + 0.12 * Math.sin(t * 4);
    for (const [slug, s] of slots) {
      const hot = slug === hoverSlot;
      s.marker.scale.setScalar((hot ? 1.6 : selected ? k * 1.15 : k) / Math.sqrt(view.zoom));
      s.marker.material.color.setHex(slug === alertSlot ? 0xff5252 : hot ? SLOT_HOVER : SLOT_COLOR);
    }
  });

  buildTray();
  fitView();
  for (const it of items.values()) sendToTray(it);
  updateCount();
}

// ------------------------------------------------------------------ the organ box (HTML tray with 3D thumbnails)
function buildTray() {
  const thumbs = renderThumbs([...items.values()].map((i) => i.mesh));
  const tray = $('#tray');
  for (const it of shuffle([...items.values()])) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'tray-item';
    card.dataset.slug = it.slug;
    card.innerHTML = `<img alt="" draggable="false" src="${thumbs.get(it.slug) || ''}"><span>${esc(labels[it.slug] || it.slug)}</span><em>✓ on body</em>`;
    it.card = card;
    tray.append(card);
    bindTrayDrag(card, it);
  }
}

function renderThumbs(meshes) {
  const out = new Map();
  let r;
  try { r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); } catch { return out; }
  r.setSize(140, 140); r.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445577, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.8); key.position.set(1, 2, 3); scene.add(key);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.001, 100);
  for (const m of meshes) {
    const clone = new THREE.Mesh(m.geometry, m.material.clone());
    clone.material.emissive?.setRGB(0, 0, 0);
    m.geometry.computeBoundingSphere();
    const sph = m.geometry.boundingSphere;
    clone.position.copy(sph.center).multiplyScalar(-1);
    scene.add(clone);
    const dist = sph.radius / Math.sin(THREE.MathUtils.degToRad(15)) * 1.05;
    cam.position.set(0, sph.radius * 0.15, dist); cam.lookAt(0, 0, 0);
    r.render(scene, cam);
    out.set(m.userData.slug, r.domElement.toDataURL('image/png'));
    scene.remove(clone); clone.material.dispose();
  }
  r.dispose(); r.forceContextLoss?.();
  return out;
}

function bindTrayDrag(card, it) {
  let d = null;
  card.addEventListener('pointerdown', (e) => {
    if (flowing || done || e.button > 0) return;
    d = { x: e.clientX, y: e.clientY, moved: false, ghost: null };
    card.setPointerCapture(e.pointerId);
  });
  card.addEventListener('pointermove', (e) => {
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 8) return;
    if (!d.moved) {
      d.moved = true;
      d.ghost = document.createElement('div');
      d.ghost.className = 'drag-ghost';
      d.ghost.innerHTML = card.querySelector('img').outerHTML + `<span>${esc(labels[it.slug] || it.slug)}</span>`;
      document.body.append(d.ghost);
      setSelected(it);
    }
    d.ghost.style.left = `${e.clientX}px`; d.ghost.style.top = `${e.clientY}px`;
    hoverSlot = overCanvas(e) ? nearestSlot(e.clientX, e.clientY, 90) : null;
  });
  const end = (e) => {
    if (!d) return;
    const { moved, ghost } = d;
    d = null;
    ghost?.remove();
    hoverSlot = null;
    if (!moved) { setSelected(selected === it ? null : it); return; }
    const slot = overCanvas(e) ? nearestSlot(e.clientX, e.clientY, 90) : null;
    if (slot) place(it, slot);
    setSelected(null);
    afterChange();
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('click', (e) => { if (e.detail === 0 && !flowing && !done) setSelected(selected === it ? null : it); });  // keyboard
  card.addEventListener('pointercancel', () => { d?.ghost?.remove(); d = null; hoverSlot = null; });
}

function overCanvas(e) {
  const r = canvas.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
}

// ------------------------------------------------------------------ placing
function sendToTray(it) {
  const prev = organAt[it.slug];
  if (prev) placements[prev] = null;
  organAt[it.slug] = null;
  it.mesh.visible = false;
  it.mesh.position.copy(it.mesh.userData.home);
  it.mesh.scale.setScalar(1);
}

/** Drop organ `it` on the spot `slotSlug`. Spots that share one place (a cluster) are interchangeable. */
function place(it, slotSlug) {
  const cluster = clusterOf.get(slotSlug) || [slotSlug];
  let target = slotSlug;
  if (cluster.includes(it.slug)) target = it.slug;                       // right place → snap into its own spot
  else if (placements[target]) target = cluster.find((s) => !placements[s]) || target;  // use a free spot in the group
  const occupant = placements[target];
  if (occupant && occupant !== it.slug) sendToTray(items.get(occupant));
  const prev = organAt[it.slug];
  if (prev) placements[prev] = null;
  placements[target] = it.slug;
  organAt[it.slug] = target;
  it.mesh.visible = true;
  it.mesh.position.copy(items.get(target).mesh.userData.home);
  it.mesh.scale.setScalar(1);
  sfx.place();
  if (!startTime) startTimer();
}

function afterChange() {
  updateCount();
  hideFeedback();
}

function updateCount() {
  const placed = Object.values(placements).filter(Boolean).length;
  $('#placed-count').textContent = `${placed} / ${items.size} placed`;
  for (const [slug, s] of slots) { s.marker.visible = !placements[slug]; if (s.line) s.line.visible = !placements[slug]; }
  for (const it of items.values()) it.card?.classList.toggle('placed', !!organAt[it.slug]);
  // name tags for organs on the body
  viewer.setCallouts([...items.values()].filter((it) => organAt[it.slug]).map((it) => ({ id: it.slug, text: labels[it.slug] || it.slug, mesh: it.mesh })));
  viewer.setCalloutActive(selected?.slug);
}

function startTimer() {
  startTime = Date.now();
  timerId = setInterval(() => {
    const s = Math.floor((Date.now() - startTime) / 1000);
    $('#timer').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 500);
}

function setSelected(it) {
  if (it && it !== selected) announce(it);
  if (selected) { selected.mesh.material.emissive.setRGB(0, 0, 0); selected.card?.classList.remove('selected'); }
  selected = it;
  if (it) { it.mesh.material.emissive.setRGB(0.25, 0.25, 0.05); it.card?.classList.add('selected'); }
  viewer.setCalloutActive(it?.slug);
  wrap.classList.toggle('placing', !!it);
}

/** Picked an organ: a little blip, then its name read out loud (both follow the sound switch). */
function announce(it) {
  sfx.pick();
  speak(labels[it.slug] || it.slug, { rate: 0.9, quiet: true });
}

// ------------------------------------------------------------------ sound
muteToggle($('#mute-btn'));
document.addEventListener('pointerdown', unlockAudio, { capture: true });
document.addEventListener('keydown', (e) => {
  if ((e.key === 'm' || e.key === 'M') && !e.target.closest?.('input, textarea')) { unlockAudio(); setMuted(!isMuted()); }
});

// ------------------------------------------------------------------ zoom & pan
function fitView() {
  view.zoom = 1; view.pan.set(0, 0);
  viewer.camera.zoom = 1; viewer.camera.updateProjectionMatrix();
  viewer.frameBox(sysBox, { duration: 0, padding: 1.3, direction: new THREE.Vector3(0, 0, 1) });
  view.basePos.copy(viewer.camera.position);
  view.baseTarget.copy(sysBox.getCenter(new THREE.Vector3()));
  // nudge the body down a little so the top spots sit clear of the mission banner
  const halfH = (view.basePos.z - view.baseTarget.z) * Math.tan(THREE.MathUtils.degToRad(viewer.camera.fov) / 2);
  view.basePos.y += halfH * 0.1; view.baseTarget.y += halfH * 0.1;
  applyView();
}
function applyView() {
  view.zoom = Math.min(5, Math.max(1, view.zoom));
  // keep the view inside the body: you can only pan as far as the zoomed-in view still shows part of the system
  const halfH = (view.basePos.z - view.baseTarget.z) * Math.tan(THREE.MathUtils.degToRad(viewer.camera.fov) / 2) / view.zoom;
  const halfW = halfH * viewer.camera.aspect;
  const limX = Math.max(0, sysSize.x / 2 - halfW * 0.5), limY = Math.max(0, sysSize.y / 2 - halfH * 0.5);
  view.pan.x = Math.max(-limX, Math.min(limX, view.pan.x));
  view.pan.y = Math.max(-limY, Math.min(limY, view.pan.y));
  if (view.zoom === 1) view.pan.set(0, 0);
  const cam = viewer.camera;
  cam.zoom = view.zoom; cam.updateProjectionMatrix();
  cam.position.set(view.basePos.x + view.pan.x, view.basePos.y + view.pan.y, view.basePos.z);
  cam.lookAt(view.baseTarget.x + view.pan.x, view.baseTarget.y + view.pan.y, view.baseTarget.z);
}
/** Zoom by `factor`, keeping the point under the cursor (container px) still. */
function zoomAt(factor, px = wrap.clientWidth / 2, py = wrap.clientHeight / 2) {
  const r = canvas.getBoundingClientRect();
  const before = planePoint(r.left + px, r.top + py);
  view.zoom *= factor; applyView();
  const after = planePoint(r.left + px, r.top + py);
  view.pan.x += before.x - after.x; view.pan.y += before.y - after.y; applyView();
}
function worldPerPixel() {
  const dist = view.basePos.z - dragPlaneZ;
  return (2 * dist * Math.tan(THREE.MathUtils.degToRad(viewer.camera.fov) / 2)) / (wrap.clientHeight * view.zoom);
}
$('#zoom-in').onclick = () => zoomAt(1.35);
$('#zoom-out').onclick = () => zoomAt(1 / 1.35);
$('#zoom-fit').onclick = () => fitView();
// full screen covers the body AND the organ box; re-fit once the new size has settled
fullscreenToggle($('#shell'), $('#fs-btn'), { onChange: () => setTimeout(() => { if (sysBox) fitView(); }, 120) });
document.addEventListener('keydown', (e) => { if ((e.key === 'f' || e.key === 'F') && !e.target.closest?.('input, textarea')) $('#fs-btn').click(); });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });

// ------------------------------------------------------------------ pointer on the body
const ray = new THREE.Raycaster();
function planePoint(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), viewer.camera);
  const p = new THREE.Vector3();
  ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -dragPlaneZ), p);
  return p;
}
/** Closest spot to the pointer, in screen pixels. Empty spots win over filled ones. */
function nearestSlot(clientX, clientY, maxPx = 80, emptyOnly = false) {
  const r = wrap.getBoundingClientRect();
  let best = null, bestD = maxPx;
  for (const [slug, s] of slots) {
    if (emptyOnly && placements[slug]) continue;
    const p = viewer.toScreen(placements[slug] ? items.get(slug).mesh.userData.home.clone().setZ(dragPlaneZ) : s.pos);
    const d = Math.hypot(p.x - (clientX - r.left), p.y - (clientY - r.top)) + (placements[slug] ? 25 : 0);
    if (d < bestD) { bestD = d; best = slug; }
  }
  return best;
}
function pickPlaced(clientX, clientY) {
  const placed = [...items.values()].filter((i) => organAt[i.slug]);
  const hit = viewer.pickAt(clientX, clientY, placed.map((i) => i.mesh));
  return hit ? items.get(hit.userData.slug) : null;
}

const pointers = new Map();
let drag = null, pinch = null;
canvas.addEventListener('pointerdown', (e) => {
  if (flowing || done) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  canvas.setPointerCapture(e.pointerId);
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y), z0: view.zoom };
    if (drag?.it && drag.moved) sendBack(drag);
    drag = null;
    return;
  }
  const it = pickPlaced(e.clientX, e.clientY);
  drag = it ? { kind: 'organ', it, x: e.clientX, y: e.clientY, moved: false, from: organAt[it.slug] }
    : { kind: 'pan', x: e.clientX, y: e.clientY, moved: false, pan0: view.pan.clone() };
});
canvas.addEventListener('pointermove', (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const r = canvas.getBoundingClientRect();
    const f = (pinch.z0 * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d0) / view.zoom;
    zoomAt(f, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
    return;
  }
  if (!drag) { hoverSlot = selected && !flowing ? nearestSlot(e.clientX, e.clientY, 80) : null; return; }
  if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
  drag.moved = true;
  if (drag.kind === 'organ') {
    const p = planePoint(e.clientX, e.clientY);
    drag.it.mesh.position.set(p.x, p.y, dragPlaneZ);
    hoverSlot = nearestSlot(e.clientX, e.clientY, 90);
  } else if (view.zoom > 1) {
    const k = worldPerPixel();
    view.pan.set(drag.pan0.x - (e.clientX - drag.x) * k, drag.pan0.y + (e.clientY - drag.y) * k);
    applyView();
  }
});
function sendBack(d) { place(d.it, d.from); }
const endPointer = (e) => {
  pointers.delete(e.pointerId);
  if (pinch) { if (pointers.size < 2) pinch = null; return; }
  if (!drag) return;
  const d = drag;
  drag = null;
  hoverSlot = null;
  if (d.kind === 'organ' && d.moved) {
    const slot = nearestSlot(e.clientX, e.clientY, 90);
    if (slot) place(d.it, slot); else { sendToTray(d.it); sfx.unplace(); }      // dropped away from every spot → back in the box
    setSelected(null);
  } else if (d.kind === 'organ') {
    // an empty glowing spot right under the finger wins over the organ drawn behind it
    const free = selected ? nearestSlot(e.clientX, e.clientY, 40, true) : null;
    if (free) { place(selected, free); setSelected(null); }
    else if (selected && selected !== d.it) { place(selected, organAt[d.it.slug]); setSelected(null); }  // swap in the chosen organ
    else setSelected(selected === d.it ? null : d.it);
  } else if (!d.moved && selected) {
    const slot = nearestSlot(e.clientX, e.clientY, 90);
    if (slot) { place(selected, slot); setSelected(null); }
  } else if (!d.moved) {
    setSelected(null);
  }
  afterChange();
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => { if (!drag) hoverSlot = null; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setSelected(null); });

$('#reset-btn').onclick = () => {
  if (flowing || done) return;
  for (const it of items.values()) sendToTray(it);
  setSelected(null); afterChange();
};

// ------------------------------------------------------------------ switch on: animate the flow
const particles = [];
function clearParticles() { for (const p of particles) viewer.scene.remove(p); particles.length = 0; }
function hideFeedback() {
  $('#feedback').classList.add('hidden');
  for (const it of items.values()) if (it !== selected) it.mesh.material.emissive.setRGB(0, 0, 0);
}

$('#switch-btn').onclick = async () => {
  if (flowing || done) return;
  if (!session.id) await session.start();
  if (!startTime) startTimer();
  attempts++;
  $('#tries').textContent = attempts;
  setSelected(null); hideFeedback();
  const result = checkPlacement(placements, order);

  // save answers: first try = every slot; later tries = just the slot that failed
  if (!firstCheckLogged) {
    for (const o of order) session.log({ slug: o.slug, promptType: 'placement', correct: placements[o.slug] === o.slug });
    firstCheckLogged = true;
  } else if (!result.complete) {
    session.log({ slug: result.failSlot, promptType: 'placement', correct: false });
  }

  flowing = true;
  sfx.flow();
  await animateFlow(result);
  flowing = false;

  if (result.complete) finish();
  else {
    const failMesh = result.placed ? items.get(result.placed).mesh : null;
    if (failMesh) failMesh.material.emissive.setRGB(0.6, 0.05, 0.05);
    else {
      alertSlot = result.failSlot;
      setTimeout(() => { alertSlot = null; }, 1800);
    }
    sfx.wrong();
    const fb = $('#feedback');
    fb.innerHTML = `<strong>🚧 Blocked!</strong> ${esc(builderHint(order, result, labels, substance))}`;
    fb.classList.remove('hidden');
    setTimeout(clearParticles, 1200);
  }
};

function pathPoints(upTo) {
  return order.slice(0, upTo + 1).map((o) => items.get(o.slug).mesh.userData.home.clone().setZ(dragPlaneZ));
}

function animateFlow(result) {
  return new Promise((resolve) => {
    clearParticles();
    const lastIndex = result.complete ? order.length - 1 : result.reached;
    const pts = pathPoints(lastIndex);
    if (pts.length < 2) pts.unshift(pts[0].clone().add(new THREE.Vector3(0, sysSize.y * 0.15, 0)));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const total = curve.getLength();
    const r = Math.max(sysSize.y * 0.009, 0.004);
    const N = 26;
    for (let i = 0; i < N; i++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), new THREE.MeshBasicMaterial({ color: COLORS[substance], depthTest: false }));
      p.renderOrder = 20; p.userData.offset = -i * 0.035; viewer.scene.add(p); particles.push(p);
    }
    const duration = Math.min(5000, 1200 + total * 2600);
    const start = performance.now();
    const off = viewer.onFrame(() => {
      const k = (performance.now() - start) / duration;
      for (const p of particles) {
        const u = Math.min(1, Math.max(0, k + p.userData.offset));
        p.visible = k + p.userData.offset > 0;
        p.position.copy(curve.getPointAt(u));
      }
      // light up organs the flow has passed
      const reachedIdx = Math.floor(Math.min(1, k) * (pts.length - 1));
      for (let i = 0; i <= reachedIdx && i < order.length; i++) {
        const it = items.get(placements[order[i].slug] || '');
        if (it && placements[order[i].slug] === order[i].slug) it.mesh.material.emissive.setRGB(0.05, 0.25, 0.08);
      }
      if (k >= 1 + N * 0.035) { off(); resolve(); }
    });
  });
}

// ------------------------------------------------------------------ win
async function finish() {
  done = true;
  clearInterval(timerId);
  const secs = Math.round((Date.now() - startTime) / 1000);
  const stars = builderStars(attempts);
  const score = builderScore(stars, secs, items.size);
  for (const it of items.values()) it.mesh.material.emissive.setRGB(0.08, 0.3, 0.1);
  sfx.win();
  celebrate(`${'⭐'.repeat(stars)} ${SYSTEMS[system].name} is working!`);
  await session.end({ score, stars, attempts });
  try { updateXp((await api.getMyProfile()).xp); } catch { /* ignore */ }
  const others = Object.keys(PATHWAYS).filter((s) => s !== system);
  setTimeout(() => {
    const o = $('#overlay');
    o.innerHTML = `<div class="card"><h2>It works! 🎉</h2>
      <div class="stars">${'⭐'.repeat(stars)}${'☆'.repeat(3 - stars)}</div>
      <p>The ${esc(substance)} made it all the way through in <strong>${attempts}</strong> ${attempts === 1 ? 'try' : 'tries'} (${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}).</p>
      <p class="muted">Score: <strong>${score}</strong>${stars < 3 ? ' · Get it right on the first try for 3 stars!' : ''}</p>
      <div class="row" style="justify-content:center;margin-top:14px">
        <button class="btn ghost" id="again-btn">Play again</button>
        ${others.map((s) => `<a class="btn secondary" href="${rootUrl(`student/system-builder.html?system=${s}`)}">${SYSTEMS[s].icon} ${SYSTEMS[s].name.replace(' system', '')}</a>`).join('')}
      </div></div>`;
    o.classList.remove('hidden');
    $('#again-btn').onclick = () => location.reload();
  }, 1600);
}
