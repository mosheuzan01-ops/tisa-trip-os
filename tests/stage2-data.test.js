// Stage 2: data model, storage, migration, backup. Written before the code (docs/GOALS_STAGE2.md B2-B8, B10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA_VERSION, createDefaultState, validateState, migrate, TRIP_FEATURE_FIELDS } from '../src/js/core/schema.js';
import { createStorage } from '../src/js/core/storage.js';
import { exportBackup, parseBackup, backupFileName, BACKUP_FORMAT } from '../src/js/core/backup.js';
import { makeId } from '../src/js/core/ids.js';
import { createAutosave } from '../src/js/core/autosave.js';
import { needsBackupReminder } from '../src/js/core/schema.js';

const NOW = new Date('2026-11-19T12:00:00Z');
let n = 0;
const ids = () => `id-${++n}`;
const OPTS = { now: () => NOW, appVersion: '0.2.0', makeId: ids, countryCode: 'TH', tripName: 'טיול' };

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
}
const open = (backend) => createStorage({ backend, key: 'tisa:v1', legacy: { trip: 'tisa:trip', theme: 'tisa:theme' }, ...OPTS });

test('B2: first load creates valid defaults with exactly one trip', () => {
  const backend = memoryStorage();
  const { state, status } = open(backend).load();
  assert.equal(status, 'new');
  assert.equal(state.schemaVersion, SCHEMA_VERSION);
  assert.equal(state.appVersion, '0.2.0');
  assert.equal(state.createdAt, NOW.toISOString());
  assert.equal(state.updatedAt, NOW.toISOString());
  assert.equal(state.settings.assistantQuestionLimit, 50);
  assert.equal(state.settings.lastBackupAt, null);
  assert.ok('theme' in state.settings && 'language' in state.settings);
  const tripIds = Object.keys(state.trips);
  assert.equal(tripIds.length, 1);
  assert.equal(state.activeTripId, tripIds[0]);
  const trip = state.trips[state.activeTripId];
  assert.equal(trip.id, state.activeTripId);
  assert.equal(trip.countryCode, 'TH');
  assert.equal(trip.name, 'טיול');
  assert.equal(trip.startDate, null);
  assert.equal(trip.endDate, null);
  for (const field of ['destinations', 'expenses', 'budget', 'rates', 'transfers', 'checklist', 'events', 'info', 'assistant']) {
    assert.ok(TRIP_FEATURE_FIELDS.includes(field), field);
    assert.ok(field in trip, `trip missing ${field}`);
    const v = trip[field];
    if (field === 'budget') { assert.deepEqual(v, { currency: 'ILS', totalMinor: null, categoriesMinor: {}, profileId: null, estimate: false }, 'Stage 4: budget starts with no amounts'); continue; }
    assert.ok(Array.isArray(v) ? v.length === 0 : Object.keys(v).length === 0, `${field} should start empty`);
  }
  assert.deepEqual(validateState(state), []);
  assert.equal(backend.map.size, 0, 'nothing is written until the first save');
});

test('B2: validateState reports broken structures', () => {
  assert.ok(validateState(null).length > 0);
  assert.ok(validateState({}).length > 0);
  const good = createDefaultState(OPTS);
  assert.ok(validateState({ ...good, activeTripId: 'nope' }).length > 0);
  assert.ok(validateState({ ...good, trips: [] }).length > 0);
  const badDates = structuredClone(good);
  badDates.trips[good.activeTripId].startDate = '2027-02-30';
  assert.ok(validateState(badDates).length > 0);
});

test('B3: v0 data (old tisa:trip + tisa:theme) migrates without losing any field', () => {
  const v0trip = { v: 1, trip: { dates: { start: '2027-03-10', end: '2027-03-19' }, budget: { amount: 12000, currency: 'ILS' }, note: 'keep me' } };
  const backend = memoryStorage({ 'tisa:trip': JSON.stringify(v0trip), 'tisa:theme': 'dark' });
  const { state, status } = open(backend).load();
  assert.equal(status, 'migrated');
  assert.deepEqual(validateState(state), []);
  const trip = state.trips[state.activeTripId];
  assert.equal(trip.startDate, '2027-03-10');
  assert.equal(trip.endDate, '2027-03-19');
  assert.deepEqual(trip.budget, { currency: 'ILS', totalMinor: 1200000, categoriesMinor: {}, profileId: null, estimate: false }, 'Stage 4 (schema 2): same amount, in agorot');
  assert.equal(trip.note, 'keep me', 'unknown fields are carried over');
  assert.equal(state.settings.theme, 'dark');
  assert.ok(backend.map.has('tisa:trip') && backend.map.has('tisa:theme'), 'old keys are never deleted');
});

test('B3: migrate() runs the chain from 0 and leaves current data as is', () => {
  const v0 = { schemaVersion: 0, trip: { dates: { start: '2027-01-01', end: '2027-01-02' } }, theme: 'light' };
  const out = migrate(v0, OPTS);
  assert.equal(out.schemaVersion, SCHEMA_VERSION);
  assert.equal(out.trips[out.activeTripId].endDate, '2027-01-02');
  const current = createDefaultState(OPTS);
  assert.deepEqual(migrate(structuredClone(current), OPTS), current);
});

test('B4: data from a newer schema is never overwritten', () => {
  const future = JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, trips: {}, from: 'the future' });
  const backend = memoryStorage({ 'tisa:v1': future });
  const store = open(backend);
  const { status, state } = store.load();
  assert.equal(status, 'future');
  const result = store.save(state);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'readonly');
  assert.equal(backend.map.get('tisa:v1'), future);
});

test('B5: corrupt JSON is copied aside and not deleted or overwritten without consent', () => {
  const backend = memoryStorage({ 'tisa:v1': '{"schemaVersion": 1, broken' });
  const store = open(backend);
  const { status, state, corruptKey } = store.load();
  assert.equal(status, 'corrupt');
  assert.match(corruptKey, /^tisa:corrupt:\d{4}-\d{2}-\d{2}/);
  assert.equal(backend.map.get(corruptKey), '{"schemaVersion": 1, broken');
  assert.equal(backend.map.get('tisa:v1'), '{"schemaVersion": 1, broken');
  assert.equal(store.save(state).ok, false, 'autosave is blocked while the problem is unresolved');
  assert.equal(backend.map.get('tisa:v1'), '{"schemaVersion": 1, broken');
  store.reset(); // explicit "start over" after confirmation
  assert.equal(JSON.parse(backend.map.get('tisa:v1')).schemaVersion, SCHEMA_VERSION);
  assert.equal(backend.map.get(corruptKey), '{"schemaVersion": 1, broken', 'the copy stays');
});

test('B5: valid JSON with a broken structure is treated as corrupt too', () => {
  const backend = memoryStorage({ 'tisa:v1': JSON.stringify({ schemaVersion: 1, trips: 'oops' }) });
  assert.equal(open(backend).load().status, 'corrupt');
});

test('B15: blocked or full storage keeps the app working in memory', () => {
  const blocked = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); }, removeItem() {}, key() { return null; }, length: 0 };
  const store = open(blocked);
  const { status, state } = store.load();
  assert.equal(status, 'unavailable');
  assert.deepEqual(validateState(state), []);
  assert.deepEqual(store.save(state), { ok: false, reason: 'unavailable' });
  assert.equal(open(null).load().status, 'unavailable');

  const full = memoryStorage();
  full.setItem = () => { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; };
  const s2 = open(full);
  const loaded = s2.load();
  assert.deepEqual(s2.save(loaded.state), { ok: false, reason: 'quota' });
});

test('save writes one key and updates updatedAt; reload gives the same data', () => {
  const backend = memoryStorage();
  let now = NOW;
  const store = createStorage({ backend, key: 'tisa:v1', legacy: {}, ...OPTS, now: () => now });
  const { state } = store.load();
  state.trips[state.activeTripId].startDate = '2026-12-05';
  now = new Date('2026-11-20T08:00:00Z');
  assert.deepEqual(store.save(state), { ok: true });
  const again = createStorage({ backend, key: 'tisa:v1', legacy: {}, ...OPTS }).load();
  assert.equal(again.status, 'ok');
  assert.equal(again.state.updatedAt, '2026-11-20T08:00:00.000Z');
  assert.equal(again.state.trips[again.state.activeTripId].startDate, '2026-12-05');
  assert.deepEqual([...backend.map.keys()], ['tisa:v1']);
});

test('B6: export then import gives identical data', () => {
  const state = createDefaultState(OPTS);
  state.trips[state.activeTripId].startDate = '2026-12-05';
  state.trips[state.activeTripId].endDate = '2027-01-03';
  state.settings.theme = 'dark';
  const file = exportBackup(state, NOW);
  assert.equal(file.format, BACKUP_FORMAT);
  assert.equal(BACKUP_FORMAT, 'tisa-backup');
  assert.equal(file.schemaVersion, SCHEMA_VERSION);
  assert.equal(file.exportedAt, NOW.toISOString());
  const parsed = parseBackup(JSON.stringify(file, null, 2), OPTS);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.state, state);
  assert.equal(parsed.summary.trips, 1);
  assert.equal(parsed.summary.startDate, '2026-12-05');
  assert.equal(backupFileName(NOW), 'tisa-backup-2026-11-19.json');
});

test('B7: broken, empty, foreign or incomplete files are rejected with a reason', () => {
  const good = exportBackup(createDefaultState(OPTS), NOW);
  const cases = {
    '': 'empty',
    '   ': 'empty',
    'not json at all': 'notJson',
    '[]': 'format',
    '{"format":"other-app","schemaVersion":1,"data":{}}': 'format',
    [JSON.stringify({ ...good, data: { schemaVersion: 1 } })]: 'structure',
    [JSON.stringify({ format: 'tisa-backup', exportedAt: good.exportedAt, data: good.data })]: 'structure',
    [JSON.stringify({ ...good, schemaVersion: SCHEMA_VERSION + 1, data: { ...good.data, schemaVersion: SCHEMA_VERSION + 1 } })]: 'future',
  };
  for (const [text, reason] of Object.entries(cases)) {
    const r = parseBackup(text, OPTS);
    assert.equal(r.ok, false, `accepted: ${text.slice(0, 40)}`);
    assert.equal(r.error, reason, `wrong reason for: ${text.slice(0, 40)}`);
  }
});

test('B7: an older backup is migrated on import', () => {
  const v0 = { format: 'tisa-backup', schemaVersion: 0, exportedAt: NOW.toISOString(), data: { schemaVersion: 0, trip: { dates: { start: '2027-01-01', end: '2027-01-05' } } } };
  const r = parseBackup(JSON.stringify(v0), OPTS);
  assert.equal(r.ok, true);
  assert.equal(r.state.trips[r.state.activeTripId].endDate, '2027-01-05');
});

test('makeId uses crypto.randomUUID and falls back when it is missing', () => {
  assert.equal(makeId({ randomUUID: () => 'uuid-1' }), 'uuid-1');
  const a = makeId(undefined);
  const b = makeId({});
  assert.match(a, /^[0-9a-z-]{16,}$/);
  assert.notEqual(a, b);
});

test('B10: autosave waits for a pause and saves once', () => {
  const timers = [];
  const saved = [];
  const auto = createAutosave((s) => saved.push(s), {
    delay: 400,
    setTimer: (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length - 1; },
    clearTimer: (i) => { if (timers[i]) timers[i].live = false; },
  });
  auto.schedule('a'); auto.schedule('b'); auto.schedule('c');
  assert.equal(saved.length, 0);
  const live = timers.filter((t) => t.live);
  assert.equal(live.length, 1);
  assert.equal(live[0].ms, 400);
  live[0].fn();
  assert.deepEqual(saved, ['c']);
  auto.schedule('d');
  auto.flush();
  assert.deepEqual(saved, ['c', 'd']);
});

test('backup reminder shows after 7 days without a backup', () => {
  const s = createDefaultState(OPTS);
  assert.equal(needsBackupReminder(s, new Date('2026-11-25T12:00:00Z')), false, 'new app, under 7 days');
  assert.equal(needsBackupReminder(s, new Date('2026-11-26T12:00:00Z')), true);
  s.settings.lastBackupAt = '2026-11-25T12:00:00Z';
  assert.equal(needsBackupReminder(s, new Date('2026-12-01T12:00:00Z')), false);
  assert.equal(needsBackupReminder(s, new Date('2026-12-02T12:00:01Z')), true);
});
