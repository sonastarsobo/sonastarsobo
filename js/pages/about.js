// About SOBO — a simple, readable article. Open to everyone (signed in or not).
import { isConfigured, rootUrl } from '../supabase.js';
import { getProfile } from '../auth.js';
import { renderTopbar, renderPublicBar } from '../ui.js';

let profile = null;
if (isConfigured) { try { profile = await getProfile(); } catch { profile = null; } }
if (profile) renderTopbar(profile); else renderPublicBar('about');

const start = profile ? rootUrl(profile.role === 'student' ? 'student/dashboard.html' : 'teacher/dashboard.html') : rootUrl('login.html');

// Photo placeholders: put the official photos in assets/img/ and set `photo` below
// (e.g. photo: 'assets/img/thyagu-valliappa.jpg'). Until then the initials are shown.
const PEOPLE = [
  { heading: 'The Vision Behind SOBO', name: 'Mr. Thyagu Valliappa', role: 'CEO, Sona Star Innovation', initials: 'TV', photo: '',
    text: 'Envisioned SOBO and laid its foundation with a forward-thinking approach and a commitment to innovation in education.' },
  { heading: 'Guidance & Mentorship', name: 'Mr. Rabindra Sah', role: 'Mentor, SOBO', initials: 'RS', photo: '',
    text: 'Guided the SOBO team with invaluable mentorship and continuous support throughout the development journey.' },
];

const person = (p) => `
  <div class="about-person">
    ${p.photo
      ? `<img class="about-photo" src="${rootUrl(p.photo)}" alt="${p.name}">`
      : `<div class="about-photo" role="img" aria-label="Photo of ${p.name} (placeholder)">${p.initials}</div>`}
    <div>
      <p class="about-kicker">${p.heading}</p>
      <h3>${p.name}</h3>
      <p class="about-role">${p.role}</p>
      <p>${p.text}</p>
    </div>
  </div>`;

document.getElementById('app').innerHTML = `
<article class="about-article">
  <header class="about-head">
    <div class="about-logos">
      <img src="${rootUrl('assets/img/sobo-logo.svg')}" alt="SOBO logo">
      <img src="${rootUrl('assets/img/sona-star-logo.svg')}" alt="Sona Star Innovation logo">
    </div>
    <p class="about-kicker">About SOBO</p>
    <h1>Discover. Explore. Understand.</h1>
    <p class="about-lead">Transforming the way students learn human anatomy through interactive technology.</p>
    <p>SOBO is an innovative, web-based anatomy learning and assessment platform developed as an initiative of
      <strong>Sona Star Innovation</strong>, with a vision to make human anatomy education more engaging, accessible, and
      meaningful for students.</p>
    <p>By combining interactive 3D visualization, exploratory learning, and gamified assessments, SOBO aims to transform
      traditional learning into an immersive educational experience where students can explore, understand, and apply their
      knowledge.</p>
  </header>

  <h2><span class="about-num">01</span> Our Story — How SOBO Began</h2>
  <p class="about-quote">Every innovation begins with a vision to make something better.</p>
  <p>SOBO was born from the vision of <strong>Mr. Thyagu Valliappa</strong>, CEO of Sona Star Innovation, who recognized the
    potential of emerging technologies to transform the way students experience education.</p>
  <p>Traditional methods of learning human anatomy often rely on textbooks, illustrations, and static diagrams, making it
    challenging for students to visualize the human body's complex structures and understand how they work together.</p>
  <p>The idea behind SOBO was simple yet powerful: <em>What if students could explore the human body rather than just read
    about it?</em></p>
  <p>With this vision, the SOBO initiative was undertaken by Sona Star Innovation and brought to life under the valuable
    guidance and mentorship of <strong>Mr. Rabindra Sah</strong>.</p>
  <p>Through collaborative efforts, technical innovation, and a shared passion for education, the development team
    transformed this idea into an interactive learning platform designed to bridge the gap between theoretical knowledge and
    visual understanding.</p>

  <h2><span class="about-num">02</span> Our Mission</h2>
  <p class="about-quote">To make anatomy education interactive, accessible, and engaging for every learner.</p>
  <p>Our mission is to empower students with digital learning experiences that encourage curiosity, strengthen conceptual
    understanding, and make learning more enjoyable.</p>
  <p>We believe that students learn better when they can actively explore, interact, and discover concepts for themselves.</p>

  <h2><span class="about-num">03</span> Why SOBO?</h2>
  <p>SOBO goes beyond conventional learning methods by creating an environment where students actively participate in their
    educational journey.</p>
  <ul>
    <li><strong>🧬 Interactive 3D Anatomy</strong> — Explore human body systems and anatomical structures through interactive
      3D models that support visual understanding.</li>
    <li><strong>🔍 Explore and Learn</strong> — Select different body systems, examine individual structures, and discover their
      functions through an intuitive learning interface.</li>
    <li><strong>🎮 Gamified Assessments</strong> — Reinforce knowledge through engaging activities and interactive challenges
      that make learning both educational and enjoyable.</li>
    <li><strong>📈 Learning Progress</strong> — Track assessment performance and learning achievements to encourage continuous
      improvement.</li>
    <li><strong>🌐 Accessible Web-Based Learning</strong> — Experience anatomy education directly through a web browser without
      requiring specialized software.</li>
  </ul>

  <h3>Designed for Young Minds</h3>
  <p>SOBO's school student edition is designed for learners from <strong>Grades 4 to 7</strong>, introducing human anatomy in
    an age-appropriate, visually engaging, and interactive environment.</p>
  <p>Rather than relying solely on memorization, students are encouraged to explore human body systems, identify anatomical
    structures, and understand their functions through hands-on digital experiences.</p>
  <p>By combining learning with interactive assessments, SOBO aims to build curiosity, improve knowledge retention, and develop
    a stronger foundation in science.</p>

  <h2><span class="about-num">04</span> Our Vision &amp; Acknowledgements</h2>
  <h3>Our Vision for the Future</h3>
  <p>SOBO is more than an anatomy learning platform. It represents a step toward a future where education becomes
    increasingly interactive, experiential, and technology-driven.</p>
  <p>Beginning with school-level anatomy education, our vision is to expand SOBO into a comprehensive learning ecosystem that
    supports advanced anatomy education for medical students and other learners.</p>
  <p>As SOBO evolves, we aim to introduce deeper anatomical exploration, advanced assessments, and innovative learning
    experiences that continue to bridge the gap between education and technology.</p>

  <div class="about-people">${PEOPLE.map(person).join('')}</div>

  <h3>Acknowledgements</h3>
  <p>SOBO is an initiative of <strong>Sona Star Innovation</strong>, envisioned by <strong>Mr. Thyagu Valliappa</strong>, CEO,
    whose forward-thinking approach and commitment to innovation laid the foundation for this educational platform.</p>
  <p>We extend our sincere gratitude to <strong>Mr. Rabindra Sah</strong> for his invaluable guidance, mentorship, and
    continuous support throughout the development journey.</p>
  <p>We also acknowledge the dedication and collaborative efforts of the <strong>SOBO development team</strong>, whose
    technical expertise, creativity, and commitment helped bring this vision to life.</p>

  <div class="about-closing">
    <p class="about-closing-title">SOBO — Learn Beyond the Textbook.</p>
    <p>Explore the human body. Discover how it works. Make learning an experience.</p>
  </div>

  <div class="about-cta">
    <a class="btn big" href="${start}">${profile ? '🏠 Back to SOBO' : '🚀 Get started'}</a>
    ${profile ? '' : `<a class="btn big ghost" href="${rootUrl('index.html')}">🏠 Home</a>`}
  </div>
</article>
${profile ? '' : `<footer class="footer"><a href="${rootUrl('credits.html')}">Credits &amp; privacy</a> · 3D models adapted from Z-Anatomy (CC BY-SA 4.0)</footer>`}
`;
