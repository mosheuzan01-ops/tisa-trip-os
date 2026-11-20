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
test('0.6.1 is set in all three places, so the fix reaches the phone', () => {
  assert.equal(JSON.parse(readText('config/app.config.json')).appVersion, '0.6.1');
  assert.equal(JSON.parse(readText('package.json')).version, '0.6.1');
  assert.match(readText('sw.js'), /const VERSION = '0\.6\.1';/);
});
