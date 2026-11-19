// Stage 4 static guards (docs/GOALS_STAGE4.md S4-2, S4-10, S4-11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readText, readJson } from './helpers.js';
import { contrastRatio, parseThemes } from '../src/js/core/contrast.js';

const html = readText('index.html');

test('S4-11: the budget tab opens the money panel', () => {
  assert.match(html, /id="tab-budget"[^>]*aria-controls="panel-money"/);
  assert.match(html, /<section class="panel money" id="panel-money" role="tabpanel" aria-labelledby="tab-budget" hidden>/);
  assert.match(readText('src/js/app.js'), /money: \{ tab: 'budget', title: 'screen\.money', icon: 'i-wallet' \}/, 'no stage number: it is built');
});

test('S4-8: delete and profile wait for a yes in a native dialog', () => {
  for (const id of ['dlg-expense', 'dlg-expense-delete', 'dlg-profile', 'dlg-cats', 'dlg-rates']) assert.match(html, new RegExp(`<dialog class="sheet dmetal" id="${id}"`), id);
  assert.doesNotMatch(readText('src/js/money-view.js'), /confirm\(|alert\(|prompt\(/);
});

test('S4-2: money code never stores decimals; amounts go through parseMoney / whole minor units', () => {
  const view = readText('src/js/money-view.js');
  assert.doesNotMatch(view, /parseFloat\(|\bamount: Number\(/, 'no float parsing of money in the view');
  assert.match(readText('src/js/core/money.js'), /Math\.round\(amountMinor \* rate\)/);
});

test('S4-10: new files are cached for offline use and the cache version is 0.4.0', () => {
  const sw = readText('sw.js');
  for (const f of ['./src/js/money-view.js', './src/js/core/money.js']) assert.ok(sw.includes(`'${f}'`), f);
  assert.equal(readJson('config/app.config.json').appVersion, '0.4.0');
  assert.deepEqual(readJson('config/app.config.json').budgetCurrencies, ['ILS', 'THB', 'USD'], 'no currency without a planning rate');
});

test('S4-11: chart colors (one per category) have 3:1 contrast on the card surface in both themes', () => {
  const themes = parseThemes(readText('src/css/tokens.css'));
  const failures = [];
  for (const [name, theme] of Object.entries(themes)) {
    for (let i = 1; i <= 9; i += 1) {
      const c = theme[`--chart-${i}`];
      assert.ok(c, `${name} is missing --chart-${i}`);
      const r = contrastRatio(c, theme['--surface']);
      if (r < 3) failures.push(`${name} --chart-${i} ${r.toFixed(2)}`);
    }
  }
  assert.deepEqual(failures, []);
});

test('S4-11: money text is at least 14px and its buttons at least 44px', () => {
  const css = readText('src/css/main.css').split('Stage 4: money')[1];
  for (const m of css.matchAll(/font-size:\s*([\d.]+)(px|rem)/g)) assert.ok((m[2] === 'rem' ? Number(m[1]) * 16 : Number(m[1])) >= 14, m[0]);
  assert.match(css, /\.btn-small \{ min-height: var\(--tap\);/);
  assert.match(css, /\.money-filters select \{ min-height: var\(--tap\);/);
});
