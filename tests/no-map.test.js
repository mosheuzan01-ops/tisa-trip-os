// Stage 2 close-out: the "map" tab is removed (owner decision 2026-11-19). An interactive map is on the
// experimental version's do-not-build list, so the app must not advertise it anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readText, readJson } from './helpers.js';

test('M1: no map tab, route or copy', () => {
  const html = readText('index.html');
  assert.ok(!/data-tab="map"|nav\.map|i-map/.test(html), 'index.html still has the map tab');
  assert.ok(!/\bmap:\s*\{/.test(readText('src/js/app.js')), 'app.js still has a map screen');
  for (const loc of ['he', 'en']) {
    const keys = Object.keys(readJson(`locales/${loc}.json`));
    assert.deepEqual(keys.filter((k) => k === 'nav.map' || k === 'soon.notPlanned'), [], `${loc}.json`);
  }
});

// 1.1.4 (owner): a fifth tab, "Tools" (#/tools). Still no map tab (M1, M3).
test('M2: the tab bar has exactly five tabs and a five-column grid', () => {
  const html = readText('index.html');
  assert.equal([...html.matchAll(/class="tab" role="tab"/g)].length, 5);
  assert.match(readText('src/css/main.css'), /\.tabbar-list \{[^}]*repeat\(5,/);
});

test('M3: an old #/map link lands on home', () => {
  assert.match(readText('src/js/app.js'), /LEGACY_ROUTES = \{[^}]*map: 'home'/);
});
