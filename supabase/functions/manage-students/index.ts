// Supabase Edge Function: manage-students
// Actions:
//   join            (public)  { class_code, username, display_name, password }  → student creates their own account
//   bulk_create     (teacher) { class_id, students: [{ display_name }] }          → returns usernames + passwords
//   reset_password  (teacher) { student_id, new_password? }                       → returns the new password
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
const WORDS = ['apple', 'brain', 'cloud', 'delta', 'eagle', 'flame', 'grape', 'heart', 'igloo', 'jelly', 'koala', 'lemon',
  'mango', 'ninja', 'ocean', 'panda', 'quilt', 'robot', 'sunny', 'tiger', 'umbra', 'viola', 'whale', 'zebra', 'comet', 'pearl'];

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fail = (error: string, status = 400) => json({ ok: false, error }, status);

function rand(n: number) { return crypto.getRandomValues(new Uint32Array(1))[0] % n; }
function makePassword() { return `${WORDS[rand(WORDS.length)]}-${10 + rand(90)}-${WORDS[rand(WORDS.length)]}`; }
function slug(name: string) {
  return name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '').slice(0, 12) || 'student';
}

async function usernameTaken(username: string) {
  const { data } = await admin.from('profiles').select('id').eq('username', username).maybeSingle();
  return !!data;
}

async function createStudent(username: string, password: string, displayName: string, classCode: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${username}@${DOMAIN}`,
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

    // ------------------------------------------------------------ teacher creates many accounts
    if (body.action === 'bulk_create') {
      const teacher = await requireTeacher(req);
      const { data: cls } = await admin.from('classes').select('id, join_code, teacher_id').eq('id', String(body.class_id ?? '')).maybeSingle();
      if (!cls || cls.teacher_id !== teacher.id) return fail('Not your class', 403);
      const list = Array.isArray(body.students) ? body.students.slice(0, 60) : [];
      const created: Array<Record<string, string>> = [];
      const failed: Array<Record<string, string>> = [];
      for (const s of list) {
        const displayName = String((s as Record<string, unknown>).display_name ?? '').trim().slice(0, 40);
        if (!displayName) continue;
        let username = '';
        for (let i = 0; i < 8; i++) {
          const candidate = `${slug(displayName)}${100 + rand(900)}`;
          if (!(await usernameTaken(candidate))) { username = candidate; break; }
        }
        if (!username) { failed.push({ display_name: displayName, error: 'no free username' }); continue; }
        const password = makePassword();
        try {
          await createStudent(username, password, displayName, cls.join_code);
          created.push({ display_name: displayName, username, password });
        } catch (e) {
          failed.push({ display_name: displayName, error: (e as Error).message });
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
      const password = typeof body.new_password === 'string' && body.new_password.length >= 6 ? body.new_password : makePassword();
      const { error } = await admin.auth.admin.updateUserById(studentId, { password });
      if (error) throw error;
      const { data: p } = await admin.from('profiles').select('username').eq('id', studentId).single();
      return json({ ok: true, username: p?.username, password });
    }

    return fail('Unknown action');
  } catch (e) {
    return fail((e as Error).message || 'Something went wrong', 400);
  }
});
