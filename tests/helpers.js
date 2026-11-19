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
