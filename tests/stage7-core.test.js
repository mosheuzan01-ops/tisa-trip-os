// Stage 7 core (docs/GOALS_STAGE7.md): photos metadata, place by date, ZIP backup, trip summary, schema v5.
// Written before the code (rule 12): every test here ran red first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJson } from './helpers.js';
import { SCHEMA_VERSION, migrate, validateState, createDefaultState, TRIP_FEATURE_FIELDS } from '../src/js/core/schema.js';
import {
  fitSize, exifDate, dateFromFile, placeOf, groupPhotos, toggleFeatured, slideshow, storageWarning, makePhoto,
  updatePhoto, validatePhotoEdit, removePhoto, FEATURE_MAX, MAX_SIDE,
} from '../src/js/core/photos.js';
import { crc32, zipStore, unzipStore } from '../src/js/core/zip.js';
import { buildPhotoManifest, photoEntries, parsePhotoBackup, mergePhotos, photoBackupName, PHOTO_FORMAT, LARGE_BYTES } from '../src/js/core/photo-backup.js';
import { summarize } from '../src/js/core/money.js';
import { tripSummary, budgetTable } from '../src/js/core/summary.js';

const opts = { now: () => new Date('2026-12-01T10:00:00Z'), appVersion: '0.7.0', makeId: () => 'trip-1', countryCode: 'TH', tripName: 'תאילנד' };
const v4 = () => readJson('tests/fixtures/v4-stage6.json');
const trip = () => migrate(v4(), opts).trips.t;

// ---------- schema v5 (S7-9) ----------
test('S7-9: schema is v5 and a fresh trip has no photos', () => {
  assert.equal(SCHEMA_VERSION, 5);
  const fresh = createDefaultState(opts);
  assert.deepEqual(fresh.trips['trip-1'].photos, []);
  assert.ok(TRIP_FEATURE_FIELDS.includes('photos'));
  assert.deepEqual(validateState(fresh), []);
});

test('S7-9: real v4 data from Stage 6 migrates to v5 with nothing lost', () => {
  const before = v4();
  const out = migrate(structuredClone(before), opts);
  assert.equal(out.schemaVersion, 5);
  const a = before.trips.t;
  const b = out.trips.t;
  for (const k of Object.keys(a)) assert.deepEqual(b[k], a[k], k);
  assert.deepEqual(b.photos, []);
  assert.deepEqual(out.settings, before.settings);
  assert.deepEqual(validateState(out), []);
});

test('S7-9: migration keeps photos that already exist, and v0 still reaches v5', () => {
  const s = v4();
  s.trips.t.photos = [{ id: 'p1', date: '2026-12-06' }];
  assert.deepEqual(migrate(s, opts).trips.t.photos, [{ id: 'p1', date: '2026-12-06' }]);
  const v0 = migrate({ schemaVersion: 0, trip: {}, theme: null }, opts);
  assert.equal(v0.schemaVersion, 5);
  assert.deepEqual(validateState(v0), []);
});

test('S7-9: validateState rejects photos that are not an array', () => {
  const s = migrate(v4(), opts);
  s.trips.t.photos = {};
  assert.ok(validateState(s).includes('trip.t.photos'));
});

// ---------- compression size (S7-2, the pure part) ----------
test('S7-2: fitSize brings the long side to 1280 and never enlarges', () => {
  assert.equal(MAX_SIDE, 1280);
  assert.deepEqual(fitSize(4032, 3024), { width: 1280, height: 960 });
  assert.deepEqual(fitSize(3024, 4032), { width: 960, height: 1280 });
  assert.deepEqual(fitSize(800, 600), { width: 800, height: 600 });
  assert.deepEqual(fitSize(5000, 1), { width: 1280, height: 1 });
});

// ---------- date of a photo ----------
/** A minimal JPEG with an EXIF block: APP1 "Exif\0\0", TIFF header, IFD0 with one pointer to the Exif IFD. */
function jpegWithExif(dateText, littleEndian = true) {
  const le = littleEndian;
  const tiff = [];
  const u16 = (v) => (le ? [v & 255, v >> 8] : [v >> 8, v & 255]);
  const u32 = (v) => (le ? [v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24] : [v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255]);
  // header (8) + IFD0: count(2) + 1 entry(12) + next(4) = 26 -> Exif IFD at 26: count(2)+entry(12)+next(4) = 18 -> string at 44
  tiff.push(...(le ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8));
  tiff.push(...u16(1), ...u16(0x8769), ...u16(4), ...u32(1), ...u32(26), ...u32(0));
  tiff.push(...u16(1), ...u16(0x9003), ...u16(2), ...u32(20), ...u32(44), ...u32(0));
  tiff.push(...[...dateText].map((c) => c.charCodeAt(0)), 0);
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = app1.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...app1, 0xff, 0xd9]);
}

test('exifDate reads the date the photo was taken (both byte orders) and ignores files without one', () => {
  assert.equal(exifDate(jpegWithExif('2026:12:06 18:22:10')), '2026-12-06');
  assert.equal(exifDate(jpegWithExif('2027:01:02 07:00:00', false)), '2027-01-02');
  assert.equal(exifDate(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])), null);
  assert.equal(exifDate(new Uint8Array([1, 2, 3])), null);
  assert.equal(exifDate(jpegWithExif('0000:00:00 00:00:00')), null);
});

test('dateFromFile: EXIF first, then the file date on the destination calendar, never invented', () => {
  assert.deepEqual(dateFromFile({ exif: '2026-12-06', lastModified: 0, timeZone: 'Asia/Bangkok' }), { date: '2026-12-06', dateSource: 'exif' });
  // 2026-12-06 20:30 in Israel is 2026-12-07 00:30 in Bangkok
  assert.deepEqual(dateFromFile({ exif: null, lastModified: Date.parse('2026-12-06T18:30:00Z'), timeZone: 'Asia/Bangkok' }), { date: '2026-12-07', dateSource: 'file' });
  assert.deepEqual(dateFromFile({ exif: null, lastModified: undefined, timeZone: 'Asia/Bangkok' }), { date: null, dateSource: null });
});

// ---------- place by date (S7-4) ----------
test('S7-4: a photo takes the destination of its date; on a travel day the one arrived at', () => {
  const t = trip();
  assert.deepEqual(placeOf({ date: '2026-12-06', stopId: null }, t), { kind: 'auto', stopId: 'd1', name: 'בנגקוק' });
  assert.equal(placeOf({ date: '2026-12-08', stopId: null }, t).stopId, 'd2');
  assert.equal(placeOf({ date: '2026-12-20', stopId: null }, t).stopId, 'd3');
});

test('S7-4: a date outside the route is "not assigned"; no date is its own state; a manual stop wins', () => {
  const t = trip();
  assert.deepEqual(placeOf({ date: '2026-11-01', stopId: null }, t), { kind: 'outside', stopId: null, name: null });
  assert.deepEqual(placeOf({ date: '2026-12-25', stopId: null }, t), { kind: 'outside', stopId: null, name: null }, 'in the trip dates but no stop that day');
  assert.deepEqual(placeOf({ date: null, stopId: null }, t), { kind: 'noDate', stopId: null, name: null });
  assert.deepEqual(placeOf({ date: '2026-12-06', stopId: 'd3' }, t), { kind: 'manual', stopId: 'd3', name: 'קו טאו' });
  assert.equal(placeOf({ date: '2026-12-06', stopId: 'gone' }, t).kind, 'auto', 'a deleted stop falls back to the date');
});

test('S7-4: groupPhotos puts photos under their day, in trip order, and the rest under "not assigned"', () => {
  const t = trip();
  const p = (id, date, extra = {}) => makePhoto({ id, date, dateSource: 'exif', width: 10, height: 10, bytes: 100, addedAt: `2026-12-0${id.length}T00:00:00Z`, ...extra });
  t.photos = [p('a', '2026-12-09'), p('b', '2026-12-06'), p('c', '2026-11-01'), p('d', null), p('e', '2026-12-06')];
  const g = groupPhotos(t);
  assert.deepEqual(g.days.map((d) => [d.date, d.photos.map((x) => x.id)]), [['2026-12-06', ['b', 'e']], ['2026-12-09', ['a']]]);
  assert.deepEqual(g.unassigned.map((x) => x.id), ['c', 'd']);
  assert.equal(g.count, 5);
});

// ---------- edit, delete, featured ----------
test('makePhoto has every field and no image data', () => {
  const x = makePhoto({ id: 'p', date: '2026-12-06', dateSource: 'file', width: 1280, height: 960, bytes: 200000, addedAt: '2026-12-06T10:00:00Z' });
  assert.deepEqual(Object.keys(x).sort(), ['addedAt', 'bytes', 'caption', 'date', 'dateSource', 'featured', 'height', 'id', 'stopId', 'width']);
  assert.equal(x.featured, false);
  assert.equal(x.stopId, null);
});

test('updatePhoto changes date, stop and caption; a bad edit changes nothing', () => {
  const list = [makePhoto({ id: 'p', date: '2026-12-06', dateSource: 'exif', width: 1, height: 1, bytes: 1, addedAt: 'x' })];
  const out = updatePhoto(list, 'p', { date: '2026-12-09', stopId: 'd2', caption: '  שקיעה  ' });
  assert.deepEqual([out[0].date, out[0].dateSource, out[0].stopId, out[0].caption], ['2026-12-09', 'manual', 'd2', 'שקיעה']);
  assert.equal(list[0].date, '2026-12-06', 'input not changed');
  assert.deepEqual(validatePhotoEdit({ date: '2026-13-40', caption: '' }), ['date.invalid']);
  assert.deepEqual(validatePhotoEdit({ date: '', caption: 'x'.repeat(141) }), ['caption.tooLong']);
  assert.deepEqual(updatePhoto(list, 'p', { date: 'bad' }), list);
  const same = updatePhoto(list, 'p', { date: '2026-12-06', stopId: '', caption: '' });
  assert.equal(same[0].dateSource, 'exif', 'same date keeps where it came from');
});

test('removePhoto takes it out of the list only', () => {
  const list = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(removePhoto(list, 'a'), [{ id: 'b' }]);
  assert.equal(list.length, 2);
});

test('toggleFeatured allows up to 12 and says why when full', () => {
  assert.equal(FEATURE_MAX, 12);
  let list = Array.from({ length: 13 }, (_, i) => makePhoto({ id: `p${i}`, date: '2026-12-06', dateSource: 'exif', width: 1, height: 1, bytes: 1, addedAt: 'x' }));
  for (let i = 0; i < 12; i += 1) ({ photos: list } = toggleFeatured(list, `p${i}`));
  assert.equal(list.filter((x) => x.featured).length, 12);
  const full = toggleFeatured(list, 'p12');
  assert.equal(full.error, 'featured.max');
  assert.equal(full.photos.filter((x) => x.featured).length, 12);
  assert.equal(toggleFeatured(list, 'p0').photos.find((x) => x.id === 'p0').featured, false);
});

test('slideshow: the chosen photos by date; none chosen gives up to 12 spread over the days, marked auto', () => {
  const t = trip();
  const mk = (i, date, featured = false) => makePhoto({ id: `p${String(i).padStart(2, '0')}`, date, dateSource: 'exif', width: 1, height: 1, bytes: 1, addedAt: `x${i}`, featured });
  t.photos = [mk(1, '2026-12-09', true), mk(2, '2026-12-06', true), mk(3, '2026-12-07')];
  const chosen = slideshow(t);
  assert.equal(chosen.auto, false);
  assert.deepEqual(chosen.list.map((x) => x.id), ['p02', 'p01']);
  t.photos = Array.from({ length: 30 }, (_, i) => mk(i, `2026-12-${String(5 + (i % 15)).padStart(2, '0')}`));
  const auto = slideshow(t);
  assert.equal(auto.auto, true);
  assert.equal(auto.list.length, 12);
  assert.equal(new Set(auto.list.map((x) => x.id)).size, 12);
  const dates = auto.list.map((x) => x.date);
  assert.deepEqual(dates, [...dates].sort(), 'in trip order');
  assert.ok(new Set(dates).size >= 10, 'spread over the days');
  t.photos = [];
  assert.deepEqual(slideshow(t), { auto: true, list: [] });
});

// ---------- storage warning ----------
test('storageWarning: over 80% used or under 50 MB free warns; unknown says nothing', () => {
  const MB = 1024 * 1024;
  assert.equal(storageWarning({ usage: 10 * MB, quota: 1000 * MB }), null);
  assert.deepEqual(storageWarning({ usage: 850 * MB, quota: 1000 * MB }), { pct: 85, freeBytes: 150 * MB });
  assert.deepEqual(storageWarning({ usage: 70 * MB, quota: 100 * MB }), { pct: 70, freeBytes: 30 * MB });
  assert.equal(storageWarning(null), null);
  assert.equal(storageWarning({ usage: 1 }), null);
});

// ---------- ZIP and photo backup (S7-8) ----------
test('crc32 matches the standard value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
});

test('S7-8: zipStore and unzipStore round-trip names (Hebrew too) and bytes', () => {
  const entries = [
    { name: 'photos.json', data: new TextEncoder().encode('{"a":1}') },
    { name: 'photos/שקיעה.jpg', data: new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]) },
    { name: 'empty.txt', data: new Uint8Array() },
  ];
  const zip = zipStore(entries, new Date('2026-12-20T12:00:00Z'));
  assert.deepEqual([...zip.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const back = unzipStore(zip);
  assert.deepEqual(back.map((e) => e.name), entries.map((e) => e.name));
  for (let i = 0; i < entries.length; i += 1) assert.deepEqual([...back[i].data], [...entries[i].data]);
  assert.equal(unzipStore(new Uint8Array([1, 2, 3])), null);
  const broken = zip.slice();
  broken[43] ^= 0xff; // a byte inside the first file's data (header 30 + name 11)
  assert.equal(unzipStore(broken), null, 'a damaged file fails its check');
});

test('S7-8: photo backup round-trip: manifest, files and thumbs come back the same', () => {
  const t = trip();
  t.photos = [
    makePhoto({ id: 'p1', date: '2026-12-06', dateSource: 'exif', width: 1280, height: 960, bytes: 5, addedAt: 'a' }),
    makePhoto({ id: 'p2', date: null, dateSource: null, width: 960, height: 1280, bytes: 4, addedAt: 'b' }),
  ];
  const files = new Map([['p1', { full: new Uint8Array([1, 2, 3, 4, 5]), thumb: new Uint8Array([9]) }], ['p2', { full: new Uint8Array([6, 7, 8, 9]), thumb: new Uint8Array([8]) }]]);
  const manifest = buildPhotoManifest(t, new Date('2026-12-20T12:00:00Z'));
  assert.equal(manifest.format, PHOTO_FORMAT);
  const zip = zipStore(photoEntries(manifest, files));
  const back = parsePhotoBackup(zip);
  assert.equal(back.ok, true);
  assert.deepEqual(back.manifest.photos, t.photos);
  assert.deepEqual([...back.files.get('p1').full], [1, 2, 3, 4, 5]);
  assert.deepEqual([...back.files.get('p2').thumb], [8]);
  assert.equal(photoBackupName(new Date('2026-12-20T12:00:00Z')), 'tisa-photos-2026-12-20.zip');
  assert.ok(LARGE_BYTES > 0);
});

test('S7-8: a bad photo backup is refused with a reason, never throws', () => {
  assert.deepEqual(parsePhotoBackup(new Uint8Array([1, 2])), { ok: false, error: 'notZip' });
  const noManifest = zipStore([{ name: 'x.txt', data: new Uint8Array([1]) }]);
  assert.deepEqual(parsePhotoBackup(noManifest), { ok: false, error: 'format' });
  const future = zipStore([{ name: 'photos.json', data: new TextEncoder().encode(JSON.stringify({ format: PHOTO_FORMAT, version: 99, photos: [] })) }]);
  assert.deepEqual(parsePhotoBackup(future), { ok: false, error: 'future' });
  const missing = zipStore([{ name: 'photos.json', data: new TextEncoder().encode(JSON.stringify({ format: PHOTO_FORMAT, version: 1, photos: [{ id: 'p1' }] })) }]);
  const r = parsePhotoBackup(missing);
  assert.equal(r.ok, true);
  assert.equal(r.files.has('p1'), false, 'a photo listed without its file is skipped, not invented');
  assert.deepEqual(r.manifest.photos, []);
});

test('S7-8: mergePhotos adds what is missing and never deletes or doubles', () => {
  const a = { id: 'a', caption: 'mine' };
  const out = mergePhotos([a], [{ id: 'a', caption: 'old' }, { id: 'b', caption: '' }]);
  assert.deepEqual(out.photos, [a, { id: 'b', caption: '' }]);
  assert.deepEqual([out.added, out.skipped], [1, 1]);
});

// ---------- summary and budget table (S7-6, S7-7) ----------
test('summarize gives each category its paid / planned / future split, adding up to its use', () => {
  const t = trip();
  const s = summarize(t.budget, t.expenses);
  const food = s.categories.find((c) => c.id === 'food');
  assert.deepEqual([food.paidMinor, food.plannedMinor, food.committedMinor, food.usedMinor], [3000, 12000, 0, 15000]);
});

test('S7-6: the summary takes every number from the money summary; nothing is worked out again', () => {
  const t = trip();
  const money = summarize(t.budget, t.expenses);
  const s = tripSummary(t, money, '2027-01-10');
  assert.equal(s.days, 30);
  assert.deepEqual(s.places.map((x) => x.name), ['בנגקוק', "צ'יאנג מאי", 'קו טאו']);
  assert.equal(s.spentMinor, money.paidMinor + money.plannedMinor + money.committedMinor + money.emergency.usedMinor);
  for (const c of s.categories) assert.equal(c.usedMinor, money.categories.find((x) => x.id === c.id).usedMinor, c.id);
  assert.equal(s.photos, 0);
});

test('S7-6: places are only the ones already reached by today; before the trip there are none', () => {
  const t = trip();
  const money = summarize(t.budget, t.expenses);
  assert.deepEqual(tripSummary(t, money, '2026-12-09').places.map((x) => x.id), ['d1', 'd2']);
  assert.deepEqual(tripSummary(t, money, '2026-11-01').places, []);
  t.startDate = null;
  assert.equal(tripSummary(t, money, '2026-12-09').days, null);
});

test('S7-7: budget table with a balanced budget: rows add up to the money totals, nothing over', () => {
  const budget = { currency: 'ILS', totalMinor: null, categoriesMinor: { food: 10000, lodging: 20000, emergency: 5000 }, profileId: null, estimate: false };
  const e = (id, category, status, baseMinor) => ({ id, category, status, baseMinor, date: '2026-12-06' });
  const money = summarize(budget, [e('1', 'food', 'paid', 4000), e('2', 'food', 'planned', 6000), e('3', 'lodging', 'committed', 20000)]);
  const tb = budgetTable(money);
  const sum = (k) => tb.rows.reduce((n, r) => n + r[k], 0);
  for (const [k, total] of [['planMinor', money.totalMinor], ['paidMinor', money.paidMinor], ['plannedMinor', money.plannedMinor], ['committedMinor', money.committedMinor], ['freeMinor', money.freeMinor]]) {
    assert.equal(sum(k), total, k);
    assert.equal(tb.total[k], total, `total ${k}`);
  }
  assert.equal(tb.total.freeMinor, 0);
  assert.equal(tb.rows.some((r) => r.over), false);
  assert.equal(tb.total.over, false);
  assert.deepEqual(tb.emergency, { planMinor: 5000, usedMinor: 0, leftMinor: 5000, over: false });
});

test('S7-7: budget table when over: the category and the total show the overrun as negative free', () => {
  const budget = { currency: 'ILS', totalMinor: null, categoriesMinor: { food: 10000, lodging: 20000 }, profileId: null, estimate: false };
  const money = summarize(budget, [{ id: '1', category: 'food', status: 'paid', baseMinor: 13000, date: '2026-12-06' }, { id: '2', category: 'shopping', status: 'paid', baseMinor: 500, date: '2026-12-06' }]);
  const tb = budgetTable(money);
  const food = tb.rows.find((r) => r.id === 'food');
  assert.deepEqual([food.freeMinor, food.over], [-3000, true]);
  const shop = tb.rows.find((r) => r.id === 'shopping');
  assert.deepEqual([shop.planMinor, shop.freeMinor, shop.over], [0, -500, true], 'a category without a plan still shows');
  assert.equal(tb.total.freeMinor, money.freeMinor);
  assert.equal(tb.total.freeMinor, 30000 - 13500);
  assert.equal(tb.total.over, false, 'over in a category, not in total');
});
