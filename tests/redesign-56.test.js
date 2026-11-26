// PR #56 (owner-approved design: home direction B, budget direction A, FreeSerif Bold figures).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, readText } from './helpers.js';
import { ringShare } from '../src/js/core/money.js';

const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const block = (css, sel) => css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)));
const tok = (css, name) => new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(css)?.[1];

test('R1: ringShare is paid / running budget, clamped, null without a budget', () => {
  assert.equal(ringShare(0, 0), null);
  assert.equal(ringShare(500, -1), null);
  assert.equal(ringShare(0, 20000), 0);
  assert.equal(ringShare(5000, 20000), 0.25);
  assert.equal(ringShare(30000, 20000), 1);
  assert.equal(ringShare(-10, 20000), 0);
});

test('R2: the pass metal is about 25% darker than the shared metal, same hue family, both themes', () => {
  const css = readText('src/css/tokens.css');
  for (const theme of [':root, [data-theme="light"]', '[data-theme="dark"]']) {
    const b = block(css.slice(css.indexOf(theme)), '--metal-1') + css.slice(css.indexOf(theme)).split('}')[0];
    for (let i = 1; i <= 7; i += 1) {
      const metal = tok(b, `--metal-${i}`); const pass = tok(b, `--pass-${i}`);
      assert.ok(metal && pass, `${theme} --pass-${i}`);
      hex(metal).forEach((v, k) => assert.ok(Math.abs(hex(pass)[k] - v * 0.75) <= 1, `${theme} --pass-${i} channel ${k}`));
    }
  }
  const main = readText('src/css/main.css');
  assert.match(main, /\.pass\s*\{[^}]*--metal-1:\s*var\(--pass-1\)/, 'the pass scopes the darker metal to itself');
});

test('R3: the budget ring stroke is 15% thicker than the prototype (9 -> 10.35), same 200 viewBox', () => {
  const html = readText('index.html');
  assert.match(html, /class="money-ring"[\s\S]*?viewBox="0 0 200 200"/);
  assert.match(readText('src/css/main.css'), /\.money-ring circle\s*\{[^}]*stroke-width:\s*10\.35/);
});

test('R4: FreeSerif Bold is bundled locally with its GPL + font exception notice, and precached', () => {
  const file = 'assets/fonts/FreeSerifBold.ttf';
  assert.ok(existsSync(join(ROOT, file)) && statSync(join(ROOT, file)).size > 1e6);
  assert.match(readText('assets/fonts/LICENSE-FreeFont.txt'), /font exception/i);
  assert.match(readText('src/css/fonts.css'), /url\("\.\.\/\.\.\/assets\/fonts\/FreeSerifBold\.ttf"\)/);
  assert.match(readText('sw.js'), /'\.\/assets\/fonts\/FreeSerifBold\.ttf'/);
  assert.match(readText('src/css/tokens.css'), /--font-figure:\s*"FreeSerif"/);
  assert.match(readText('src/css/main.css'), /\.money-big[^{]*\{[^}]*var\(--font-figure\)/);
});
