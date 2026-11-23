// Stage 13 (1.0.0): privacy text and terms of use in settings (S13-4), the backup reminder (S13-2) and the version
// (S13-3). The privacy text must match what 1.0.0 really does: data in localStorage, photos in IndexedDB, no server,
// the site host and Google Maps (only on tap) as the only network parts. Browser side: scripts/qa/stage13-release-browser.cjs R16-R18.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { needsBackupReminder, BACKUP_REMINDER_DAYS } from '../src/js/core/schema.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const he = JSON.parse(read('locales/he.json'));
const en = JSON.parse(read('locales/en.json'));
const html = read('index.html');
const settings = html.slice(html.indexOf('id="panel-settings"'), html.indexOf('<nav class="tabbar'));
const block = (slot) => { const m = new RegExp(`<details[^>]*data-slot="${slot}"[\\s\\S]*?</details>`).exec(settings); return m ? m[0] : ''; };
const keysIn = (part) => [...part.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]);

test('PR-1 (S13-4) settings has a "privacy" fold: a summary with a heading, and every line is a text key in he and en', () => {
  const part = block('privacy');
  assert.ok(part, 'no <details data-slot="privacy"> in the settings screen');
  assert.match(part, /<summary[^>]*class="fold-head"[^>]*><h2[^>]*data-i18n="privacy\.title"/);
  const keys = keysIn(part);
  assert.ok(keys.length >= 6, `only ${keys.length} text keys`);
  for (const k of keys) {
    assert.ok(String(he[k] ?? '').trim(), `he.json has no ${k}`);
    assert.ok(String(en[k] ?? '').trim(), `en.json has no ${k}`);
  }
});

test('PR-2 (S13-4) the privacy text says what 1.0.0 does, and what not to keep in it', () => {
  const text = keysIn(block('privacy')).map((k) => he[k] ?? '').join('\n');
  const must = {
    'data on this device (localStorage)': /במכשיר[\s\S]*localStorage|localStorage[\s\S]*במכשיר/,
    'photos in IndexedDB on this device': /IndexedDB/,
    'no server and no account': /אין שרת/,
    'the site host loads the files': /GitHub Pages/,
    'Google Maps only on tap': /Google Maps[\s\S]*לחיצה|לחיצה[\s\S]*Google Maps/,
    'no passport number': /דרכון/,
    'no card details': /אשראי/,
    'clearing site data deletes everything': /מחיקת נתוני האתר/,
    'so back up': /גיבוי/,
  };
  const missing = Object.entries(must).filter(([, re]) => !re.test(text)).map(([k]) => k);
  assert.deepEqual(missing, []);
});

test('PR-3 (S13-4) the text names every network part there is: the only outside address in the app is the Maps link in config', () => {
  const cfg = JSON.parse(read('config/app.config.json'));
  const outsideInConfig = Object.entries(cfg).filter(([, v]) => typeof v === 'string' && /^https?:/.test(v)).map(([k]) => k);
  assert.deepEqual(outsideInConfig, ['mapsSearchUrl']);
  const code = readdirSync(new URL('../src/js/', import.meta.url), { recursive: true }).filter((f) => f.endsWith('.js'))
    .map((f) => read(`src/js/${f}`)).join('\n');
  assert.doesNotMatch(code, /fetch\(\s*['"`]https?:/, 'the code fetches an outside address');
  assert.doesNotMatch(code, /navigator\.sendBeacon|new WebSocket|EventSource\(/, 'the code sends data out');
});

test('PR-4 settings has a short "terms of use" fold next to privacy, for personal use between friends', () => {
  const part = block('terms');
  assert.ok(part, 'no <details data-slot="terms"> in the settings screen');
  assert.ok(settings.indexOf('data-slot="terms"') > settings.indexOf('data-slot="privacy"'), 'terms should come right after privacy');
  const keys = keysIn(part);
  assert.ok(keys.includes('terms.title') && keys.length >= 4, `keys: ${keys}`);
  for (const k of keys) assert.ok(String(he[k] ?? '').trim() && String(en[k] ?? '').trim(), `missing ${k}`);
  const text = keys.map((k) => he[k]).join('\n');
  assert.match(text, /שימוש אישי/);
  assert.match(text, /לבדוק/, 'says that what is marked "to check" is not verified');
  assert.doesNotMatch(text, /עוגיות|cookie/i, 'no cookie banner text (localStorage is not a reason for one)');
});

test('PR-5 no feedback button: feedback goes to the WhatsApp group', () => {
  assert.doesNotMatch(html, /data-action="feedback"|mailto:/);
});

test('S13-2 the backup reminder: 7 days from the last backup (or from install), not one minute before', () => {
  assert.equal(BACKUP_REMINDER_DAYS, 7);
  const s = { createdAt: '2030-11-01T10:00:00.000Z', settings: { lastBackupAt: '2030-12-01T10:00:00.000Z' } };
  assert.equal(needsBackupReminder(s, new Date('2030-12-08T09:59:00.000Z')), false);
  assert.equal(needsBackupReminder(s, new Date('2030-12-08T10:00:00.000Z')), true);
  const fresh = { createdAt: '2030-11-01T10:00:00.000Z', settings: { lastBackupAt: null } };
  assert.equal(needsBackupReminder(fresh, new Date('2030-11-08T09:59:00.000Z')), false);
  assert.equal(needsBackupReminder(fresh, new Date('2030-11-08T10:00:00.000Z')), true);
});

test('S13-3 one version everywhere it is set, and settings reads it from config', () => {
  const v = JSON.parse(read('config/app.config.json')).appVersion;
  assert.equal(JSON.parse(read('package.json')).version, v);
  assert.equal(/const VERSION = '([^']+)'/.exec(read('sw.js'))[1], v);
  assert.match(read('src/js/app.js'), /\[data-slot="version-app"\]'\)\.textContent = ctx\.config\.appVersion/);
});

test('S13-3 1.0.0 or a later 1.x in every place the version is set (the release of stage 13; 1.0.1 after it)', () => {
  const v = JSON.parse(read('config/app.config.json')).appVersion;
  assert.match(v, /^1\.\d+\.\d+$/);
  assert.equal(JSON.parse(read('package.json')).version, v);
  assert.equal(/const VERSION = '([^']+)'/.exec(read('sw.js'))[1], v);
});

test('R-22 (rule 22) browser scripts from stage 13 on use the shared sample data (scripts/qa/lib/), not a copy of their own', () => {
  // The one exception: the upgrade check builds 0.7.1 data with 0.7.1's own functions, taken from git (its whole point).
  const EXEMPT = { 'stage13-upgrade-browser.cjs': 'builds 0.7.1 data with the 0.7.1 code from git' };
  const files = readdirSync(new URL('../scripts/qa/', import.meta.url))
    .filter((f) => /^(stage(1[3-9]|[2-9]\d)-.*|shots-stage(1[3-9]|[2-9]\d))\.cjs$/.test(f) && !EXEMPT[f]);
  assert.ok(files.length >= 4, `found ${files}`);
  const bad = files.filter((f) => {
    const src = read(`scripts/qa/${f}`);
    return !/require\('\.\/lib\/[a-z-]+\.cjs'\)/.test(src) || /createDefaultState|readyTrip\(|makeExpense\(|makePlace\(/.test(src);
  });
  assert.deepEqual(bad, []);
});
