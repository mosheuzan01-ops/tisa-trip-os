// Stage 10, PR 2 (0.9.1): photos of places in the slideshow, sharing, copying, places files (docs/GOALS_STAGE10.md,
// L7-L10). Written before the code (rule 12). Sample data only: made-up names, 2030 dates (rule 16).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readText, readJson } from './helpers.js';
import { makePlace } from '../src/js/core/places.js';
import {
  SHARE_FIELDS, DEFAULT_SHARE_FIELDS, shareText, PLACES_FORMAT, exportPlaces, placesFileName, parsePlaces, mergePlaces, placeOfPhoto,
} from '../src/js/core/place-share.js';
import { makePhoto, slideshow, toggleFeatured, FEATURE_MAX } from '../src/js/core/photos.js';

const NOW = '2030-11-01T10:00:00.000Z';
let n = 0;
const makeId = () => `n${(n += 1)}`;
const input = (over = {}) => ({ name: 'שוק לילה לדוגמה', category: 'market', status: 'want', coords: '', address: '', note: '', stopId: '', plannedDate: '', visitedDate: '', ...over });
const BASE = 'https://www.google.com/maps/search/?api=1&query=';
// A translator that shows the key, so the tests do not depend on the copy.
const t = (k) => `[${k}]`;
const fmt = (iso) => `d:${iso}`;

// ---------- L8/L9: share text, only the chosen fields ----------
test('S-1 (L8): the share text has only the fields the user chose, in a fixed order; the note is off by default', () => {
  assert.deepEqual(SHARE_FIELDS, ['name', 'category', 'address', 'coords', 'map', 'planned', 'visited', 'note']);
  assert.deepEqual(DEFAULT_SHARE_FIELDS, ['name', 'address', 'map']);
  const p = makePlace(input({ coords: '13.75630, 100.50180', address: 'רחוב לדוגמה 1', note: 'פרטי', plannedDate: '2030-12-22' }), makeId, NOW);
  const text = shareText(p, ['name', 'map'], { t, mapsBase: BASE, fmtDate: fmt });
  assert.equal(text, `שוק לילה לדוגמה\n${BASE}13.75630%2C100.50180`);
  assert.doesNotMatch(text, /פרטי|רחוב|d:/);
  const all = shareText(p, SHARE_FIELDS, { t, mapsBase: BASE, fmtDate: fmt });
  assert.deepEqual(all.split('\n'), [
    'שוק לילה לדוגמה', '[place.cat.market]', 'רחוב לדוגמה 1', '13.75630, 100.50180', `${BASE}13.75630%2C100.50180`, '[place.share.planned] d:2030-12-22', 'פרטי',
  ], 'empty fields (visit date) are left out');
});

test('S-2 (L8): a chosen field that is empty adds nothing; no coordinates means no map line; nothing invented', () => {
  const p = makePlace(input(), makeId, NOW);
  assert.equal(shareText(p, SHARE_FIELDS, { t, mapsBase: BASE, fmtDate: fmt }), 'שוק לילה לדוגמה\n[place.cat.market]');
  assert.equal(shareText(p, [], { t, mapsBase: BASE, fmtDate: fmt }), '');
});

test('S-3: sharing my current location: a one-time reading, coordinates and map link only', () => {
  const here = { name: '[place.share.hereName]', lat: '13.756300', lng: '100.501800' };
  assert.equal(shareText(here, ['name', 'coords', 'map'], { t, mapsBase: BASE, fmtDate: fmt }), `[place.share.hereName]\n13.756300, 100.501800\n${BASE}13.756300%2C100.501800`);
});

test('S-4 (L8, L9): share sheet first, then copy; no direct WhatsApp link and no new outside address', () => {
  const view = readText('src/js/places-view.js');
  assert.match(view, /navigator\.share\(/);
  assert.match(view, /clipboard\.writeText\(/);
  assert.match(view, /execCommand\('copy'\)/, 'fallback for older browsers');
  assert.doesNotMatch(view, /wa\.me|whatsapp:\/\/|api\.whatsapp/i);
  const urls = readText('config/app.config.json').match(/https?:\/\/[^"]+/g) ?? [];
  assert.deepEqual(urls, [BASE], 'still only the maps address (rule 5)');
});

// ---------- L10: places files: export and import, no overwrite, no duplicates ----------
test('S-5 (L10): export: a "tisa-places" file with the place details only (no personal dates, status or photos)', () => {
  const p = { ...makePlace(input({ coords: '13.7, 100.5', address: 'א', note: 'ב', status: 'loved', visitedDate: '2030-12-23', plannedDate: '2030-12-22' }), makeId, NOW), photoIds: ['ph1'] };
  const file = exportPlaces([p], new Date(NOW));
  assert.equal(PLACES_FORMAT, 'tisa-places');
  assert.deepEqual(Object.keys(file).sort(), ['exportedAt', 'format', 'places', 'version']);
  assert.equal(file.version, 1);
  assert.deepEqual(file.places, [{ id: p.id, name: p.name, category: 'market', lat: '13.7', lng: '100.5', address: 'א', note: 'ב' }]);
  assert.equal(placesFileName(new Date(NOW)), 'tisa-places-2030-11-01.json');
});

test('S-6 (L10): parse: bad files are refused with a code; bad entries are skipped and counted, never fixed up', () => {
  assert.deepEqual(parsePlaces(''), { ok: false, error: 'empty' });
  assert.deepEqual(parsePlaces('{'), { ok: false, error: 'notJson' });
  assert.deepEqual(parsePlaces('{"format":"tisa-backup"}'), { ok: false, error: 'format' });
  assert.deepEqual(parsePlaces('{"format":"tisa-places","version":2,"places":[]}'), { ok: false, error: 'future' });
  assert.deepEqual(parsePlaces('{"format":"tisa-places","version":1}'), { ok: false, error: 'structure' });
  const r = parsePlaces(JSON.stringify({ format: 'tisa-places', version: 1, exportedAt: NOW, places: [
    { id: 'a', name: 'טוב', category: 'food', lat: '13.7', lng: '100.5', address: '', note: '' },
    { id: 'b', name: '', category: 'food' },
    { id: 'c', name: 'קואורדינטות שבורות', category: 'food', lat: '200', lng: '1' },
    'x',
  ] }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.places.map((x) => x.name), ['טוב']);
  assert.equal(r.invalid, 3);
});

test('S-7 (L10): import adds only new places, as "want to visit", without dates; nothing existing is changed', () => {
  const mine = makePlace(input({ name: 'שלי', status: 'loved', visitedDate: '2030-12-23', note: 'שלי' }), makeId, NOW);
  const before = structuredClone([mine]);
  const incoming = parsePlaces(JSON.stringify(exportPlaces([makePlace(input({ name: 'חדש', coords: '13.7, 100.5' }), makeId, NOW)], new Date(NOW)))).places;
  const r = mergePlaces([mine], incoming, makeId, NOW);
  assert.equal(r.added, 1);
  assert.equal(r.duplicates, 0);
  assert.deepEqual(r.places[0], before[0], 'the existing place is exactly as it was');
  const added = r.places[1];
  assert.equal(added.name, 'חדש');
  assert.equal(added.status, 'want');
  assert.deepEqual([added.plannedDate, added.visitedDate, added.stopId], [null, null, null]);
  assert.deepEqual(added.photoIds, []);
  assert.equal(added.lat, '13.7');
});

test('S-8 (L10): importing the same file twice adds nothing the second time; same name and place counts as the same', () => {
  const file = JSON.stringify(exportPlaces([
    makePlace(input({ name: 'א', coords: '13.7, 100.5' }), makeId, NOW),
    makePlace(input({ name: 'ב' }), makeId, NOW),
  ], new Date(NOW)));
  const once = mergePlaces([], parsePlaces(file).places, makeId, NOW);
  assert.equal(once.added, 2);
  const twice = mergePlaces(once.places, parsePlaces(file).places, makeId, NOW);
  assert.equal(twice.added, 0);
  assert.equal(twice.duplicates, 2);
  assert.deepEqual(twice.places, once.places);
  // A friend's file with a new id for a place I already have (same name, same coordinates, spaces and case aside)
  const friend = [{ id: 'other', name: '  א ', category: 'food', lat: '13.7', lng: '100.5', address: '', note: '' }];
  assert.equal(mergePlaces(once.places, friend, makeId, NOW).added, 0);
  // The same name somewhere else is a different place
  const elsewhere = [{ id: 'other2', name: 'א', category: 'food', lat: '18.7', lng: '98.9', address: '', note: '' }];
  assert.equal(mergePlaces(once.places, elsewhere, makeId, NOW).added, 1);
  // Duplicates inside one file count once
  const dup = mergePlaces([], [...friend, { ...friend[0], id: 'other3' }], makeId, NOW);
  assert.deepEqual([dup.added, dup.duplicates], [1, 1]);
});

test('S-9 (L10): an incoming id I already have is the same place, even if I renamed it since: skipped, never overwritten', () => {
  const mine = makePlace(input({ name: 'שם שערכתי' }), () => 'same', NOW);
  const r = mergePlaces([mine], [{ id: 'same', name: 'השם המקורי', category: 'food', lat: null, lng: null, address: '', note: '' }], () => 'fresh', NOW);
  assert.deepEqual([r.added, r.duplicates], [0, 1]);
  assert.deepEqual(r.places, [mine]);
  const noId = mergePlaces([], [{ id: '', name: 'בלי מזהה', category: 'food', lat: null, lng: null, address: '', note: '' }], () => 'fresh', NOW);
  assert.equal(noId.places[0].id, 'fresh', 'an entry without an id gets a new one');
});

// ---------- L7: photos of places in the slideshow ----------
const mk = (i, date, featured = false) => makePhoto({ id: `ph${String(i).padStart(2, '0')}`, date, dateSource: 'exif', width: 1, height: 1, bytes: 1, addedAt: `x${i}`, featured });

test('S-10 (L7): a photo linked to a place joins the slideshow; starred photos stay as they are', () => {
  const photos = [mk(1, '2030-12-21', true), mk(2, '2030-12-22'), mk(3, '2030-12-23'), mk(4, '2030-12-24')];
  const before = structuredClone(photos);
  const trip = { startDate: '2030-12-20', destinations: [], photos, places: [{ ...makePlace(input(), makeId, NOW), photoIds: ['ph03'] }] };
  const show = slideshow(trip);
  assert.equal(show.auto, false);
  assert.deepEqual(show.list.map((p) => p.id), ['ph01', 'ph03'], 'starred and place photos, in trip order');
  assert.deepEqual(trip.photos, before, 'no star changed');
});

test('S-11 (L7): at most 12 in all: starred photos first, then place photos, shown in trip order', () => {
  const photos = Array.from({ length: 20 }, (_, i) => mk(i, `2030-12-${String(i + 1).padStart(2, '0')}`, i >= 10));
  const linked = photos.slice(0, 10).map((p) => p.id);
  const trip = { destinations: [], photos, places: [{ ...makePlace(input(), makeId, NOW), photoIds: linked }] };
  const show = slideshow(trip);
  assert.equal(show.list.length, FEATURE_MAX);
  assert.equal(show.list.filter((p) => p.featured).length, 10, 'all 10 starred are in');
  assert.deepEqual(show.list.filter((p) => !p.featured).map((p) => p.id), ['ph00', 'ph01'], 'then the first place photos by date');
  const ids = show.list.map((p) => p.id);
  assert.deepEqual(ids, [...ids].sort(), 'trip order');
});

test('S-12 (L7): linking does not touch the 12-star limit; a link to a deleted photo is skipped, not shown', () => {
  const photos = Array.from({ length: 12 }, (_, i) => mk(i, '2030-12-21', true));
  const trip = { destinations: [], photos: [...photos, mk(30, '2030-12-22')], places: [{ ...makePlace(input(), makeId, NOW), photoIds: ['ph30', 'gone'] }] };
  assert.equal(toggleFeatured(trip.photos, 'ph30').error, 'featured.max', 'the star rule is the same as before');
  const show = slideshow(trip);
  assert.equal(show.list.length, 12);
  assert.ok(!show.list.some((p) => p?.id === 'gone'));
  const none = slideshow({ destinations: [], photos: [mk(1, '2030-12-21')], places: [] });
  assert.equal(none.auto, true, 'no stars and no place photos: the automatic choice as before');
});

test('S-13 (L7): the slide shows the place name: the first place that links the photo, or none', () => {
  const places = [{ ...makePlace(input({ name: 'מקדש לדוגמה' }), makeId, NOW), photoIds: ['ph01'] }, { ...makePlace(input({ name: 'שני' }), makeId, NOW), photoIds: ['ph01'] }];
  assert.equal(placeOfPhoto('ph01', places)?.name, 'מקדש לדוגמה');
  assert.equal(placeOfPhoto('ph02', places), null);
  assert.equal(placeOfPhoto('ph01', undefined), null);
  assert.match(readText('src/js/summary-view.js'), /placeOfPhoto\(/);
});

test('S-14 (L7): a place keeps photo ids only (no copy of the image); the dialog can link and unlink', () => {
  const p = makePlace({ ...input(), photoIds: ['ph01', 'ph02', 'ph01', 5] }, makeId, NOW);
  assert.deepEqual(p.photoIds, ['ph01', 'ph02']);
  const kept = makePlace(input({ name: 'עריכה' }), makeId, NOW, p);
  assert.deepEqual(kept.photoIds, ['ph01', 'ph02'], 'no photo field in the form: links stay');
  const cleared = makePlace({ ...input(), photoIds: [] }, makeId, NOW, p);
  assert.deepEqual(cleared.photoIds, []);
});

// ---------- Version, cache ----------
test('S-15: version 0.9.1 or later; the new file is cached offline', () => {
  const v = readJson('package.json').version;
  const [maj, min, patch] = v.split('.').map(Number);
  assert.ok(maj > 0 || min > 9 || (min === 9 && patch >= 1), v);
  assert.equal(readJson('config/app.config.json').appVersion, v);
  assert.match(readText('sw.js'), new RegExp(`const VERSION = '${v.replace(/\./g, '\\.')}';`));
  assert.match(readText('sw.js'), /'\.\/src\/js\/core\/place-share\.js'/);
});
