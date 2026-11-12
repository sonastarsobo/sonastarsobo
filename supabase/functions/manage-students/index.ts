// Supabase Edge Function: manage-students
// Actions:
//   join            (public)  { class_code, username, display_name, password }  → student creates their own account
//   check_usernames (teacher) { names: string[] }                                 → which names are already taken
//   bulk_create     (teacher) { class_id, students: [{ display_name }] }          → username = the name exactly as typed,
//                                                                                   password = short "word-number" (tiger-42)
//   reset_password  (teacher) { student_id, new_password? }                       → returns the new password
// Passwords SOBO makes are saved in public.student_credentials so the teacher can look them up again
// (needs supabase/migrations/004_student_logins.sql).
// Deploy:  supabase functions deploy manage-students --no-verify-jwt
// (We check the teacher's login ourselves below, so the public "join" action can work without a session.)
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const DOMAIN = Deno.env.get('STUDENT_EMAIL_DOMAIN') ?? 'students.bodyquest.app';
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,23}$/;
// short, friendly words for "word-number" passwords
const WORDS = ['apple', 'bear', 'bird', 'cake', 'cat', 'cloud', 'comet', 'corn', 'deer', 'dog', 'duck', 'fish',
  'frog', 'gem', 'grape', 'heart', 'kite', 'koala', 'leaf', 'lemon', 'lion', 'mango', 'moon', 'owl',
  'panda', 'pearl', 'rain', 'robot', 'rose', 'seal', 'ship', 'star', 'sun', 'tiger', 'tree', 'wave',
  'whale', 'wolf', 'zebra', 'drum'];

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fail = (error: string, status = 400) => json({ ok: false, error }, status);

function rand(n: number) { return crypto.getRandomValues(new Uint32Array(1))[0] % n; }

/** "word-number", e.g. tiger-42 — different from every password in `avoid` (which it then joins). */
function makePassword(avoid: Set<string> = new Set()) {
  for (let i = 0; i < 300; i++) {
    const p = `${WORDS[rand(WORDS.length)]}-${10 + rand(90)}`;
    if (!avoid.has(p)) { avoid.add(p); return p; }
  }
  const p = `${WORDS[rand(WORDS.length)]}-${100 + rand(900)}`;
  avoid.add(p);
  return p;
}

/** Tidy a typed name into a username: trimmed, single spaces — otherwise exactly as typed. */
const cleanName = (n: unknown) => String(n ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);

/** The login key behind a username (same rules as public.username_key and usernameKey() in js/auth.js). */
function usernameKey(u: string) {
  const s = u.trim().normalize('NFKC').toLowerCase().replace(/\s+/g, '.');
  let out = '';
  for (const ch of s) out += /[a-z0-9._-]/.test(ch) ? ch : `x${ch.codePointAt(0)!.toString(16)}`;
  return out.replace(/\.{2,}/g, '.');
}

/** The names (as given) that an existing account already uses. */
async function takenNames(names: string[]) {
  if (!names.length) return new Set<string>();
  const { data, error } = await admin.rpc('usernames_taken', { p_names: names });
  if (error) throw new Error(`${error.message} (run supabase/migrations/004_student_logins.sql first)`);
  return new Set<string>((data ?? []) as string[]);
}
async function usernameTaken(username: string) { return (await takenNames([username])).has(username); }

/** Passwords already handed out in a class, so new ones are different. */
async function classPasswords(classId: string) {
  const set = new Set<string>();
  const { data: members } = await admin.from('class_members').select('student_id').eq('class_id', classId);
  const ids = (members ?? []).map((m: { student_id: string }) => m.student_id);
  if (!ids.length) return set;
  const { data } = await admin.from('student_credentials').select('password').in('student_id', ids);
  for (const r of (data ?? []) as Array<{ password: string }>) set.add(r.password);
  return set;
}
async function saveCredentials(studentId: string, username: string, password: string) {
  const { error } = await admin.from('student_credentials')
    .upsert({ student_id: studentId, username, password, updated_at: new Date().toISOString() });
  if (error) console.error('could not save credentials', error.message);
}

async function createStudent(username: string, password: string, displayName: string, classCode: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${usernameKey(username)}@${DOMAIN}`,
    password,
    email_confirm: true,   // no email is ever sent to students
    user_metadata: { role: 'student', username, display_name: displayName, class_code: classCode },
  });
  if (error) throw error;
  return data.user;
}

async function requireTeacher(req: Request) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) throw new Error('Please log in as a teacher');
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) throw new Error('Please log in as a teacher');
  const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single();
  if (!profile || !['teacher', 'admin'].includes(profile.role)) throw new Error('Only teachers can do this');
  return user;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fail('Use POST', 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail('Invalid JSON'); }

  try {
    // ------------------------------------------------------------ student joins with a class code
    if (body.action === 'join') {
      const code = String(body.class_code ?? '').trim().toUpperCase();
      const username = String(body.username ?? '').trim().toLowerCase();
      const displayName = String(body.display_name ?? '').trim().slice(0, 40);
      const password = String(body.password ?? '');
      if (!USERNAME_RE.test(username)) return fail('Usernames need 3–24 letters or numbers (no spaces).');
      if (password.length < 6) return fail('Passwords need at least 6 characters.');
      if (!displayName) return fail('Please type your first name.');
      const { data: cls } = await admin.from('classes').select('id').eq('join_code', code).maybeSingle();
      if (!cls) return fail('That class code was not found. Check it with your teacher.');
      if (await usernameTaken(username)) return fail('That username is taken — try adding a number.');
      await createStudent(username, password, displayName, code);
      return json({ ok: true });
    }

    // ------------------------------------------------------------ teacher checks names before creating accounts
    if (body.action === 'check_usernames') {
      await requireTeacher(req);
      const names = (Array.isArray(body.names) ? body.names : []).map(cleanName).filter(Boolean).slice(0, 60);
      return json({ ok: true, taken: [...await takenNames(names)] });
    }

    // ------------------------------------------------------------ teacher creates many accounts
    if (body.action === 'bulk_create') {
      const teacher = await requireTeacher(req);
      const { data: cls } = await admin.from('classes').select('id, join_code, teacher_id').eq('id', String(body.class_id ?? '')).maybeSingle();
      if (!cls || cls.teacher_id !== teacher.id) return fail('Not your class', 403);
      const list = (Array.isArray(body.students) ? body.students.slice(0, 60) : [])
        .map((s) => cleanName((s as Record<string, unknown>).display_name)).filter(Boolean);
      // the username is the name exactly as typed, so every name must be new
      const seen = new Set<string>();
      const repeated: string[] = [];
      for (const n of list) { const k = usernameKey(n); if (seen.has(k)) repeated.push(n); else seen.add(k); }
      const taken = [...await takenNames(list)];
      if (repeated.length || taken.length) {
        return json({ ok: false, error: 'A student with this exact name already exists', taken, repeated }, 409);
      }
      const avoid = await classPasswords(cls.id);
      const created: Array<Record<string, string>> = [];
      const failed: Array<Record<string, string>> = [];
      for (const name of list) {
        const password = makePassword(avoid);
        try {
          const user = await createStudent(name, password, name, cls.join_code);
          await saveCredentials(user.id, name, password);
          created.push({ display_name: name, username: name, password });
        } catch (e) {
          const m = (e as Error).message || '';
          failed.push({ display_name: name, error: /already|registered|exists/i.test(m) ? 'a student with this exact name already exists' : m });
        }
      }
      return json({ ok: true, created, failed });
    }

    // ------------------------------------------------------------ teacher resets a student's password
    if (body.action === 'reset_password') {
      const teacher = await requireTeacher(req);
      const studentId = String(body.student_id ?? '');
      const { data: link } = await admin.from('class_members').select('class_id, classes!inner(teacher_id)')
        .eq('student_id', studentId).eq('classes.teacher_id', teacher.id).limit(1);
      if (!link?.length) return fail('This student is not in one of your classes', 403);
      const password = typeof body.new_password === 'string' && body.new_password.length >= 6
        ? body.new_password : makePassword(await classPasswords(link[0].class_id));
      const { error } = await admin.auth.admin.updateUserById(studentId, { password });
      if (error) throw error;
      const { data: p } = await admin.from('profiles').select('username').eq('id', studentId).single();
      if (p?.username) await saveCredentials(studentId, p.username, password);
      return json({ ok: true, username: p?.username, password });
    }

    return fail('Unknown action');
  } catch (e) {
    return fail((e as Error).message || 'Something went wrong', 400);
  }
});
