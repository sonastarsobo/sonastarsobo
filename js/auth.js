// Login, sign-up and page guards.
import { supabase, isConfigured, rootUrl } from './supabase.js';
import { STUDENT_EMAIL_DOMAIN } from './config.js';
import { renderTopbar, toast, friendlyError } from './ui.js';

/**
 * The login key behind a username: lower case, spaces become dots, other symbols are spelled out.
 * Must match usernameKey() in supabase/functions/manage-students and public.username_key() in SQL.
 * "Aarav K" → "aarav.k"; plain usernames like "meera123" stay the same.
 */
export function usernameKey(u) {
  const s = String(u || '').trim().normalize('NFKC').toLowerCase().replace(/\s+/g, '.');
  let out = '';
  for (const ch of s) out += /[a-z0-9._-]/.test(ch) ? ch : `x${ch.codePointAt(0).toString(16)}`;
  return out.replace(/\.{2,}/g, '.');
}
export const studentEmail = (username) => `${usernameKey(username)}@${STUDENT_EMAIL_DOMAIN}`;
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,23}$/;

export function dashboardFor(role) {
  return rootUrl(role === 'teacher' || role === 'admin' ? 'teacher/dashboard.html' : 'student/dashboard.html');
}

let cachedProfile = null;

export async function getProfile(force = false) {
  if (cachedProfile && !force) return cachedProfile;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
  if (error) throw error;
  cachedProfile = data;
  return data;
}

/**
 * Call at the top of every protected page.
 * roles: ['student'] | ['teacher'] | ['student','teacher']
 * Returns the profile (and renders the top bar) or redirects.
 */
export async function requireRole(roles, { topbar = true } = {}) {
  if (!isConfigured) {
    document.body.innerHTML = `<div class="container"><div class="card"><h1>Almost there!</h1>
      <p>Add your Supabase URL and anon key to <code>js/config.js</code> (copy <code>js/config.example.js</code>). See README.md.</p></div></div>`;
    throw new Error('Supabase is not configured');
  }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    location.replace(rootUrl(`login.html?next=${encodeURIComponent(location.pathname + location.search)}`));
    return new Promise(() => {});   // page is navigating away
  }
  let profile;
  try {
    profile = await getProfile();
  } catch (e) {
    toast(friendlyError(e), 'error');
    throw e;
  }
  if (!profile) { await logout(); throw new Error('no profile'); }
  const role = profile.role === 'admin' ? 'teacher' : profile.role;
  if (!roles.includes(role)) {
    location.replace(dashboardFor(role));
    return new Promise(() => {});   // page is navigating away
  }
  if (role === 'student') {
    const { data } = await supabase.rpc('touch_activity');   // daily streak
    if (data) profile = cachedProfile = data;
  }
  if (topbar) renderTopbar(profile);
  return profile;
}

export async function logout() {
  await supabase.auth.signOut();
  cachedProfile = null;
  location.replace(rootUrl('login.html'));
}

export async function signInStudent(username, password) {
  const { error } = await supabase.auth.signInWithPassword({ email: studentEmail(username), password });
  if (error) throw error;
}

export async function signInTeacher(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
}

export async function signUpTeacher(displayName, email, password) {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(), password,
    options: { data: { role: 'teacher', display_name: displayName.trim() }, emailRedirectTo: rootUrl('login.html') },
  });
  if (error) throw error;
  return { needsConfirmation: !data.session };
}

/**
 * A student joins with a class code. Uses the manage-students Edge Function (no email needed).
 * If the function isn't deployed, falls back to normal sign-up (needs "Confirm email" OFF in Supabase).
 */
export async function joinWithClassCode({ classCode, username, displayName, password }) {
  const body = { action: 'join', class_code: classCode.trim().toUpperCase(), username: username.trim().toLowerCase(),
    display_name: displayName.trim(), password };
  const { data, error } = await supabase.functions.invoke('manage-students', { body });
  if (!error && data?.ok) {
    await signInStudent(username, password);
    return;
  }
  const notDeployed = error && (error.name === 'FunctionsFetchError' || error.context?.status === 404);
  if (error && !notDeployed) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch { /* keep message */ }
    throw new Error(msg);
  }
  if (data && !data.ok) throw new Error(data.error || 'Could not join the class');
  // fallback: direct sign-up
  const { data: su, error: e2 } = await supabase.auth.signUp({
    email: studentEmail(username), password,
    options: { data: { role: 'student', username: body.username, display_name: body.display_name, class_code: body.class_code } },
  });
  if (e2) throw e2;
  if (!su.session) {
    throw new Error('Account created, but Supabase needs email confirmation turned off for students (or deploy the manage-students function). Ask your teacher.');
  }
}

export { supabase };
