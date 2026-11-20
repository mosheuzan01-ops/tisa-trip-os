// Stage 7 rules. Rule 14: a new screen's class names must not reuse a class that JavaScript toggles as state.
// Found in 7.0c: a ".show" slideshow rule also styled the toast, whose JS adds the class "show" (fixed: .slides).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readText, readJson } from './helpers.js';

test('rule 14: no stylesheet rule for a bare ".show" outside the toast (the toast toggles that class)', () => {
  const css = readText('src/css/main.css');
  const bare = css.split('\n').filter((l) => /(^|[\s,}])\.show\b(?![-\w])/.test(l) && !/\.toast\.show\b/.test(l));
  assert.deepEqual(bare, []);
});

test('Stage 7 screens and dialogs exist with their own names (rule 14)', () => {
  const html = readText('index.html');
  for (const id of ['panel-photos', 'panel-summary', 'dlg-photo', 'dlg-photo-delete', 'dlg-show', 'photo-file', 'photos-import-file']) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /class="slides"/);
});

test('every Stage 7 file is in the offline cache', () => {
  const sw = readText('sw.js');
  for (const f of ['photo-store.js', 'photos-view.js', 'summary-view.js', 'core/photos.js', 'core/zip.js', 'core/photo-backup.js', 'core/summary.js']) {
    assert.ok(sw.includes(`'./src/js/${f}'`), f);
  }
});

test('every Stage 7 text exists in Hebrew and English', () => {
  const he = readJson('locales/he.json');
  const en = readJson('locales/en.json');
  const keys = Object.keys(he).filter((k) => /^(photo|photoErr|photoBackup|sum)\.|^screen\.(photos|summary)$|^cal\.photosLabel$/.test(k));
  assert.ok(keys.length > 80, String(keys.length));
  for (const k of keys) assert.ok(typeof en[k] === 'string' && en[k], k);
});

test('photos never go to a server: no fetch, XHR or upload in the photo code', () => {
  for (const f of ['src/js/photo-store.js', 'src/js/photos-view.js', 'src/js/summary-view.js', 'src/js/core/photos.js', 'src/js/core/zip.js', 'src/js/core/photo-backup.js']) {
    assert.doesNotMatch(readText(f), /\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket/, f);
  }
});

test('S7-10: 0.7.0 or later in all three places, so phones on the cache-first worker get Stage 7', () => {
  const v = readJson('config/app.config.json').appVersion;
  const [major, minor] = v.split('.').map(Number);
  assert.ok(major > 0 || minor >= 7, v);
  assert.equal(readJson('package.json').version, v);
  assert.match(readText('sw.js'), new RegExp(`const VERSION = '${v.replace(/\./g, '\\.')}';`));
});

test('docs: the backup format describes schema 5 and the separate photo file', () => {
  const doc = readText('docs/BACKUP_FORMAT.md');
  assert.match(doc, /photos/);
  assert.match(doc, /tisa-photos/);
});
