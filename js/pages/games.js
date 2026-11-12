// Game hub: pick a game and a body system; shows best scores.
import { requireRole } from '../auth.js';
import * as api from '../api.js';
import { rootUrl } from '../supabase.js';
import { SYSTEMS, SYSTEM_ORDER, PATHWAYS } from '../data/pathways.js';
import { esc, levelLabel, errorToast } from '../ui.js';

await requireRole(['student']);
const app = document.getElementById('app');
const [level, sessions] = await Promise.all([api.getMyLevel(), api.getGameSessions(null, 200)]).catch((e) => { errorToast(e); throw e; });

const best = (game, system) => Math.max(0, ...sessions.filter((s) => s.game === game && s.system === system).map((s) => s.score));
const bestStars = (system) => Math.max(0, ...sessions.filter((s) => s.game === 'system_builder' && s.system === system).map((s) => s.stars || 0));
const blasterSystems = SYSTEM_ORDER.filter((s) => s !== 'reproductive' || level === 'full');
const builderSystems = Object.keys(PATHWAYS);

app.innerHTML = `
<h1>🎮 Games</h1>
<p class="muted">Level: ${esc(levelLabel(level))} · Every answer you give helps your teacher see what to review.</p>
<div class="grid cols-2" style="align-items:start">
  <section class="card">
    <div class="row between"><h2 style="margin:0">🎯 Organ Blaster</h2><span class="pill primary">Trains: Identify</span></div>
    <p>Pilot a nanobot through the body's tunnels. An organ is named — or, in later waves, only its job is described — and organs
      weave toward you. Shoot the right one before the clock runs out: every hit wins back time. Pick Easy, Normal or Hard and
      climb your class leaderboard 🏆.</p>
    <p class="small muted">Desktop: move the mouse to aim, click to fire (or arrow keys + space). Tablet: tap an organ. Sound and full screen available.</p>
    <div class="grid cols-2">${blasterSystems.map((s) => `
      <a class="card flat tile" href="${rootUrl(`student/organ-blaster.html?system=${s}`)}">
        <div class="row between"><strong>${SYSTEMS[s].icon} ${SYSTEMS[s].name.replace(' system', '')}</strong>
        <span class="small muted">Best ${best('organ_blaster', s)}</span></div></a>`).join('')}</div>
  </section>
  <section class="card">
    <div class="row between"><h2 style="margin:0">🧩 System Builder</h2><span class="pill success">Trains: Understand</span></div>
    <p>Put a body system back together, then switch it on. Food, air, blood or urine flows through the organs you placed — and only makes it
      all the way when every organ is in the right spot.</p>
    <p class="small muted">Drag organs from the tray onto the glowing spots (or tap an organ, then tap a spot).</p>
    <div class="grid cols-2">${builderSystems.map((s) => `
      <a class="card flat tile" href="${rootUrl(`student/system-builder.html?system=${s}`)}">
        <div class="row between"><strong>${SYSTEMS[s].icon} ${SYSTEMS[s].name.replace(' system', '')}</strong>
        <span>${'⭐'.repeat(bestStars(s))}${'☆'.repeat(3 - bestStars(s))}</span></div>
        <div class="small muted">Flow: ${PATHWAYS[s].substance}</div></a>`).join('')}</div>
  </section>
</div>`;
