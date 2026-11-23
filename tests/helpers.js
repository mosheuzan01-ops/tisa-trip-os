import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));

export const readText = (path) => readFileSync(join(ROOT, path), 'utf8');
export const readJson = (path) => JSON.parse(readText(path));

/** List project files (relative paths) under a folder, matching extensions. */
export function listFiles(dir, exts) {
  const out = [];
  const walk = (abs) => {
    for (const name of readdirSync(abs)) {
      if (name.startsWith('.') || name === 'node_modules') continue;
      const full = join(abs, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (exts.some((e) => name.endsWith(e))) out.push(relative(ROOT, full));
    }
  };
  walk(join(ROOT, dir));
  return out;
}

/** The one approved external URL: the share-card image on the project's own Pages origin (owner OK, 2026-11-19). */
export const PAGES_ORIGIN = 'https://mosheuzan01-ops.github.io/tisa-trip-os/';
export const stripShareImage = (text) =>
  text.replace(/<meta property="og:image" content="https:\/\/mosheuzan01-ops\.github\.io\/tisa-trip-os\/[^"]*">/g, '');

/** Stage 14 (owner, 2026-11-23; rule 5, third approved exception): the one Content-Security-Policy tag, whose only
 *  outside host is Supabase (https://*.supabase.co, for data; nothing is loaded from it). Exact text only: any other
 *  outside address, or a changed policy, still fails G9, B19 and S2. tests/stage14-rules.test.js checks the policy. */
export const CSP_META = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self' https://*.supabase.co; worker-src 'self'; manifest-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'">`;
export const stripCsp = (text) => text.split(CSP_META).join('');
/** Both approved exceptions in HTML: the share image (rule 5) and the CSP tag (stage 14). */
export const stripApproved = (text) => stripCsp(stripShareImage(text));

/** Stage 9 (schema 6) adds two empty fields to every budget. Older migration tests compare the rest unchanged;
 *  tests/stage9-data.test.js checks the two new fields themselves. */
export const preV6 = (budget) => {
  if (!budget || typeof budget !== 'object') return budget;
  const { categoryNames, hidden, ...rest } = budget;
  return rest;
};
