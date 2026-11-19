// Stage 3 static guards (docs/GOALS_STAGE3.md S3-4, S3-6, S3-8, S3-9).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readText, readJson } from './helpers.js';

const html = readText('index.html');
const view = readText('src/js/itinerary-view.js');

test('S3-9: the itinerary tab opens its own panel, not the "coming soon" placeholder', () => {
  assert.match(html, /id="tab-itinerary"[^>]*aria-controls="panel-itinerary"/);
  assert.match(html, /<section class="panel itinerary" id="panel-itinerary" role="tabpanel" aria-labelledby="tab-itinerary" hidden>/);
  assert.match(readText('src/js/app.js'), /itinerary: \{ tab: 'itinerary', title: 'nav\.itinerary', icon: 'i-route' \}/, 'no stage number: it is built');
});

test('S3-4: delete asks first; the suggested route and replanning also wait for a yes', () => {
  for (const id of ['dlg-stop', 'dlg-stop-delete', 'dlg-seed', 'dlg-replan']) assert.match(html, new RegExp(`<dialog class="sheet dmetal" id="${id}"`), id);
  assert.match(html, /data-action="stop-delete-confirm"/);
  assert.doesNotMatch(view, /confirm\(|alert\(|prompt\(/, 'no browser pop-ups; native <dialog> only');
});

test('S3-6: new files are cached for offline use and the cache version moved on', () => {
  const sw = readText('sw.js');
  for (const f of ['./src/js/itinerary-view.js', './src/js/core/itinerary.js', './data/packs/th.js']) assert.ok(sw.includes(`'${f}'`), f);
  assert.notEqual(readJson('config/app.config.json').appVersion, '0.2.4');
});

test('S3-8: the itinerary formats dates only through formatDate / formatRange (Intl, he-IL from the country file)', () => {
  assert.doesNotMatch(view, /toLocaleDateString|toDateString|getMonth\(|getDate\(/);
  assert.equal(readJson('data/countries/th.json').dateFormatLocale.he, 'he-IL');
});

test('S3-9: itinerary text is at least 14px and its buttons are at least 44px', () => {
  const css = readText('src/css/main.css').split('Stage 3: itinerary')[1];
  for (const m of css.matchAll(/font-size:\s*([\d.]+)(px|rem)/g)) {
    assert.ok((m[2] === 'rem' ? Number(m[1]) * 16 : Number(m[1])) >= 14, m[0]);
  }
  assert.match(css, /\.stop-btn \{ width: var\(--tap\); height: var\(--tap\); \}/);
  assert.match(readText('src/css/tokens.css'), /--tap:\s*44px/);
});
