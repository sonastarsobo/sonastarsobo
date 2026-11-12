// Landing page: send signed-in users to their dashboard, everyone else sees the intro.
import { supabase, isConfigured, rootUrl } from '../supabase.js';
import { dashboardFor, getProfile } from '../auth.js';
import { SYSTEMS, SYSTEM_ORDER } from '../data/pathways.js';
import { renderPublicBar } from '../ui.js';

const app = document.getElementById('app');

if (isConfigured) {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    try { const p = await getProfile(); if (p) location.replace(dashboardFor(p.role)); } catch { /* show intro */ }
  }
}

renderPublicBar('home');
app.innerHTML = `
  <section class="hero home-hero">
    <div class="home-hero-text">
      <div class="pill" style="background:rgba(255,255,255,.2);color:#fff">🎓 For grades 4–7</div>
      <h1>Explore the human body in 3D</h1>
      <p class="muted">Spin a real 3D body, discover what every organ does, pilot a nanobot through the
        bloodstream and rebuild body systems — while your teacher sees how you are doing.</p>
      <div class="row" style="margin-top:20px">
        <a class="btn big hero-btn" href="${rootUrl('login.html?tab=student')}">🧒 I'm a student</a>
        <a class="btn big ghost hero-btn-ghost" href="${rootUrl('login.html?tab=teacher')}">👩‍🏫 I'm a teacher</a>
      </div>
      <div class="home-hero-facts">
        <span>🧬 8 body systems</span><span>🔬 Real 3D anatomy models</span><span>🎮 2 games</span><span>📝 3D tests</span>
      </div>
    </div>
    <div class="home-art">
      <!-- image placeholder: replace assets/img/anatomy-placeholder.svg with the final picture -->
      <img src="${rootUrl('assets/img/anatomy-placeholder.svg')}" alt="Illustration of the human body and its organs">
    </div>
  </section>

  <section class="grid cols-4" style="margin-top:24px">
    <div class="card"><div class="icon" style="font-size:2em">🔍</div><h3>Learn mode</h3><p class="muted">Tap any organ to see where it is, what it does and a fun fact. Read-aloud included.</p></div>
    <div class="card"><div class="icon" style="font-size:2em">🎯</div><h3>Organ Blaster</h3><p class="muted">Shoot the right organ before it drifts past your nanobot.</p></div>
    <div class="card"><div class="icon" style="font-size:2em">🧩</div><h3>System Builder</h3><p class="muted">Put a body system back together and switch it on.</p></div>
    <div class="card"><div class="icon" style="font-size:2em">📝</div><h3>Tests</h3><p class="muted">Every question is answered on the 3D model — click the organ or label the parts. Marked instantly.</p></div>
  </section>

  <section class="card" style="margin-top:24px">
    <h2>8 body systems, 3 levels</h2>
    <p class="muted">Explorer (grade 4), Investigator (grades 5–6) and Expert (grade 7) — the 3D models and questions get more detailed as you grow.</p>
    <div class="chips">${SYSTEM_ORDER.map((s) => `<span class="chip">${SYSTEMS[s].icon} ${SYSTEMS[s].name}</span>`).join('')}</div>
  </section>
  <footer class="footer"><a href="${rootUrl('credits.html')}">Credits &amp; privacy</a> · 3D models adapted from Z-Anatomy (CC BY-SA 4.0)</footer>
`;
