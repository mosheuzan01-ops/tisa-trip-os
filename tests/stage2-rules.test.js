// Stage 2: country pack numbers and project rules (docs/GOALS_STAGE2.md B8, B8a, B9, B18).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, readText, readJson, listFiles, stripShareImage } from './helpers.js';
import { TH } from '../data/packs/th.js';
import { daysBetween, isIsoDate } from '../src/js/core/trip.js';
// Stage 9 (owner, 2026-11-21): the old route, dates and profiles moved to TH.archive (kept, not the default).

test('B8: country pack matches the work plan (11 stops, 29 nights, 30 days, totals, rates)', () => {
  assert.equal(TH.countryCode, 'TH');
  assert.equal(TH.timeZone, 'Asia/Bangkok');
  assert.equal(TH.timeZone, readJson('data/countries/th.json').timeZone, 'one time zone for the country');
  assert.equal(TH.archive.defaultDates.start, '2026-12-05');
  assert.equal(TH.archive.defaultDates.end, '2027-01-03');
  assert.equal(daysBetween(TH.archive.defaultDates.start, TH.archive.defaultDates.end) + 1, 30, '30 days');

  assert.equal(TH.archive.destinations.length, 11);
  let nights = 0;
  let cursor = TH.archive.defaultDates.start;
  for (const d of TH.archive.destinations) {
    assert.ok(isIsoDate(d.startDate) && isIsoDate(d.endDate), d.id);
    assert.equal(d.startDate, cursor, `${d.id} starts where the previous stop ended`);
    assert.equal(d.nights, daysBetween(d.startDate, d.endDate), `${d.id} nights match its dates`);
    nights += d.nights;
    cursor = d.endDate;
  }
  assert.equal(cursor, TH.archive.defaultDates.end);
  assert.equal(nights, 29);
  assert.deepEqual(TH.archive.destinations.filter((d) => d.flexible).map((d) => d.id), ['koh-tao']);

  assert.equal(TH.budgetCategories.length, 8);
  assert.deepEqual(TH.archive.budgetProfiles.map((p) => [p.id, p.total, p.currency]), [
    ['saver', 9800, 'ILS'], ['realistic', 15270, 'ILS'], ['comfort', 21400, 'ILS'],
  ]);
  const r = TH.planningRates;
  assert.equal(r.ILS_THB, 10);
  assert.equal(r.USD_ILS, 3.7);
  assert.equal(r.USD_THB, 37);
  assert.equal(Math.round(r.USD_ILS * r.ILS_THB * 1e9) / 1e9, r.USD_THB, '3.7 x 10 = 37');
  assert.deepEqual(TH.atmFee, { amount: 220, currency: 'THB' });
});

test('B8a: category amounts add up to each profile total, and are marked as unverified planning numbers', () => {
  assert.equal(TH.archive.budgetProfilesVerified, false);
  for (const p of TH.archive.budgetProfiles) {
    assert.deepEqual(Object.keys(p.categories).sort(), TH.budgetCategories.map((c) => c.id).sort(), p.id);
  }
  for (const p of TH.archive.budgetProfiles) {
    const sum = TH.budgetCategories.reduce((s, c) => s + p.categories[c.id], 0);
    assert.equal(sum, p.total, p.id);
  }
});

const js = listFiles('src/js', ['.js']);

test('B9: only the storage layer touches localStorage', () => {
  const allowed = new Set(['src/js/core/storage.js', 'src/js/theme-boot.js', 'src/js/core/store.js']);
  for (const file of js) {
    if (allowed.has(file)) continue;
    assert.doesNotMatch(readText(file), /localStorage/, `${file} uses localStorage directly`);
  }
});

test('B9: no hard-coded Hebrew text in JavaScript (copy lives in locales)', () => {
  for (const file of js) {
    if (file === 'src/js/brand.js') continue; // brand.html is an internal Hebrew design document, not app UI
    const code = readText(file).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(code, /[֐-׿]/, `${file} has Hebrew text`);
  }
  for (const file of ['sw.js']) assert.doesNotMatch(readText(file), /[֐-׿]/, file);
});

test('B9 (rule 2): state variables set from JS end in -s and never reuse a token name', () => {
  const tokens = readText('src/css/tokens.css');
  const set = new Set();
  for (const file of js) for (const m of readText(file).matchAll(/setProperty\(\s*'(--[\w-]+)'/g)) set.add(m[1]);
  assert.ok(set.size > 0, 'expected the tilt to set state variables');
  for (const name of set) {
    assert.match(name, /-s$/, `${name} should end in -s`);
    assert.doesNotMatch(tokens, new RegExp(`${name}\\s*:`), `${name} is also a token`);
  }
});

test('B9: the service worker precaches every file the app needs', () => {
  const sw = readText('sw.js');
  const list = JSON.parse(/const PRECACHE = (\[[\s\S]*?\]);/.exec(sw)[1].replace(/'/g, '"').replace(/,\s*\]/, ']'));
  const needed = [
    './', './index.html', './manifest.webmanifest',
    ...['src', 'locales', 'config', 'data', 'assets', 'icons'].flatMap((dir) => listFiles(dir, ['.js', '.css', '.json', '.svg', '.ttf', '.png']).map((f) => `./${f}`)),
  ].filter((f) => !f.endsWith('brand.js') && !f.endsWith('brand.css'));
  for (const f of needed) assert.ok(list.includes(f), `sw.js does not precache ${f}`);
  for (const f of list) if (f !== './') assert.ok(existsSync(join(ROOT, f)), `sw.js lists a missing file ${f}`);
});

test('B9: one version number for app, package and cache', () => {
  const version = readJson('config/app.config.json').appVersion;
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(readJson('package.json').version, version);
  assert.match(readText('sw.js'), new RegExp(`const VERSION = '${version.replace(/\./g, '\\.')}'`));
});

test('B18: manifest is valid for install under a sub-path', () => {
  const m = readJson('manifest.webmanifest');
  assert.equal(m.dir, 'rtl');
  assert.equal(m.lang, 'he');
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  assert.equal(m.name.startsWith(readJson('config/app.config.json').appName), true);
  const sizes = m.icons.map((i) => `${i.sizes}:${i.purpose ?? 'any'}`);
  for (const want of ['192x192:any', '512x512:any', '512x512:maskable']) assert.ok(sizes.includes(want), want);
  for (const icon of m.icons) assert.ok(existsSync(join(ROOT, icon.src)), icon.src);
  const tokens = readText('src/css/tokens.css');
  for (const color of [m.theme_color, m.background_color]) assert.ok(tokens.toLowerCase().includes(color.toLowerCase()), `${color} is not a token`);
  const html = readText('index.html');
  assert.match(html, /<link rel="manifest" href="\.\/manifest\.webmanifest">/);
  assert.match(html, /<link rel="apple-touch-icon" href="\.\/icons\/apple-touch-icon-180\.png">/);
  assert.ok(existsSync(join(ROOT, 'icons/apple-touch-icon-180.png')));
});

test('B19: no Google Fonts or other outside hosts anywhere the app loads', () => {
  for (const file of ['index.html', 'sw.js', 'manifest.webmanifest', ...listFiles('src', ['.js', '.css'])]) {
    assert.doesNotMatch(stripShareImage(readText(file)), /fonts\.googleapis|fonts\.gstatic|https?:\/\//, file);
  }
});
