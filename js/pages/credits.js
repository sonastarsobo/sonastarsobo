// Credits, licences and privacy information.
import { rootUrl, isConfigured } from '../supabase.js';
import { getProfile } from '../auth.js';
import { renderTopbar, renderPublicBar } from '../ui.js';

let profile = null;
if (isConfigured) { try { profile = await getProfile(); } catch { profile = null; } }
if (profile) renderTopbar(profile); else renderPublicBar('credits');

document.getElementById('app').innerHTML = `
<h1 style="margin-top:6px">📜 Credits &amp; privacy</h1>
<div class="grid cols-2" style="align-items:start">
  <section class="card">
    <h2>3D models</h2>
    <p>3D anatomy models adapted from <a href="https://www.z-anatomy.com" target="_blank" rel="noopener">Z-Anatomy</a>,
      licensed under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>.</p>
    <p class="muted">Changes made: structures grouped into organs, simplified for three grade levels and recoloured.
      The adapted models are shared under the same CC BY-SA 4.0 licence.</p>
    <h2>Software</h2>
    <p class="muted">Built with <a href="https://threejs.org" target="_blank" rel="noopener">three.js</a> (MIT) and
      <a href="https://supabase.com" target="_blank" rel="noopener">Supabase</a>. Font: Nunito (SIL Open Font License).</p>
  </section>
  <section class="card">
    <h2>Privacy (for students, parents and teachers)</h2>
    <ul>
      <li>Students don't need an email address. They only give a first name, a username and a password.</li>
      <li>We store learning progress, game scores and test answers so students and their teachers can see progress.</li>
      <li>A student's data is only visible to that student and the teachers of their classes.</li>
      <li>There is no chat, no public profile and no advertising.</li>
      <li>Accessibility settings are stored only on this device.</li>
      <li>To delete an account and its data, ask your teacher or school administrator.</li>
    </ul>
  </section>
</div>`;
