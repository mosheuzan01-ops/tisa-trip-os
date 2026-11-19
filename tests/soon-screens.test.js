// 0.5.2: "coming soon" screens never promise a stage number (owner decision 2026-11-19, rule 12-13 batch).
// Written before the change (TDD).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readText, readJson } from './helpers.js';

test('soon screens carry no stage number in code', () => {
  const app = readText('src/js/app.js');
  const screens = app.slice(app.indexOf('const SCREENS = {'), app.indexOf('};', app.indexOf('const SCREENS = {')));
  assert.doesNotMatch(screens, /stage:\s*\d/, 'no screen promises a stage');
});

test('soon copy says "a future version", with no stage number, in both languages', () => {
  for (const loc of ['he', 'en']) {
    const d = readJson(`locales/${loc}.json`);
    for (const k of Object.keys(d).filter((x) => x.startsWith('soon.') || x === 'tools.note')) {
      assert.doesNotMatch(d[k], /\{n\}|שלב|stage/i, `${loc} ${k}: "${d[k]}"`);
    }
  }
  assert.match(readJson('locales/he.json')['soon.future'], /בגרסה עתידית/);
});
