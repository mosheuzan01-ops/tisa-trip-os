// Stage 9 PR 1 rules: version for the phone, offline files, and no personal trip data in the public repo (rule 16).
// The privacy check is generic on purpose: it never names the owner's own dates or flights (that would leak them).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readText, readJson, listFiles } from './helpers.js';
import { TH } from '../data/packs/th.js';

test('S9-9: 0.8.0 or later in all three places, so installed phones get the update banner', () => {
  const v = readJson('config/app.config.json').appVersion;
  const [a, b] = v.split('.').map(Number);
  assert.ok(a > 0 || b >= 8, v);
  assert.equal(readJson('package.json').version, v);
  assert.match(readText('sw.js'), new RegExp(`const VERSION = '${v.replace(/\./g, '\\.')}';`));
});

test('S9-9: the new core files are cached for offline use', () => {
  const sw = readText('sw.js');
  for (const f of ['core/route-plan.js', 'core/template.js']) assert.ok(sw.includes(`'./src/js/${f}'`), f);
});

test('rule 16: the new template and route carry no calendar dates: the trip dates are entered in the app', () => {
  const json = JSON.stringify({ t: TH.budgetTemplates, r: TH.routeTemplate });
  assert.doesNotMatch(json, /\d{4}-\d{2}-\d{2}|\b\d{1,2}\.\d{1,2}\b/);
});

test('rule 16: nothing shaped like a flight number, seat or booking reference in code, data or texts', () => {
  const files = [...listFiles('src', ['.js']), ...listFiles('data', ['.js', '.json']), 'locales/he.json', 'locales/en.json', 'index.html'];
  const flightLike = /\b(?:[A-Z]{2}|[A-Z]\d|\d[A-Z])\s?\d{2,4}\b(?![-:.\d])|\bseat\s*\d{1,2}[A-K]\b|\bמושב\s*\d{1,2}[A-K]\b/;
  for (const f of files) assert.doesNotMatch(readText(f).replace(/\sd="[^"]*"/g, ''), flightLike, f); // SVG path data is drawing, not text
});
