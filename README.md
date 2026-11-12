# SOBO

A 3D human-anatomy learning website for school students (grades 4–7), built with **plain HTML, CSS and JavaScript**, **three.js** and **Supabase**.

- **Students:** Learn mode (3D model, about / location / function / fun fact, read-aloud, guided tour + quick check), **Organ Blaster**, **System Builder**, tests, XP, streaks and badges.
- **Teachers:** classes with join codes, bulk student accounts with printable login cards, a progress table, a weak-spot heatmap, assignments, tests (random or hand-picked questions, plus your own), per-student printable reports and CSV export.
- **Three levels everywhere:** Explorer (grade 4, `simple`), Investigator (grades 5–6, `medium`) and Expert (grade 7, `full`). The 3D models, organ lists and questions all change with the level.
- **Everything is saved:** learning progress, every game session and every answer, and every test attempt and answer.

---

## 1. What's in the folder

```
index.html, login.html, credits.html, tests.html
student/   dashboard, learn, games, organ-blaster, system-builder, assessments, take-test
teacher/   dashboard, class, student (report), assessment-builder
css/style.css
js/
  config.example.js   → copy to config.js and add your Supabase keys
  supabase.js         Supabase client
  auth.js             login / sign-up / page guards
  api.js              every database call
  ui.js               top bar, modals, toasts, settings, helpers
  three/viewer.js     shared three.js viewer (load GLB, pick, highlight, x-ray, labels, camera)
  games/logic.js      pure game rules (tested in tests.html)
  games/session.js    saves game sessions + answers in batches
  data/pathways.js    flow order for System Builder (food / air / blood / urine)
  pages/*.js          one script per page
models/               22 GLB files (8 systems × simple / medium / full) + MODELS.md
supabase/
  migrations/001_schema.sql   tables, security rules (RLS), triggers, server functions
  migrations/002_blaster_leaderboard.sql   Organ Blaster difficulty + class leaderboard
  migrations/003_3d_questions_only.sql     tests use only 3D questions (click the organ / label the model)
  migrations/004_student_logins.sql        exact-name usernames + saved word-number passwords for teachers
  seed.sql                    298 organ models, 178 organ texts, 1,262 questions, 10 badges
  functions/manage-students/  Edge Function: join with class code, bulk accounts, reset passwords
```

## 2. Set up Supabase (about 10 minutes)

1. Create a project at [supabase.com](https://supabase.com).
2. **Dashboard → SQL Editor → New query.** Paste all of `supabase/migrations/001_schema.sql` and click **Run**.
3. Do the same with `supabase/seed.sql`. It's large, so give it a few seconds.
   Then run `supabase/migrations/002_blaster_leaderboard.sql` the same way (Organ Blaster difficulty + class leaderboard). **Already set up?** Just run this one file; it is safe to run more than once.
   Then run `003_3d_questions_only.sql` and `004_student_logins.sql` the same way. After 004, **deploy the `manage-students` Edge Function again** (step 5) so new students get exact-name usernames and saved passwords.
4. **Authentication → URL Configuration:** set **Site URL** to where your site will live (e.g. `http://127.0.0.1:5500` while testing). Add the same URL under **Redirect URLs**. Teacher confirmation and password-reset emails link there.
5. **Edge Function** (needed for students to join with a class code without an email, for bulk accounts and for password resets). Use one of these:
   - **Dashboard:** Edge Functions → *Deploy a new function* → name it `manage-students` → paste `supabase/functions/manage-students/index.ts` → deploy. Then open the function's settings and **turn off "Enforce JWT verification"** (the function checks teacher logins itself).
   - **CLI:** `supabase functions deploy manage-students --no-verify-jwt`

   > Without the function, "Join a class" falls back to normal sign-up. That only works if you turn **Authentication → Providers → Email → "Confirm email" off**.
6. **Project Settings → API:** copy the **Project URL** and the **anon public** key.

## 3. Configure the website

```bash
cp js/config.example.js js/config.js
```

Edit `js/config.js` and paste your URL and anon key. **Never** put the `service_role` key in the website.

## 4. Run it locally

ES modules don't work from `file://`, so use any small web server from the project folder:

- VS Code: **Live Server** extension → "Go Live", or
- `npx serve .`, or
- `python -m http.server 5500`

Open `http://127.0.0.1:5500` and you're ready.

## 5. First steps

1. **Login → New teacher.** Create your account (confirm the email if confirmations are on).
2. **New class.** You get a 6-letter class code.
3. Students go to **Login → Join a class**, type the code and choose a username and password. Or use **Add students** on the class page to create accounts and print login cards.
4. Students learn, play and take tests. You'll see it all on the class page.

## 6. Put it online

The site is plain static files. Upload the whole folder (including `models/` and your `js/config.js`) to **Netlify**, **Vercel**, **GitHub Pages** or any web host. Then update the **Site URL / Redirect URLs** in Supabase to your real address.

*Optional:* host the models in **Supabase Storage** instead. Create a public bucket `models`, upload the `models/` folder into it so the path is `models/models/x.glb`, and set `MODELS_BASE_URL` in `config.js`.

## 7. How the data is stored

| Table | What it holds |
|---|---|
| `profiles` | name, role, username, grade, XP, streak (created automatically on sign-up) |
| `classes`, `class_members` | classes, join codes and who is in which class |
| `organ_models`, `organ_content` | organs per system/level and their learning text (editable in the Table Editor) |
| `learn_progress`, `quick_checks` | organs viewed and learned, plus guided-tour quiz scores |
| `game_sessions`, `game_events` | every game played and **every answer** (organ, correct?, response time) |
| `questions` + `question_answers` | question bank; answers are in a separate table students can never read |
| `assessments`, `assessment_attempts`, `attempt_answers` | tests, attempts and every answer (marked on the server) |
| `assignments`, `badges`, `student_badges` | to-dos for students and achievements |
| `organ_mastery` (view) | a 0–100 mastery score per student per organ (learning 20% + games 40% + tests 40%) |

**Security** uses Row Level Security on every table:

- Students see only their own data, and teachers see only students in their classes.
- XP, badges and test marking happen on the server, so students can't change their score.
- A finished game can't be edited.

The database was tested end to end: sign-up with class codes, the security rules, grading, retake limits, XP and badges.

## 8. Customising

- **Learning text:** edit rows in `organ_content` (Table Editor). Each organ has `about`, `location`, `function` and `fun_fact`.
- **Your own questions:** on the *Create a test* page, click "Write my own". Multiple choice and true/false are supported.
- **Level per class:** class page → Settings → Detail level.
- **Streak time zone:** `touch_activity()` in the migration uses `Asia/Kolkata`. Change it if your school is elsewhere.
- **3D models:** see `models/MODELS.md`. Each organ is a separate node named with its slug, positioned at its real place in the body.

## 9. Tests

Open `/tests.html` to run the game-logic tests (20 checks for scoring, waves, weighted organ picking, System Builder flow and hints).

## 10. Credits and licence

3D models adapted from **Z-Anatomy** (z-anatomy.com), licensed **CC BY-SA 4.0**. The adapted models must keep that licence and the credit, which is shown on `credits.html` and in the footer. three.js is MIT licensed. Your own code is yours.
