// Design system v2 "metal discipline" guards (docs/GOALS_DESIGN_V2.md D1-D5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readText } from './helpers.js';

const html = readText('index.html');
const tokens = readText('src/css/tokens.css');
const css = readText('src/css/main.css');
const classLists = [...html.matchAll(/class="([^"]+)"/g)].map((m) => m[1].split(/\s+/));

test('D1: dark metal only on the next-step card and its sheets', () => {
  const offenders = classLists.filter((c) => c.includes('dmetal') && !c.includes('setup') && !c.includes('sheet'));
  assert.deepEqual(offenders.map((c) => c.join(' ')), []);
});

test('D2: platinum metal only on the trip pass', () => {
  const offenders = classLists.filter((c) => c.includes('metal') && !c.includes('face'));
  assert.deepEqual(offenders.map((c) => c.join(' ')), []);
});

test('D3: retired dark-metal tokens are gone', () => {
  for (const fam of ['today', 't1', 't2', 't3', 't4', 'nav']) {
    assert.ok(!tokens.includes(`--m-${fam}-`), `--m-${fam}-* still defined`);
    assert.ok(!css.includes(`--m-${fam}-`), `--m-${fam}-* still used`);
  }
});

test('D5: calm components have hover, focus-visible and active states', () => {
  for (const sel of ['.tile', '.tab', '.choice', '.icon-btn', '.btn-primary']) {
    for (const st of [':hover', ':active']) {
      assert.ok(css.includes(`${sel}${st}`), `${sel}${st} missing`);
    }
  }
  assert.ok(/:focus-visible/.test(css), 'focus-visible missing');
  assert.ok(classLists.some((c) => c.includes('surface')), 'no .surface used in index.html');
});
