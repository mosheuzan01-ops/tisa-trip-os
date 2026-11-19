// 0.5.5 (owner decision 2026-11-19): the backup-export fix and the stage-free texts must reach phones now.
// The service worker serves files cache first, so only a new version replaces the cached app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readText, readJson } from './helpers.js';

test('0.5.5 is set in all three places, so the cache on the phone updates', () => {
  assert.equal(readJson('config/app.config.json').appVersion, '0.5.5');
  assert.equal(readJson('package.json').version, '0.5.5');
  assert.match(readText('sw.js'), /const VERSION = '0\.5\.5';/);
});

test('the settings export button is wired inside the settings panel, not to the first export button in the page', () => {
  const app = readText('src/js/app.js');
  assert.match(app, /\$\('\[data-action="export"\]', panel\)\.addEventListener/);
  assert.doesNotMatch(app, /\$\('\[data-action="export"\]'\)\.addEventListener/);
});
