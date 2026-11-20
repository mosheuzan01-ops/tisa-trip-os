// 0.5.5 (owner decision 2026-11-19): the backup-export fix and the stage-free texts must reach phones now.
// The service worker serves files cache first, so only a new version replaces the cached app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readText, readJson } from './helpers.js';

// 0.6.0 (Stage 6 close) raised the version again: this now checks the fix's version or later, the same in all three places.
test('0.5.5 or later is set in all three places, so the cache on the phone updates', () => {
  const v = readJson('config/app.config.json').appVersion;
  const [major, minor, patch] = v.split('.').map(Number);
  assert.ok(major > 0 || minor > 5 || (minor === 5 && patch >= 5), v);
  assert.equal(readJson('package.json').version, v);
  assert.match(readText('sw.js'), new RegExp(`const VERSION = '${v.replace(/\./g, '\\.')}';`));
});

test('the settings export button is wired inside the settings panel, not to the first export button in the page', () => {
  const app = readText('src/js/app.js');
  assert.match(app, /\$\('\[data-action="export"\]', panel\)\.addEventListener/);
  assert.doesNotMatch(app, /\$\('\[data-action="export"\]'\)\.addEventListener/);
});
