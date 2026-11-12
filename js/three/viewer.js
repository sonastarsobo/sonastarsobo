// Reusable three.js viewer used by Learn Mode, the games and the 3D test questions.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MODELS_BASE_URL } from '../config.js';
import { rootUrl } from '../supabase.js';
import { getSettings } from '../ui.js';

export { THREE };

const loader = new GLTFLoader();
const gltfCache = new Map();

export function modelUrl(system, level) {
  const path = `models/${system}-${level}.glb`;
  return MODELS_BASE_URL ? MODELS_BASE_URL + path : rootUrl(path);
}

/** Load a system GLB (cached). Returns a fresh clone each time with its own materials. */
export async function loadSystemScene(system, level, onProgress) {
  const url = modelUrl(system, level);
  if (!gltfCache.has(url)) {
    gltfCache.set(url, loader.loadAsync(url, (e) => onProgress?.(e.total ? e.loaded / e.total : 0)).catch((err) => {
      gltfCache.delete(url);
      throw new Error(`Could not load 3D model ${url}. Is the models folder uploaded? (${err.message || err})`);
    }));
  }
  const gltf = await gltfCache.get(url);
  const root = gltf.scene.clone(true);
  const organs = new Map();
  root.traverse((obj) => {
    if (obj.isMesh) {
      // GLTFLoader keeps the original node name in userData.name and may add "_1" to obj.name
      const slug = String(obj.userData.name || obj.name).replace(/_\d+$/, '');
      obj.name = slug;
      obj.material = obj.material.clone();
      obj.userData.baseColor = obj.material.color.clone();
      obj.userData.home = obj.position.clone();
      obj.userData.slug = slug;
      organs.set(slug, obj);
    }
  });
  return { root, organs };
}

export class AnatomyViewer {
  constructor(container, { controls = true, autoRotate = false, fov = 35 } = {}) {
    this.container = container;
    const low = getSettings().lowGraphics;
    this.renderer = new THREE.WebGLRenderer({ antialias: !low, alpha: true, powerPreference: low ? 'low-power' : 'default' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, low ? 1 : 1.75));
    this.renderer.setClearColor(0x000000, 0);
    container.prepend(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(fov, 1, 0.005, 50);
    this.camera.position.set(0, 1.1, 2.4);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4466, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(1.5, 3, 3); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xbfd4ff, 0.7); rim.position.set(-2, 1, -3); this.scene.add(rim);

    this.controls = null;
    if (controls) {
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
      this.controls.autoRotate = autoRotate;
      this.controls.autoRotateSpeed = 0.8;
      this.controls.minDistance = 0.05;
      this.controls.maxDistance = 8;
    }

    this.content = new THREE.Group();
    this.scene.add(this.content);
    this.organs = new Map();        // slug -> mesh (pickable organs)
    this.ghosts = [];
    this.selected = null;
    this.xray = 1;                  // opacity of organs that are NOT selected
    this.frameCallbacks = new Set();
    this.labels = new Map();
    this.raycaster = new THREE.Raycaster();
    this._tween = null;
    this._clock = new THREE.Clock();

    this._resize = () => {
      const w = container.clientWidth || 1, h = container.clientHeight || 1;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    this._ro = new ResizeObserver(this._resize);
    this._ro.observe(container);
    this._resize();

    this._loop = this._loop.bind(this);
    this.renderer.setAnimationLoop(this._loop);
  }

  _loop() {
    const dt = Math.min(this._clock.getDelta(), 0.1);
    const t = this._clock.elapsedTime;
    if (this._tween) this._stepTween();
    for (const fn of this.frameCallbacks) fn(dt, t);
    if (this.selected && !document.documentElement.classList.contains('reduce-motion')) {
      const k = 0.18 + 0.12 * Math.sin(t * 4);
      this.selected.material.emissive.copy(this.selected.userData.baseColor).multiplyScalar(k);
    }
    this.controls?.update();
    this.renderer.render(this.scene, this.camera);
    this._updateLabels();
    this._updateCallouts();
  }

  onFrame(fn) { this.frameCallbacks.add(fn); return () => this.frameCallbacks.delete(fn); }

  clear() {
    this.content.clear();
    this.organs = new Map();
    this.ghosts = [];
    this.selected = null;
    this.clearLabels();
    this.clearCallouts();
  }

  /** Load a body system into the viewer. ghost=true → faint, not clickable (context like the skeleton). */
  async loadSystem(system, level, { ghost = false, onProgress } = {}) {
    const { root, organs } = await loadSystemScene(system, level, onProgress);
    if (ghost) {
      for (const m of organs.values()) {
        m.material.transparent = true; m.material.opacity = 0.12; m.material.depthWrite = false;
        m.renderOrder = -1; m.userData.ghost = true;
      }
      this.ghosts.push(root);
    } else {
      for (const [slug, m] of organs) this.organs.set(slug, m);
    }
    this.content.add(root);
    return { root, organs };
  }

  removeObject(obj) { obj?.parent?.remove(obj); this.ghosts = this.ghosts.filter((g) => g !== obj); }

  /** Smoothly move the camera to show `objects` (meshes) — or everything when omitted. */
  frame(objects = null, { duration = 650, padding = 1.25, direction = new THREE.Vector3(0, 0.12, 1) } = {}) {
    const box = new THREE.Box3();
    const list = objects ? [].concat(objects) : [...this.organs.values()];
    if (!list.length) return;
    for (const o of list) box.expandByObject(o);
    this.frameBox(box, { duration, padding, direction });
  }

  frameBox(box, { duration = 650, padding = 1.25, direction = new THREE.Vector3(0, 0.12, 1) } = {}) {
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius, 0.03);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const fitH = r / Math.sin(fov / 2);
    const fitW = fitH / Math.min(1, this.camera.aspect);
    const dist = Math.max(fitH, fitW) * padding;
    const target = sphere.center.clone();
    const pos = target.clone().add(direction.clone().normalize().multiplyScalar(dist));
    if (duration <= 0 || document.documentElement.classList.contains('reduce-motion')) {
      this.camera.position.copy(pos);
      if (this.controls) this.controls.target.copy(target); else this.camera.lookAt(target);
      return;
    }
    this._tween = {
      t0: performance.now(), duration,
      fromPos: this.camera.position.clone(), toPos: pos,
      fromTarget: this.controls ? this.controls.target.clone() : target.clone(), toTarget: target,
    };
  }

  _stepTween() {
    const tw = this._tween;
    const k = Math.min(1, (performance.now() - tw.t0) / tw.duration);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    this.camera.position.lerpVectors(tw.fromPos, tw.toPos, e);
    const tgt = new THREE.Vector3().lerpVectors(tw.fromTarget, tw.toTarget, e);
    if (this.controls) this.controls.target.copy(tgt); else this.camera.lookAt(tgt);
    if (k >= 1) this._tween = null;
  }

  /** Raycast at a screen point; returns the organ mesh hit (or null). */
  pickAt(clientX, clientY, objects = null) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const list = (objects || [...this.organs.values()]).filter((o) => o.visible && !(o.material.opacity < 0.2 && o.material.transparent && o !== this.selected));
    const hits = this.raycaster.intersectObjects(list, false);
    return hits[0]?.object || null;
  }

  /** Like pickAt, but returns the full hit ({ object, point } in world space) or null. */
  pickHit(clientX, clientY, objects = null) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const list = (objects || [...this.organs.values()]).filter((o) => o.visible && !(o.material.opacity < 0.2 && o.material.transparent && o !== this.selected));
    return this.raycaster.intersectObjects(list, false)[0] || null;
  }

  /** Call cb(mesh|null, event) on a click/tap that wasn't a drag (so orbiting doesn't select). */
  onTap(cb) {
    const el = this.renderer.domElement;
    let down = null;
    el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    el.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (moved < 7 && performance.now() - down.t < 600) cb(this.pickAt(e.clientX, e.clientY), e);
      down = null;
    });
  }

  /** Highlight one organ (by slug or mesh), dim the rest according to the x-ray setting. */
  select(target) {
    const mesh = typeof target === 'string' ? this.organs.get(target) : target;
    if (this.selected) this.selected.material.emissive.setRGB(0, 0, 0);
    this.selected = mesh || null;
    this._applyOpacity();
  }

  setXray(opacity) { this.xray = opacity; this._applyOpacity(); }

  _applyOpacity() {
    for (const m of this.organs.values()) {
      const op = !this.selected || m === this.selected ? 1 : this.xray;
      m.material.transparent = op < 1;
      m.material.opacity = op;
      m.material.depthWrite = op >= 1;
      m.renderOrder = op < 1 ? 1 : 0;
    }
    if (this.selected) this.selected.material.emissive.copy(this.selected.userData.baseColor).multiplyScalar(0.25);
  }

  setVisible(slug, visible) { const m = this.organs.get(slug); if (m) m.visible = visible; }

  /** Screen position (container pixels) of a world point. */
  toScreen(vec3) {
    const v = vec3.clone().project(this.camera);
    const w = this.container.clientWidth, h = this.container.clientHeight;
    return { x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h, visible: v.z < 1 && v.z > -1 };
  }

  worldCenter(mesh) {
    return new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
  }

  /** Floating HTML label that follows a mesh (or a fixed world point). */
  addLabel(id, text, target, className = 'viewer-label') {
    this.removeLabel(id);
    const div = document.createElement('div');
    div.className = className;
    div.textContent = text;
    this.container.append(div);
    this.labels.set(id, { div, target });
    return div;
  }
  removeLabel(id) { const l = this.labels.get(id); if (l) { l.div.remove(); this.labels.delete(id); } }
  clearLabels() { for (const id of [...this.labels.keys()]) this.removeLabel(id); }

  _updateLabels() {
    for (const { div, target } of this.labels.values()) {
      const p = target.isVector3 ? target : this.worldCenter(target);
      const s = this.toScreen(p);
      div.style.display = s.visible ? '' : 'none';
      div.style.left = `${s.x}px`;
      div.style.top = `${s.y}px`;
    }
  }

  // ---------------------------------------------------------------- callout labels
  /**
   * Labels placed in columns to the left/right of the model, each joined to its part by a leader line.
   * items: [{ id, text, mesh }]
   */
  setCallouts(items) {
    this.clearCallouts();
    if (!items.length) return;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'callout-layer');
    this.container.append(svg);
    const box = new THREE.Box3();
    const list = items.map(({ id, text, mesh }) => {
      mesh.updateWorldMatrix(true, false);
      box.expandByObject(mesh);
      const div = document.createElement('div');
      div.className = 'callout-label';
      div.textContent = text;
      this.container.append(div);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('r', '3.5');
      svg.append(line, dot);
      return { id, div, line, dot, mesh, anchor: anchorPoint(mesh), w: 0, h: 0 };
    });
    const corners = [];
    for (let i = 0; i < 8; i++) corners.push(new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
    this.callouts = { svg, list, corners };
  }

  setCalloutActive(id) {
    for (const c of this.callouts?.list || []) c.div.classList.toggle('active', c.id === id);
  }

  clearCallouts() {
    if (!this.callouts) return;
    this.callouts.svg.remove();
    for (const c of this.callouts.list) c.div.remove();
    this.callouts = null;
  }

  _updateCallouts() {
    const co = this.callouts;
    if (!co) return;
    const W = this.container.clientWidth, H = this.container.clientHeight;
    let minX = Infinity, maxX = -Infinity;
    for (const p of co.corners) { const s = this.toScreen(p); minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x); }
    const cx = (minX + maxX) / 2, gapOut = 36, margin = 8;
    const sides = { L: [], R: [] };
    for (const c of co.list) {
      if (!c.w) { c.w = c.div.offsetWidth; c.h = c.div.offsetHeight || 24; }
      const world = c.anchor.clone().applyMatrix4(c.mesh.matrixWorld);
      const s = this.toScreen(world);
      const show = c.mesh.visible && s.visible && s.x > -20 && s.x < W + 20 && s.y > -20 && s.y < H + 20;
      c.s = s; c.show = show;
      if (show) sides[s.x < cx ? 'L' : 'R'].push(c);
    }
    // keep each column inside the viewer; prefer the side with room
    const leftEdge = Math.max(margin, minX - gapOut);
    const rightEdge = Math.min(W - margin, maxX + gapOut);
    for (const [side, arr] of Object.entries(sides)) {
      arr.sort((a, b) => a.s.y - b.s.y);
      let y = -Infinity;
      for (const c of arr) { y = Math.max(c.s.y, y + c.h + 6, margin + c.h / 2); c.y = y; }
      let next = Infinity;      // pull back up if the column runs off the bottom
      for (let i = arr.length - 1; i >= 0; i--) {
        const c = arr[i];
        c.y = Math.min(c.y, next - c.h - 6, H - margin - c.h / 2);
        next = c.y;
      }
      for (const c of arr) {
        const x = side === 'L' ? Math.max(margin, leftEdge - c.w) : Math.min(W - margin - c.w, rightEdge);
        const lineX = side === 'L' ? x + c.w : x;
        c.div.style.left = `${x}px`;
        c.div.style.top = `${c.y}px`;
        c.line.setAttribute('x1', c.s.x); c.line.setAttribute('y1', c.s.y);
        c.line.setAttribute('x2', lineX); c.line.setAttribute('y2', c.y);
        c.dot.setAttribute('cx', c.s.x); c.dot.setAttribute('cy', c.s.y);
      }
    }
    for (const c of co.list) {
      const d = c.show ? '' : 'none';
      c.div.style.display = d; c.line.style.display = d; c.dot.style.display = d;
    }
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this._ro.disconnect();
    this.controls?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.clearLabels();
    this.clearCallouts();
  }
}

/** A point that lies ON the mesh (the vertex nearest its centre), in local space — so leader lines touch the part. */
function anchorPoint(mesh) {
  const geo = mesh.geometry;
  geo.computeBoundingBox();
  const center = geo.boundingBox.getCenter(new THREE.Vector3());
  const pos = geo.attributes.position;
  if (!pos) return center;
  const step = Math.max(1, Math.floor(pos.count / 5000));
  const v = new THREE.Vector3(), best = new THREE.Vector3();
  let bestD = Infinity;
  for (let i = 0; i < pos.count; i += step) {
    v.fromBufferAttribute(pos, i);
    const d = v.distanceToSquared(center);
    if (d < bestD) { bestD = d; best.copy(v); }
  }
  return best;
}

/** Show a loading overlay inside a viewer container. Returns { set(text|progress), done() }. */
export function loadingOverlay(container, text = 'Loading 3D model…', tip = '') {
  const box = document.createElement('div');
  box.className = 'loading';
  box.innerHTML = `<div><div class="spinner"></div><div class="lt">${text}</div><div class="small" style="opacity:.8;max-width:380px;margin-top:8px">${tip}</div></div>`;
  container.append(box);
  return {
    set(p) { box.querySelector('.lt').textContent = typeof p === 'number' ? `${text} ${Math.round(p * 100)}%` : p; },
    done() { box.remove(); },
    error(msg) { box.innerHTML = `<div style="max-width:420px">⚠️ ${msg}</div>`; },
  };
}
