// QA before Stage 7 (site-qa-before-publish on 0.6.0). The live check (scripts/qa/qa-live-060.cjs) found that the
// browser's own picker button inside date and time fields took focus with no visible ring (WCAG 2.4.7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readText } from './helpers.js';

test('date and time fields show the focus ring while their picker button has focus (:focus-within)', () => {
  const css = readText('src/css/main.css');
  assert.match(css, /\.field input:focus-within\s*\{\s*outline/);
  assert.match(css, /\.surface \.field input:focus-within\s*\{\s*outline-color: var\(--focus\)/);
});

// The CSS fix only reaches phones with a new version (the service worker serves files cache first).
// 0.7.0 (Stage 7) raised it again: this now checks 0.6.1 or later, the same in all three places.
test('0.6.1 or later is set in all three places, so the fix reaches the phone', () => {
  const v = JSON.parse(readText('config/app.config.json')).appVersion;
  const [a, b, c] = v.split('.').map(Number);
  assert.ok(a > 0 || b > 6 || (b === 6 && c >= 1), v);
  assert.equal(JSON.parse(readText('package.json')).version, v);
  assert.match(readText('sw.js'), new RegExp(`const VERSION = '${v.replace(/\./g, '\\.')}';`));
});
