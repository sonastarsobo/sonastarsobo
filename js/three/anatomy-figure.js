// A slowly spinning 3D human figure (skeleton outline + main organs) for the home and launch pages.
import { AnatomyViewer, THREE } from './viewer.js';

const ORGAN_SYSTEMS = ['circulatory', 'respiratory', 'digestive', 'urinary'];

/**
 * Mount the figure inside `container` (which should have a fixed height).
 * Returns the viewer, or null when WebGL is not available. Never throws: on a failed load the container's
 * fallback content (if any) stays visible.
 */
export async function mountAnatomyFigure(container, { level = 'simple', spin = 1.2, interactive = true } = {}) {
  let viewer;
  try { viewer = new AnatomyViewer(container, { autoRotate: true }); } catch { return null; }
  const c = viewer.controls;
  if (c) {
    c.autoRotateSpeed = spin;
    c.enableZoom = false;           // don't steal the page's scroll wheel
    c.enablePan = false;
    c.enabled = interactive;
    c.minPolarAngle = Math.PI * 0.3;
    c.maxPolarAngle = Math.PI * 0.7;
  }
  viewer.renderer.domElement.setAttribute('aria-hidden', 'true');
  try {
    const skeleton = viewer.loadSystem('skeletal', level, { ghost: true });
    const organs = ORGAN_SYSTEMS.map((s) => viewer.loadSystem(s, level).catch(() => null));
    const { root } = await skeleton;
    // a softer, glassy skeleton so the organs stand out
    root.traverse((m) => { if (m.isMesh) { m.material.opacity = 0.22; m.material.color.set(0xe8ecff); } });
    await Promise.all(organs);
    const box = new THREE.Box3().setFromObject(viewer.content);
    viewer.frameBox(box, { duration: 0, padding: 1.02, direction: new THREE.Vector3(0, 0.05, 1) });
    container.classList.add('figure-ready');
  } catch {
    container.classList.add('figure-failed');
  }
  return viewer;
}
