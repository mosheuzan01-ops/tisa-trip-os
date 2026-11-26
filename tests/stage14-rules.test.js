// Stage 14 guards: no server secret anywhere (S14-8), the security header, the service worker and Supabase, the
// library loaded only when needed and only from this site, admin code kept apart (S14-7), the migration's shape,
// and the privacy text for 1.1.0. Static checks only; behaviour is in stage14-sync.test.js and the browser tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, readText, readJson, listFiles, CSP_META } from './helpers.js';

const LIB = 'vendor/supabase/supabase-js-2.119.2.umd.js';
const SECRET_PATTERNS = [
  ['a Supabase secret key', /sb_secret_[A-Za-z0-9_-]{10,}/],
  ['a database address with a password', /postgres(?:ql)?:\/\/[^\s:/@"'`]+:[^\s@"'`]+@/i],
  ['a service-role key in an env line', /SERVICE_ROLE_KEY\s*[=:]\s*["']?[A-Za-z0-9._-]{20,}/],
];
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g;
function serviceJwt(text) {
  for (const m of text.matchAll(JWT)) {
    try { if (JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')).role === 'service_role') return m[0].slice(0, 12); } catch { /* not a JWT */ }
  }
  return null;
}
function trackedTextFiles() {
  const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  return files.filter((f) => !/\.(png|jpe?g|webp|gif|ttf|woff2?|zip|ico|pdf)$/i.test(f));
}

test('S14-8a: no server secret in any file of the repository (service_role key, sb_secret_ key, database password)', () => {
  const found = [];
  for (const f of trackedTextFiles()) {
    if (f === 'tests/stage14-rules.test.js') continue; // the patterns themselves
    let text;
    try { text = readFileSync(join(ROOT, f), 'utf8'); } catch { continue; }
    for (const [what, re] of SECRET_PATTERNS) if (re.test(text)) found.push(`${f}: ${what}`);
    const jwt = serviceJwt(text);
    if (jwt) found.push(`${f}: a service_role JWT (${jwt}...)`);
  }
  assert.deepEqual(found, []);
});

test('S14-8b: no server secret was ever committed (git history)', () => {
  let log;
  try {
    log = execFileSync('git', ['log', '--all', '-p', '--no-color', '-G', 'sb_secret_|SERVICE_ROLE|postgres(ql)?://|eyJ[A-Za-z0-9_-]{8,}\\.eyJ'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  } catch (e) { assert.fail(`git log failed: ${e.message}`); }
  const added = log.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++') && !l.includes('SECRET_PATTERNS') && !l.includes("['a "));
  const text = added.join('\n');
  const found = SECRET_PATTERNS.filter(([, re]) => re.test(text)).map(([what]) => what);
  if (serviceJwt(text)) found.push('a service_role JWT');
  assert.deepEqual(found, []);
});

test('S14-8c: the app code never names the server role or a secret key; only the public key may be in config', () => {
  for (const f of ['index.html', 'sw.js', ...listFiles('src', ['.js', '.css']), 'config/app.config.json']) {
    assert.doesNotMatch(readText(f), /service_role|sb_secret_|SUPABASE_SERVICE/i, f);
  }
  const { cloud } = readJson('config/app.config.json');
  assert.ok(cloud && typeof cloud === 'object', 'config.cloud exists');
  assert.ok(cloud.url === '' || /^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(cloud.url), 'cloud.url is empty or a project address');
  const k = cloud.publishableKey;
  const keyAllowed = (key) => key === '' || /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
  assert.ok(keyAllowed(k), 'only the publishable key');
  // Owner decision (2026-11-23): only the new publishable key. The legacy "anon" JWT key stops working in late 2026,
  // in the middle of the trip. A made-up sample of its shape must be refused (sample only, not a real key).
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const legacySample = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase', ref: 'abcdefghijklmnopqrst', role: 'anon' })}.c2FtcGxl`;
  assert.equal(keyAllowed(legacySample), false, 'the legacy anon JWT key is refused');
  assert.equal(keyAllowed('sb_publishable_sample_only'), true, 'the new publishable key shape is accepted');
});

test('CSP: one policy, only this site plus Supabase for data, no inline or eval scripts', () => {
  const html = readText('index.html');
  assert.equal(html.split(CSP_META).length, 2, 'the exact approved CSP tag, once');
  assert.equal((html.match(/http-equiv="Content-Security-Policy"/g) ?? []).length, 1);
  assert.doesNotMatch(CSP_META, /unsafe-inline|unsafe-eval|\*\s|'none'.*script-src/);
  assert.match(CSP_META, /script-src 'self';/);
  assert.match(CSP_META, /connect-src 'self' https:\/\/\*\.supabase\.co;/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, 'no inline <script> in the page');
  assert.doesNotMatch(html, /\son[a-z]+="/i, 'no inline event handlers');
});

test('SW: requests to Supabase (another origin) are never handled or cached; only the app files are cached', () => {
  const sw = readText('sw.js');
  assert.match(sw, /if \(request\.method !== 'GET' \|\| new URL\(request\.url\)\.origin !== self\.location\.origin\) return;/);
  assert.doesNotMatch(sw, /cache\.put|caches\.match\(\s*request\s*\)/, 'nothing is added to the cache at run time');
  assert.doesNotMatch(sw, /supabase\.co/);
  assert.match(sw, new RegExp(`'\\./${LIB.replaceAll('.', '\\.')}'`), 'the library is in the offline copy');
});

test('V5 (stage 14): the library loads only when needed, only from this site, with the pinned hash', () => {
  const html = readText('index.html');
  assert.doesNotMatch(html, /vendor\/supabase/, 'the page does not load it at start');
  const users = listFiles('src', ['.js']).filter((f) => readText(f).includes('vendor/supabase'));
  assert.deepEqual(users, ['src/js/cloud-view.js']);
  const view = readText('src/js/cloud-view.js');
  assert.match(view, new RegExp(`const LIB = '\\./${LIB.replaceAll('.', '\\.')}';`));
  const sri = `sha256-${createHash('sha256').update(readFileSync(join(ROOT, LIB))).digest('base64')}`;
  assert.ok(view.includes(`const LIB_INTEGRITY = '${sri}'`), 'subresource integrity matches the file');
  assert.match(view, /storageKey: AUTH_KEY/); assert.match(view, /storage: authStorage\(backend\)/);
  assert.match(view, /flowType: 'pkce'/);
  // No session and no account: the library is not loaded (the start code checks for a saved session first).
  assert.match(view, /if \(hasSavedSession\(backend\) \|\| hasCode\)/);
});

test('S14-7: admin calls live only in admin-view.js, which is loaded only by import() for an approved admin', () => {
  const js = listFiles('src', ['.js']);
  const withAdmin = js.filter((f) => /['"`]admin_[a-z_]+['"`]/.test(readText(f)));
  assert.deepEqual(withAdmin, ['src/js/admin-view.js']);
  for (const f of js) assert.doesNotMatch(readText(f), /^import[^;]*admin-view/m, `${f} imports admin-view statically`);
  const view = readText('src/js/cloud-view.js');
  // 1.1.4: two ways in (the "Admin" button and the pending count), both behind the same check
  assert.match(view, /const isAdmin = \(\) => cloud\.status === 'approved' && cloud\.sync\.profile\?\.role === 'admin'/);
  const imports = [...view.matchAll(/import\('\.\/admin-view\.js'\)/g)].length;
  const guarded = [...view.matchAll(/if \(!isAdmin\(\)[^\n]*return;[\s\S]{0,160}?await import\('\.\/admin-view\.js'\)/g)].length;
  assert.equal(imports, 2);
  assert.equal(guarded, 2);
  assert.doesNotMatch(readText('sw.js'), /admin_/);
});

test('MIG: every table has RLS on and nothing for anon; definer functions pin search_path; no role change function', () => {
  const sql = readText('supabase/migrations/0001_stage14_init.sql');
  const tables = [...sql.matchAll(/create table public\.([a-z_]+)/g)].map((m) => m[1]);
  assert.deepEqual(tables.sort(), ['profiles', 'trip_members', 'trip_records', 'trips', 'user_settings']);
  for (const tb of tables) assert.match(sql, new RegExp(`alter table public\\.${tb}\\s+enable row level security`), tb);
  assert.match(sql, /revoke all on public\.profiles, public\.trips, public\.trip_members, public\.trip_records, public\.user_settings from public, anon, authenticated;/);
  assert.doesNotMatch(sql, /grant[^;]*to anon/i);
  assert.doesNotMatch(sql, /grant[^;]*delete[^;]*trip_records/i, 'no delete on records');
  for (const m of sql.matchAll(/create function (public\.[a-z_]+)\([^)]*\)[\s\S]*?security definer([^\n]*)/g)) {
    assert.match(m[2], /set search_path = ''/, `${m[1]} pins search_path`);
  }
  assert.doesNotMatch(sql, /create function public\.[a-z_]*role/, 'no function that changes a role');
  assert.doesNotMatch(sql, /grant update \([^)]*\b(role|status)\b/, 'role and status are never updatable by API users');
  assert.doesNotMatch(sql.split('-- After you sign up')[0], /role = 'admin', status/, 'making an admin is only the manual line at the end');
});

test('MIG-2: 0002 hardening keeps the policy helpers out of the API schema; definer functions everywhere pin search_path', () => {
  const sql = readText('supabase/migrations/0002_stage14_hardening.sql');
  for (const f of ['is_admin()', 'is_approved()', 'is_trip_member(text)', 'is_trip_owner(text)']) {
    assert.match(sql, new RegExp(`drop function public\\.${f.replace('(', '\\(').replace(')', '\\)')};`), `public.${f} dropped`);
    assert.match(sql, new RegExp(`create function private\\.${f.split('(')[0]}\\(`), `private.${f} created`);
  }
  assert.match(sql, /grant usage on schema private to authenticated;/);
  assert.doesNotMatch(sql, /grant[^;]*to anon/i);
  assert.match(sql, /create or replace function public\.admin_list_users\(\)[^$]*security invoker/);
  assert.match(sql, /create or replace function public\.admin_list_trips\(\)[^$]*security invoker/);
  for (const file of ['0001_stage14_init.sql', '0002_stage14_hardening.sql']) {
    const text = readText(`supabase/migrations/${file}`);
    for (const m of text.matchAll(/create (?:or replace )?function ([a-z_.]+)\([^)]*\)[\s\S]*?security definer([^\n]*)/g)) {
      assert.match(m[2], /set search_path = ''/, `${file}: ${m[1]} pins search_path`);
    }
  }
});

test('PRIV-14: the privacy text says what 1.1.0 does with an account', () => {
  const he = readJson('locales/he.json');
  const text = Object.entries(he).filter(([k]) => k.startsWith('privacy.')).map(([, v]) => v).join('\n');
  const must = {
    'without an account, only on this device': /בלי כניסה לחשבון[\s\S]*רק במכשיר/,
    'Supabase, Singapore (owner decision 2026-11-23)': /Supabase[\s\S]*בסינגפור/,
    'no other region named': /^(?![\s\S]*(פרנקפורט|גרמניה|האיחוד האירופי))/,
    'friends see only the shared part': /רואים רק את החלק המשותף/,
    'the admin sees all data': /המנהל[\s\S]*את כל הנתונים/,
    'photos are not uploaded': /התמונות לא עולות/,
    'how to ask for deletion': /למחיקת החשבון/,
  };
  assert.deepEqual(Object.entries(must).filter(([, re]) => !re.test(text)).map(([k]) => k), []);
  const html = readText('index.html');
  for (const k of ['privacy.cloud', 'privacy.cloudWho', 'privacy.cloudAdmin', 'privacy.cloudPhotos', 'privacy.cloudDelete']) {
    assert.match(html, new RegExp(`data-i18n="${k.replace('.', '\\.')}"`), `${k} is shown`);
  }
});

test('VER-14: version 1.2.0 in package.json, config and the service worker (the final design)', () => {
  assert.equal(readJson('package.json').version, '1.2.0');
  assert.equal(readJson('config/app.config.json').appVersion, '1.2.0');
  assert.match(readText('sw.js'), /const VERSION = '1\.2\.0';/);
});

test('MIG-3: 0003 adds delete_trip only: owner and approved checked in the function, search_path pinned, no anon, no table delete', () => {
  const sql = readText('supabase/migrations/0003_delete_trip.sql');
  const fns = [...sql.matchAll(/create (?:or replace )?function ([a-z_.]+)\(/g)].map((m) => m[1]);
  assert.deepEqual(fns, ['public.delete_trip']);
  assert.match(sql, /security definer set search_path = ''/);
  assert.match(sql, /if not private\.is_approved\(\) then raise exception 'not_allowed'/);
  assert.match(sql, /owner_id = auth\.uid\(\)\) then raise exception 'not_allowed'/);
  assert.match(sql, /delete from public\.trips where id = t and owner_id = auth\.uid\(\);/);
  assert.match(sql, /revoke all on function public\.delete_trip\(text\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.delete_trip\(text\) to authenticated;/);
  assert.doesNotMatch(sql, /grant[^;]*to anon/i);
  assert.doesNotMatch(sql, /grant[^;]*delete on/i, 'no table delete privilege for API users');
  assert.doesNotMatch(sql, /\b(update|insert into|drop table|truncate)\b/i, 'it changes no data and no table');
  // the cascade it relies on is in 0001
  const init = readText('supabase/migrations/0001_stage14_init.sql');
  assert.match(init, /trip_id\s+text not null references public\.trips \(id\) on delete cascade/);
  assert.match(init, /trip_id  text not null references public\.trips \(id\) on delete cascade/);
});
