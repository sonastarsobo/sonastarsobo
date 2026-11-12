// Creates the one shared Supabase client for the whole site.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const isConfigured = !SUPABASE_URL.includes('YOUR-PROJECT') && !SUPABASE_ANON_KEY.includes('YOUR-ANON');

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

/** Site root URL (works when hosted in a sub-folder, e.g. GitHub Pages). */
export const ROOT = new URL('../', import.meta.url);

/** Build an absolute URL for a page or asset path relative to the site root. */
export function rootUrl(path) {
  return new URL(path, ROOT).href;
}
