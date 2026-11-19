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

// 0.5.5: no user-facing text anywhere promises a stage (the settings dates hint still said "stage 3").
test('no user-facing text names a stage, in both languages', () => {
  for (const loc of ['he', 'en']) {
    const d = readJson(`locales/${loc}.json`);
    for (const [k, v] of Object.entries(d)) {
      if (typeof v !== 'string') continue;
      assert.doesNotMatch(v, /בשלב\s*(\d|הבא)|שלב\s*\d|\bstage\s*\d|next stage/i, `${loc} ${k}: "${v}"`);
    }
  }
  const html = readText('index.html').replace(/<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(html, />[^<]*(בשלב\s*(\d|הבא)|שלב\s*\d)[^<]*</, 'index.html fallback text');
});
