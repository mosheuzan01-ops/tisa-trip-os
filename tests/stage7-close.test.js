// Stage 7 closing (docs/GOALS_STAGE7.md, "סגירה"): checks that were missing before the iPhone round.
// Some may pass on the first run because the code already exists: those are recorded as characterization
// tests in docs/evidence/stage7-close/, not as a red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJson } from './helpers.js';
import { exportBackup, parseBackup } from '../src/js/core/backup.js';
import { migrate } from '../src/js/core/schema.js';
import { makePhoto } from '../src/js/core/photos.js';
import { zipStore } from '../src/js/core/zip.js';
import { buildPhotoManifest, photoEntries, parsePhotoBackup, mergePhotos } from '../src/js/core/photo-backup.js';

const opts = { now: () => new Date('2026-12-01T10:00:00Z'), appVersion: '0.7.1', makeId: () => 'trip-1', countryCode: 'TH', tripName: 'תאילנד' };
const sample = () => {
  const s = migrate(readJson('tests/fixtures/v4-stage6.json'), opts);
  s.trips.t.photos = [
    makePhoto({ id: 'p1', date: '2026-12-06', dateSource: 'exif', width: 1280, height: 960, bytes: 5, addedAt: 'a', caption: 'דוגמה' }),
    makePhoto({ id: 'p2', date: null, dateSource: null, width: 960, height: 1280, bytes: 4, addedAt: 'b', featured: true }),
  ];
  return s;
};

test('C4: the JSON backup carries the photo details (no image data) and restores them unchanged', () => {
  const s = sample();
  const text = JSON.stringify(exportBackup(s, new Date('2026-12-20T12:00:00Z')));
  assert.doesNotMatch(text, /data:image|base64/);
  const back = parseBackup(text, opts);
  assert.equal(back.ok, true);
  assert.deepEqual(back.state.trips.t.photos, s.trips.t.photos);
});

test('C4: a JSON backup from before photos (schema 4) restores with an empty photo list', () => {
  const v4 = readJson('tests/fixtures/v4-stage6.json');
  const back = parseBackup(JSON.stringify({ format: 'tisa-backup', schemaVersion: 4, exportedAt: '2026-12-01T00:00:00Z', data: v4 }), opts);
  assert.equal(back.ok, true);
  assert.deepEqual(back.state.trips.t.photos, []);
});

test('C3: restoring the same photo file twice adds nothing the second time and deletes nothing', () => {
  const s = sample();
  const files = new Map([['p1', { full: new Uint8Array([1, 2, 3]), thumb: null }], ['p2', { full: new Uint8Array([4]), thumb: null }]]);
  const zip = zipStore(photoEntries(buildPhotoManifest(s.trips.t, new Date()), files));
  const incoming = parsePhotoBackup(zip).manifest.photos;
  const once = mergePhotos([], incoming);
  const twice = mergePhotos(once.photos, incoming);
  assert.deepEqual([once.added, twice.added, twice.skipped], [2, 0, 2]);
  assert.deepEqual(twice.photos, once.photos);
  const mine = [makePhoto({ id: 'local', date: '2026-12-07', dateSource: 'manual', width: 1, height: 1, bytes: 1, addedAt: 'c' })];
  assert.deepEqual(mergePhotos(mine, incoming).photos.map((p) => p.id), ['local', 'p1', 'p2'], 'a photo only on this phone stays');
});
