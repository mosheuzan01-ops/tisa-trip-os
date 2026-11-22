// Stage 10, PR 1 (0.9.0): saved places (docs/GOALS_STAGE10.md, L1-L6, L11, L12). Written before the code (rule 12).
// Sample data only: made-up names, 2030 dates, round sample coordinates (rule 16).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readText, readJson, listFiles } from './helpers.js';
import {
  PLACE_STATUSES, PLACE_CATEGORIES, NAME_MAX, parseCoords, validatePlace, makePlace, savePlace, removePlace, cleanPlaces,
  filterPlaces, placeCounts, mapsUrl, planDay,
} from '../src/js/core/places.js';
import { GEO_OPTIONS, formatCoord, locate, geoPermission } from '../src/js/core/geo.js';
import { SCHEMA_VERSION, migrate, validateState, createDefaultState, TRIP_FEATURE_FIELDS } from '../src/js/core/schema.js';
import { exportBackup, parseBackup } from '../src/js/core/backup.js';
import { createStorage } from '../src/js/core/storage.js';

const opts = { now: () => new Date('2030-11-01T10:00:00Z'), appVersion: '0.9.0', makeId: () => 'trip-1', countryCode: 'TH', tripName: 'תאילנד' };
let n = 0;
const makeId = () => `p${(n += 1)}`;
const NOW = '2030-11-01T10:00:00.000Z';
const input = (over = {}) => ({
  name: 'שוק לילה לדוגמה', category: 'market', status: 'want', coords: '', address: '', note: '', stopId: '', plannedDate: '', visitedDate: '', ...over,
});
const trip = { startDate: '2030-12-20', endDate: '2031-01-10', destinations: [
  { id: 's1', name: 'בנגקוק', startDate: '2030-12-21', endDate: '2030-12-25' },
  { id: 's2', name: 'צ׳יאנג מאי', startDate: '2030-12-25', endDate: '2031-01-10' },
] };

// ---------- L2/L3: the fields, kept exactly ----------
test('P-1: three statuses (want to visit, visited, loved) and a fixed list of categories', () => {
  assert.deepEqual(PLACE_STATUSES, ['want', 'visited', 'loved']);
  assert.ok(PLACE_CATEGORIES.length >= 6 && PLACE_CATEGORIES.includes('food') && PLACE_CATEGORIES.includes('other'));
  assert.equal(NAME_MAX, 60);
});

test('P-2: coordinates are read from "lat, lng" exactly as typed (no rounding, nothing filled in)', () => {
  assert.deepEqual(parseCoords('13.75630, 100.50180'), { ok: true, lat: '13.75630', lng: '100.50180' });
  assert.deepEqual(parseCoords(' -8.1 115.0 '), { ok: true, lat: '-8.1', lng: '115.0' });
  assert.deepEqual(parseCoords(''), { ok: true, lat: null, lng: null });
  for (const bad of ['13.7', '91, 10', '10, 181', 'abc, 10', '13,7563, 100,5', '1e2, 3']) assert.equal(parseCoords(bad).ok, false, bad);
});

test('P-3: validation: name, category, status, coordinates, dates and the stop, as message keys', () => {
  assert.deepEqual(validatePlace(input(), { stopIds: ['s1'] }), []);
  assert.deepEqual(validatePlace(input({ name: '  ' }), {}), ['name.required']);
  assert.deepEqual(validatePlace(input({ name: 'א'.repeat(61) }), {}), ['name.tooLong']);
  assert.deepEqual(validatePlace(input({ category: 'x' }), {}), ['category.invalid']);
  assert.deepEqual(validatePlace(input({ status: 'x' }), {}), ['status.invalid']);
  assert.deepEqual(validatePlace(input({ coords: '100, 13' }), {}), ['coords.invalid']);
  assert.deepEqual(validatePlace(input({ plannedDate: '2030-13-01' }), {}), ['plannedDate.invalid']);
  assert.deepEqual(validatePlace(input({ visitedDate: 'yesterday' }), {}), ['visitedDate.invalid']);
  assert.deepEqual(validatePlace(input({ stopId: 'gone' }), { stopIds: ['s1'] }), ['stopId.invalid']);
  assert.deepEqual(validatePlace(input({ plannedDate: '2031-02-01' }), { trip }), ['plannedDate.outside']);
  assert.deepEqual(validatePlace(input({ note: 'א'.repeat(281) }), {}), ['note.tooLong']);
});

test('P-4 (L2): every typed field is saved exactly; empty ones stay empty; nothing is completed for the user', () => {
  const p = makePlace(input({ coords: '13.75630, 100.50180', address: 'רחוב לדוגמה 1', note: 'לבוא בערב', stopId: 's1', plannedDate: '2030-12-22', visitedDate: '' }), makeId, NOW);
  assert.equal(p.name, 'שוק לילה לדוגמה');
  assert.equal(p.lat, '13.75630');
  assert.equal(p.lng, '100.50180');
  assert.equal(p.address, 'רחוב לדוגמה 1');
  assert.equal(p.note, 'לבוא בערב');
  assert.equal(p.stopId, 's1');
  assert.equal(p.plannedDate, '2030-12-22');
  assert.equal(p.visitedDate, null);
  assert.deepEqual(p.photoIds, []);
  assert.equal(p.createdAt, NOW);
  const bare = makePlace(input(), makeId, NOW);
  assert.deepEqual([bare.lat, bare.lng, bare.address, bare.stopId, bare.plannedDate, bare.visitedDate], [null, null, '', null, null, null]);
});

test('P-5 (L5): marking "visited" or "loved" never fills the visit date, and the planned day stays as it was', () => {
  const p = makePlace(input({ plannedDate: '2030-12-22' }), makeId, NOW);
  const visited = makePlace(input({ status: 'visited', plannedDate: '2030-12-22' }), makeId, '2030-12-23T08:00:00.000Z', p);
  assert.equal(visited.visitedDate, null);
  assert.equal(visited.plannedDate, '2030-12-22');
  const loved = makePlace(input({ status: 'loved', plannedDate: '2030-12-22', visitedDate: '2030-12-24' }), makeId, NOW, visited);
  assert.equal(loved.visitedDate, '2030-12-24');
  assert.equal(loved.plannedDate, '2030-12-22', 'two separate fields');
});

test('P-6 (L1): edit keeps the id, the created time, linked photos and fields this version does not know', () => {
  const first = { ...makePlace(input(), makeId, NOW), photoIds: ['ph1'], futureField: { a: 1 } };
  const edited = makePlace(input({ name: 'שם חדש' }), makeId, '2030-11-02T10:00:00.000Z', first);
  assert.equal(edited.id, first.id);
  assert.equal(edited.createdAt, NOW);
  assert.equal(edited.updatedAt, '2030-11-02T10:00:00.000Z');
  assert.deepEqual(edited.photoIds, ['ph1']);
  assert.deepEqual(edited.futureField, { a: 1 });
});

test('P-7 (L1): save adds or replaces by id; remove takes out only that one; broken entries are skipped, not deleted', () => {
  const a = makePlace(input({ name: 'א' }), makeId, NOW);
  const b = makePlace(input({ name: 'ב' }), makeId, NOW);
  let list = savePlace(savePlace([], a), b);
  assert.deepEqual(list.map((x) => x.name), ['א', 'ב']);
  list = savePlace(list, { ...a, name: 'א2' });
  assert.deepEqual(list.map((x) => x.name), ['א2', 'ב']);
  assert.deepEqual(removePlace(list, a.id).map((x) => x.name), ['ב']);
  const raw = [a, null, 'x', { id: '' }, { name: 'no id' }, b];
  assert.deepEqual(cleanPlaces(raw).map((x) => x.id), [a.id, b.id]);
  assert.equal(raw.length, 6, 'the saved list is not changed');
});

// ---------- L4: search, filters, the two views ----------
test('P-8 (L4): search by text; filter by category, stop and status; "want" and "visited" views (loved counts as visited)', () => {
  const list = [
    makePlace(input({ name: 'מקדש לדוגמה', category: 'temple', status: 'want', stopId: 's1' }), makeId, NOW),
    makePlace(input({ name: 'מסעדה לדוגמה', category: 'food', status: 'visited', stopId: 's2', note: 'פאד תאי' }), makeId, NOW),
    makePlace(input({ name: 'חוף לדוגמה', category: 'beach', status: 'loved', stopId: 's2', address: 'כביש החוף' }), makeId, NOW),
  ];
  const names = (o) => filterPlaces(list, o).map((x) => x.name);
  assert.deepEqual(names({}), ['מקדש לדוגמה', 'מסעדה לדוגמה', 'חוף לדוגמה']);
  assert.deepEqual(names({ q: 'פאד' }), ['מסעדה לדוגמה'], 'note is searched');
  assert.deepEqual(names({ q: 'החוף' }), ['חוף לדוגמה'], 'address is searched');
  assert.deepEqual(names({ category: 'temple' }), ['מקדש לדוגמה']);
  assert.deepEqual(names({ stopId: 's2' }), ['מסעדה לדוגמה', 'חוף לדוגמה']);
  assert.deepEqual(names({ status: 'loved' }), ['חוף לדוגמה']);
  assert.deepEqual(names({ view: 'want' }), ['מקדש לדוגמה']);
  assert.deepEqual(names({ view: 'visited' }), ['מסעדה לדוגמה', 'חוף לדוגמה']);
  assert.deepEqual(names({ view: 'visited', category: 'food', q: 'מסעדה' }), ['מסעדה לדוגמה']);
  assert.deepEqual(placeCounts(list), { all: 3, want: 1, visited: 2 });
});

test('P-9 (L5): the planned day shows as "day N" of the trip and the stop of that date; no trip dates, no number', () => {
  assert.deepEqual(planDay('2030-12-22', trip), { n: 3, stopName: 'בנגקוק' });
  assert.deepEqual(planDay('2030-12-20', trip), { n: 1, stopName: null });
  assert.deepEqual(planDay('2030-12-22', { destinations: [] }), { n: null, stopName: null });
  assert.equal(planDay(null, trip), null);
});

// ---------- Google Maps: by coordinates, only on a tap (owner decision 2026-11-21, rule 5) ----------
const BASE = 'https://www.google.com/maps/search/?api=1&query=';
test('P-10: the map link is built from the coordinates only; a place without coordinates has no link', () => {
  const p = makePlace(input({ coords: '13.75630, 100.50180' }), makeId, NOW);
  assert.equal(mapsUrl(p, BASE), `${BASE}13.75630%2C100.50180`);
  assert.equal(mapsUrl(makePlace(input(), makeId, NOW), BASE), null);
  assert.equal(mapsUrl({ lat: '13.7', lng: null }, BASE), null);
});

test('P-11 (rule 5): the maps address lives once, in config; no app file has it or any other outside address', () => {
  assert.equal(readJson('config/app.config.json').mapsSearchUrl, BASE);
  const urls = readText('config/app.config.json').match(/https?:\/\/[^"]+/g) ?? [];
  assert.deepEqual(urls, [BASE]);
  for (const f of listFiles('src', ['.js'])) assert.doesNotMatch(readText(f), /google\.|maps\.app/i, f);
  assert.match(readText('docs/RULES.md'), /mapsSearchUrl/);
});

test('P-12: the map opens only from a tap (window.open in the click handler); nothing loads a map in the background', () => {
  const view = readText('src/js/places-view.js');
  assert.match(view, /addEventListener\('click'[\s\S]*place-map[\s\S]*window\.open\(/);
  assert.doesNotMatch(view, /<iframe|fetch\(|new Image\(|\.src = .*maps/i);
  assert.doesNotMatch(readText('index.html'), /iframe/i);
});

// ---------- L6: current location, only on a tap, no tracking ----------
const fakeGeo = (result) => {
  const calls = [];
  return {
    calls,
    getCurrentPosition(ok, fail, o) { calls.push(o); if (result.coords) ok(result); else fail(result); },
  };
};
test('P-13 (L6): one reading per tap, with a time limit; coordinates as 6-decimal text and the accuracy in metres', async () => {
  assert.equal(GEO_OPTIONS.enableHighAccuracy, true);
  assert.ok(GEO_OPTIONS.timeout > 0 && GEO_OPTIONS.timeout <= 20000);
  const geo = fakeGeo({ coords: { latitude: 13.7563, longitude: 100.5018, accuracy: 12.4 } });
  const r = await locate(geo);
  assert.deepEqual(r, { ok: true, lat: '13.756300', lng: '100.501800', accuracy: 12 });
  assert.equal(geo.calls.length, 1);
  assert.equal(formatCoord(-8.1), '-8.100000');
});

test('P-14 (L6): denied, no signal (airplane mode), timeout and no support each give their own calm message key', async () => {
  assert.deepEqual(await locate(fakeGeo({ code: 1 })), { ok: false, error: 'denied' });
  assert.deepEqual(await locate(fakeGeo({ code: 2 })), { ok: false, error: 'unavailable' });
  assert.deepEqual(await locate(fakeGeo({ code: 3 })), { ok: false, error: 'timeout' });
  assert.deepEqual(await locate(null), { ok: false, error: 'unsupported' });
  assert.deepEqual(await locate({ getCurrentPosition() { throw new Error('blocked'); } }), { ok: false, error: 'unavailable' });
});

test('P-15 (L6): the permission state is read when the browser can tell; otherwise "unknown" (never asks by itself)', async () => {
  const nav = (state) => ({ permissions: { query: async ({ name }) => { assert.equal(name, 'geolocation'); return { state }; } } });
  assert.equal(await geoPermission(nav('granted')), 'granted');
  assert.equal(await geoPermission(nav('denied')), 'denied');
  assert.equal(await geoPermission(nav('prompt')), 'prompt');
  assert.equal(await geoPermission({}), 'unknown');
  assert.equal(await geoPermission({ permissions: { query: async () => { throw new Error('no'); } } }), 'unknown');
});

test('P-16 (L6): no tracking anywhere: no watchPosition, and only core/geo.js asks for the position', () => {
  for (const f of [...listFiles('src', ['.js']), 'sw.js']) {
    const src = readText(f);
    assert.doesNotMatch(src, /watchPosition/, f);
    if (f !== 'src/js/core/geo.js') assert.doesNotMatch(src, /getCurrentPosition/, f);
  }
  assert.match(readText('src/js/places-view.js'), /addEventListener\('click'[\s\S]*locate\(/);
});

// ---------- L11: storage, migration, backup ----------
test('P-17 (L11): schema 7 adds an empty places list to every trip; nothing else changes', () => {
  assert.equal(SCHEMA_VERSION, 7);
  assert.ok(TRIP_FEATURE_FIELDS.includes('places'));
  const fresh = createDefaultState(opts);
  assert.deepEqual(fresh.trips['trip-1'].places, []);
  const v6 = migrate(readJson('tests/fixtures/v5-stage7.json'), opts);
  const before = structuredClone(v6);
  before.schemaVersion = 6;
  for (const t of Object.values(before.trips)) delete t.places; // a real v6 trip has no places field
  const out = migrate(structuredClone(before), opts);
  assert.equal(out.schemaVersion, 7);
  assert.deepEqual(validateState(out), []);
  for (const [id, t] of Object.entries(out.trips)) {
    assert.deepEqual(t.places, []);
    const { places, ...rest } = t;
    assert.deepEqual(rest, before.trips[id], `trip ${id} unchanged apart from places`);
  }
  const kept = structuredClone(before);
  kept.trips[kept.activeTripId].places = [{ id: 'x', name: 'נשמר' }];
  assert.deepEqual(migrate(kept, opts).trips[kept.activeTripId].places, [{ id: 'x', name: 'נשמר' }], 'existing places are kept');
});

test('P-18 (L11): validateState needs places to be a list', () => {
  const s = createDefaultState(opts);
  s.trips['trip-1'].places = {};
  assert.ok(validateState(s).includes('trip.trip-1.places'));
});

test('P-19 (L11): places go into the backup and come back exactly; a v6 backup imports with an empty list', () => {
  const s = createDefaultState(opts);
  const p = makePlace(input({ coords: '13.75630, 100.50180', plannedDate: '2030-12-22' }), makeId, NOW);
  s.trips['trip-1'].places = [p];
  const r = parseBackup(JSON.stringify(exportBackup(s, new Date(NOW))), opts);
  assert.ok(r.ok);
  assert.deepEqual(r.state.trips['trip-1'].places, [p]);
  const old = createDefaultState(opts);
  old.schemaVersion = 6;
  delete old.trips['trip-1'].places;
  const r6 = parseBackup(JSON.stringify({ format: 'tisa-backup', schemaVersion: 6, exportedAt: NOW, data: old }), opts);
  assert.ok(r6.ok);
  assert.deepEqual(r6.state.trips['trip-1'].places, []);
});

test('P-20 (L11): storage moves saved v6 data to v7 and keeps the exact old text once (same key tisa:v1)', () => {
  const map = new Map();
  const backend = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, v) };
  const old = createDefaultState(opts);
  old.schemaVersion = 6;
  delete old.trips['trip-1'].places;
  const raw = JSON.stringify(old);
  map.set('tisa:v1', raw);
  const st = createStorage({ backend, key: 'tisa:v1', ...opts });
  const loaded = st.load();
  assert.equal(loaded.status, 'migrated');
  assert.deepEqual(loaded.state.trips['trip-1'].places, []);
  assert.equal(map.get('tisa:premigration:v6'), raw);
});

// ---------- Screen wiring, offline, version ----------
test('P-21: the places screen has its own address, panel, class names and data attributes (rule 14), and is cached offline', () => {
  const app = readText('src/js/app.js');
  assert.match(app, /places: \{ tab: 'itinerary'/);
  const html = readText('index.html');
  assert.match(html, /id="panel-places"/);
  assert.match(html, /data-go="places"/);
  assert.doesNotMatch(readText('src/js/places-view.js'), /className = ['"`][^'"`]*\bstop\b|dataset\.date\b/);
  const sw = readText('sw.js');
  for (const f of ['places-view.js', 'core/places.js', 'core/geo.js']) assert.match(sw, new RegExp(`'\\./src/js/${f.replace('.', '\\.')}'`));
});

test('P-22: version 0.9.0 or later in package.json, config and sw.js', () => {
  const v = readJson('package.json').version;
  const [maj, min] = v.split('.').map(Number);
  assert.ok(maj > 0 || min >= 9, v);
  assert.equal(readJson('config/app.config.json').appVersion, v);
  assert.match(readText('sw.js'), new RegExp(`const VERSION = '${v.replace(/\./g, '\\.')}';`));
});
