// Copy this file to js/config.js and fill in your Supabase project details
// (Supabase Dashboard → Project Settings → API).
// The anon key is safe to put in the browser ONLY because every table has Row Level Security turned on.
// NEVER put the service_role key here.

export const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLIC-KEY';

// Students log in with a username. Behind the scenes it becomes username@STUDENT_EMAIL_DOMAIN.
// No email is ever sent to this address. Change it only before any students sign up.
export const STUDENT_EMAIL_DOMAIN = 'students.bodyquest.app';

// Where the .glb files live. '' = the local /models folder next to index.html.
// To use Supabase Storage instead, upload the files to a public bucket called "models" and set:
// export const MODELS_BASE_URL = 'https://YOUR-PROJECT-REF.supabase.co/storage/v1/object/public/';
export const MODELS_BASE_URL = '';
