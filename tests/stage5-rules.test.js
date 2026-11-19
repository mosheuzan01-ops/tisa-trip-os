// Stage 5 static guards (docs/GOALS_STAGE5.md S5-5, S5-8, S5-10, S5-11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readText, readJson } from './helpers.js';

const html = readText('index.html');

test('S5-11: the lists tab opens its own panel; every tab is a real screen now', () => {
  assert.match(html, /id="tab-lists"[^>]*aria-controls="panel-checklist"/);
  assert.match(html, /<section class="panel lists" id="panel-checklist" role="tabpanel" aria-labelledby="tab-lists" hidden>/);
  assert.match(readText('src/js/app.js'), /checklist: \{ tab: 'lists', title: 'screen\.checklist', icon: 'i-list' \}/);
  assert.doesNotMatch(html, /aria-controls="panel-soon"/, 'no tab points at the placeholder');
});

test('S5-5: deletes and starter lists wait for a yes in a native dialog', () => {
  for (const id of ['dlg-item', 'dlg-task', 'dlg-list-confirm']) assert.match(html, new RegExp(`<dialog class="sheet dmetal" id="${id}"`), id);
  assert.doesNotMatch(readText('src/js/checklist-view.js'), /confirm\(['"`]|alert\(|prompt\(/);
});

test('S5-8: no rule, number or date as fact in the checklist copy and data', () => {
  const pack = readText('data/packs/th.js');
  const seed = pack.slice(pack.indexOf('checklistSeed'), pack.indexOf('taskSeed') + 2000);
  assert.doesNotMatch(seed.replace(/\/\/.*$/gm, ''), /\d/, 'starter list and tasks have no digits');
  for (const loc of ['he', 'en']) {
    const dict = readJson(`locales/${loc}.json`);
    for (const [k, v] of Object.entries(dict)) {
      if (/^(list|task|lists|itemErr|taskErr|home\.(tasks|prep|pack|lists))/.test(k)) assert.doesNotMatch(v, /\d/, `${loc} ${k}`);
    }
  }
  assert.match(readJson('locales/he.json')['list.verify.hint'], /לא כותבת אותם כעובדה/);
});

test('S5-10: new files are cached for offline use and the version is 0.5.x', () => {
  const sw = readText('sw.js');
  for (const f of ['./src/js/checklist-view.js', './src/js/core/checklist.js']) assert.ok(sw.includes(`'${f}'`), f);
  assert.match(readJson('config/app.config.json').appVersion, /^0\.5\.\d+$/);
});

test('S5-11: list text is at least 14px and its controls at least 44px', () => {
  const css = readText('src/css/main.css').split('Stage 5: lists')[1];
  for (const m of css.matchAll(/font-size:\s*([\d.]+)(px|rem)/g)) assert.ok((m[2] === 'rem' ? Number(m[1]) * 16 : Number(m[1])) >= 14, m[0]);
  assert.match(css, /\.item-check \{[^}]*min-height: var\(--tap\);/);
  assert.match(css, /\.home-lists-link \{[^}]*min-height: var\(--tap\);/);
});
