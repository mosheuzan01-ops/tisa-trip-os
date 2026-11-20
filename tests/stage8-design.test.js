// Stage 8 design v3 (docs/GOALS_STAGE8_DESIGN.md). Written before the version change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readText, readJson } from './helpers.js';

test('D8: the new design ships as 0.7.1 or later in all three places (cache-first: phones need a new version)', () => {
  const v = readJson('config/app.config.json').appVersion;
  const [a, b, c] = v.split('.').map(Number);
  assert.ok(a > 0 || b > 7 || (b === 7 && c >= 1), v);
  assert.equal(readJson('package.json').version, v);
  assert.match(readText('sw.js'), new RegExp(`const VERSION = '${v.replace(/\./g, '\\.')}';`));
});

test('D8-1: no pink, violet or lavender left in the theme colours (the platinum pass is gold-silver)', () => {
  const hue = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min;
    if (d < 0.08) return null; // greys carry no hue
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };
  const bad = [...readText('src/css/tokens.css').matchAll(/(--[\w-]+):\s*(#[0-9A-Fa-f]{6})/g)]
    .filter(([, , hex]) => { const h = hue(hex); return h !== null && h >= 250 && h <= 345; })
    .map(([, name, hex]) => `${name} ${hex}`);
  assert.deepEqual(bad, []);
});

test('D8-4: the 3D layer is CSS only and turns off with reduced motion', () => {
  const css = readText('src/css/main.css');
  const v3 = css.slice(css.indexOf('v3 (stage 8 design'));
  assert.match(v3, /perspective\(var\(--depth\)\)/);
  assert.match(v3, /@media \(prefers-reduced-motion: reduce\)[\s\S]*transform: none/);
});
