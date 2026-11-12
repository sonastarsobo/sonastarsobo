// About the project — a simple, readable article. Open to everyone (signed in or not).
import { isConfigured, rootUrl } from '../supabase.js';
import { getProfile } from '../auth.js';
import { SYSTEMS, SYSTEM_ORDER } from '../data/pathways.js';
import { LEVELS, esc, renderTopbar, renderPublicBar } from '../ui.js';

let profile = null;
if (isConfigured) { try { profile = await getProfile(); } catch { profile = null; } }
if (profile) renderTopbar(profile); else renderPublicBar('about');

const start = profile ? rootUrl(profile.role === 'student' ? 'student/dashboard.html' : 'teacher/dashboard.html') : rootUrl('login.html');

document.getElementById('app').innerHTML = `
<article class="about-article">
  <header class="about-head">
    <div class="about-logos">
      <img src="${rootUrl('assets/img/sobo-logo.svg')}" alt="SOBO logo">
      <img src="${rootUrl('assets/img/sona-star-logo.svg')}" alt="Sona Star logo">
    </div>
    <p class="about-kicker">About the project</p>
    <h1>SOBO — the human body you can explore</h1>
    <p class="about-lead">SOBO is a 3D learning website for students in grades 4–7. Instead of looking at flat pictures in a textbook,
      students spin, zoom and click on real 3D anatomy models, play games that check what they know, and take tests that are
      answered directly on the model. Teachers can see exactly which organs each student finds hard.</p>
  </header>

  <h2>🎯 Why we made it</h2>
  <p>Body systems are hard to picture from 2D diagrams. Students often learn the names of organs but can't say where an organ
    sits, how it connects to the others, or how food, air and blood travel through the body.</p>
  <p>SOBO joins learning, playing and testing on the same 3D models, so students see the body the way it really is — and every
    answer they give helps their teacher know what to review next.</p>

  <h2>🧭 How it works</h2>
  <ol class="about-steps">
    <li><strong>Learn.</strong> Explore each body system in 3D. Tap any organ to see where it is, what it does and a fun fact —
      with labels, a guided tour and read-aloud.</li>
    <li><strong>Play.</strong> Shoot the right organ in <em>Organ Blaster</em>, and rebuild a whole system in <em>System Builder</em>
      to watch food, air, blood or urine flow through it.</li>
    <li><strong>Test.</strong> Every question is answered on the 3D model: click the right organ, or match numbered markers to
      their names. Tests are marked instantly.</li>
    <li><strong>Review.</strong> Teachers see each student's progress, weak spots and missed questions, and can make their own
      3D questions.</li>
  </ol>

  <h2>🧬 What students can explore</h2>
  <p>Eight body systems: ${SYSTEM_ORDER.map((s) => `${SYSTEMS[s].icon}&nbsp;${esc(SYSTEMS[s].name.replace(' system', ''))}`).join(', ')}.</p>
  <p>Three levels that grow with the student — the models and questions get more detailed at each step:</p>
  <ul>
    ${Object.values(LEVELS).map((l) => `<li><strong>${esc(l.name)}</strong> — ${esc(l.grades)}</li>`).join('')}
  </ul>

  <h2>✨ Features</h2>
  <ul>
    <li>Interactive 3D models of every system, with x-ray view and a skeleton outline</li>
    <li>Labels with leader lines, and a front view of each organ</li>
    <li>Read-aloud and spoken organ names, with one switch to mute everything</li>
    <li>Organ Blaster with three difficulty levels, sound effects and a class leaderboard</li>
    <li>System Builder that shows how each system works from start to finish</li>
    <li>3D-only tests and practice tests, marked instantly</li>
    <li>XP, streaks and badges to keep students motivated</li>
    <li>Bigger text, high contrast, reduced motion and a low-graphics mode</li>
  </ul>

  <h2>🔒 Safe for students</h2>
  <p>Students sign in with a username — no email address is needed. Only a student's own teachers can see their progress.
    There is no chat, no public profile and no advertising. More details are on the
    <a href="${rootUrl('credits.html')}">Credits &amp; privacy</a> page.</p>

  <h2>🛠️ Built with</h2>
  <p><strong>three.js</strong> draws the 3D models in the browser, <strong>Supabase</strong> stores accounts, classes, progress and
    test results, and the anatomy models are adapted from <strong>Z-Anatomy</strong> (CC BY-SA 4.0). SOBO runs in any modern
    browser — there is nothing to install.</p>

  <div class="about-cta">
    <a class="btn big" href="${start}">${profile ? '🏠 Back to SOBO' : '🚀 Get started'}</a>
    ${profile ? '' : `<a class="btn big ghost" href="${rootUrl('index.html')}">🏠 Home</a>`}
  </div>
</article>
${profile ? '' : `<footer class="footer"><a href="${rootUrl('credits.html')}">Credits &amp; privacy</a> · 3D models adapted from Z-Anatomy (CC BY-SA 4.0)</footer>`}
`;
