// Stage 6.0a: data model v4 (docs/GOALS_STAGE6.md S6-1 data part, S6-2, S6-12). Written before the schema change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA_VERSION, migrate, validateState, createDefaultState, TRIP_FEATURE_FIELDS } from '../src/js/core/schema.js';
import { createStorage } from '../src/js/core/storage.js';
import { exportBackup, parseBackup } from '../src/js/core/backup.js';

const opts = { now: () => new Date('2026-11-19T10:00:00Z'), appVersion: '0.5.4', makeId: () => 'trip-1', countryCode: 'TH', tripName: 'תאילנד' };

/** Real v3 data, as 0.5.4 saves it: itinerary, money, transfers with a linked expense, checklist and tasks. */
function v3State() {
  const s = createDefaultState(opts);
  s.schemaVersion = 3;
  const trip = s.trips['trip-1'];
  delete trip.journal; delete trip.checkins; delete trip.luggage;
  trip.startDate = '2026-12-05'; trip.endDate = '2027-01-03';
  trip.destinations = [
    { id: 'd1', name: 'בנגקוק', startDate: '2026-12-05', endDate: '2026-12-08', note: '' },
    { id: 'd2', name: "צ'יאנג מאי", startDate: '2026-12-08', endDate: '2026-12-12', note: 'שוק לילה' },
  ];
  trip.budget = { currency: 'ILS', totalMinor: 1527000, categoriesMinor: { food: 210000, emergency: 250000 }, profileId: 'realistic', estimate: true };
  trip.rates = { ILS_THB: 11 };
  trip.expenses = [
    { id: 'e1', amountMinor: 30000, currency: 'THB', rate: 0.1, baseMinor: 3000, category: 'food', date: '2026-12-06', destinationId: 'd1', description: 'פאד תאי', method: 'cash', status: 'paid', note: '', paidBy: 'p1', split: { mode: 'percent', shares: { p1: 7000, p2: 3000 } } },
    { id: 'e2', amountMinor: 250000, currency: 'ILS', rate: 1, baseMinor: 250000, category: 'flight', date: '2026-12-05', destinationId: null, description: 'טיסה', method: 'card', status: 'committed', note: '' },
  ];
  trip.people = [{ id: 'p1', name: 'משה' }, { id: 'p2', name: 'דנה' }];
  trip.repayments = [{ id: 'r1', from: 'p2', to: 'p1', minor: 900, date: '2026-12-07' }];
  trip.transfers = [{ id: 't1', kind: 'flight', from: 'תל אביב', to: 'בנגקוק', date: '2026-12-05', time: '', company: '', booking: 'ABC123', priceMinor: 250000, currency: 'ILS', link: '', status: 'booked', note: '', expenseId: 'e2' }];
  trip.checklist = [{ id: 'c1', group: 'documents', name: 'דרכון', qty: 1, note: '', done: true, verify: { source: '', checkedAt: '' } }];
  trip.tasks = [{ id: 'k1', title: 'ביטוח', status: 'open', due: '2026-11-30', note: '' }];
  return s;
}

const OLD_FIELDS = ['name', 'countryCode', 'startDate', 'endDate', 'destinations', 'budget', 'rates', 'expenses', 'people', 'repayments', 'transfers', 'checklist', 'tasks', 'events', 'info', 'assistant'];

test('S6-2: schema is v4, and a fresh trip starts with an empty journal, no check-ins and no bags', () => {
  assert.equal(SCHEMA_VERSION, 4);
  const fresh = createDefaultState(opts);
  assert.equal(fresh.schemaVersion, 4);
  const trip = fresh.trips['trip-1'];
  assert.deepEqual(trip.journal, {});
  assert.deepEqual(trip.checkins, []);
  assert.deepEqual(trip.luggage, { bags: [] });
  for (const f of ['journal', 'checkins', 'luggage']) assert.ok(TRIP_FEATURE_FIELDS.includes(f), f);
  assert.deepEqual(validateState(fresh), []);
});

test('S6-2: real v3 data migrates to v4: nothing lost or changed, the three new fields are added', () => {
  const before = v3State();
  const out = migrate(structuredClone(before), opts);
  assert.equal(out.schemaVersion, 4);
  const a = before.trips['trip-1'];
  const b = out.trips['trip-1'];
  for (const k of OLD_FIELDS) assert.deepEqual(b[k], a[k], k);
  assert.deepEqual(out.settings, before.settings);
  assert.deepEqual(b.journal, {});
  assert.deepEqual(b.checkins, []);
  assert.deepEqual(b.luggage, { bags: [] });
  assert.deepEqual(validateState(out), []);
});

test('S6-2: migration keeps fields that already exist and unknown fields', () => {
  const s = v3State();
  const trip = s.trips['trip-1'];
  trip.journal = { '2026-12-06': { note: 'יום טוב', updatedAt: '2026-12-06T15:00:00Z' } };
  trip.someFutureField = { keep: true };
  const migrated = migrate(s, opts);
  assert.equal(migrated.schemaVersion, 4);
  const out = migrated.trips['trip-1'];
  assert.deepEqual(out.luggage, { bags: [] }, 'missing fields are still added');
  assert.deepEqual(out.journal, { '2026-12-06': { note: 'יום טוב', updatedAt: '2026-12-06T15:00:00Z' } });
  assert.deepEqual(out.someFutureField, { keep: true });
});

test('S6-2: data from every older version reaches v4 (v0 Stage 1, v2)', () => {
  const v0 = migrate({ schemaVersion: 0, trip: { dates: { start: '2026-12-05', end: '2027-01-03' }, budget: { amount: 15270, currency: 'ILS' } }, theme: 'dark' }, opts);
  assert.equal(v0.schemaVersion, 4);
  assert.deepEqual(validateState(v0), []);
  assert.deepEqual(v0.trips[v0.activeTripId].luggage, { bags: [] });
  const v2 = v3State();
  v2.schemaVersion = 2;
  delete v2.trips['trip-1'].tasks;
  const out = migrate(v2, opts);
  assert.equal(out.schemaVersion, 4);
  assert.deepEqual(validateState(out), []);
});

test('S6-2: validateState rejects a v4 trip whose new fields have the wrong shape', () => {
  for (const [field, bad] of [['journal', []], ['checkins', {}], ['luggage', []], ['luggage', {}], ['luggage', { bags: {} }]]) {
    const s = createDefaultState(opts);
    s.trips['trip-1'][field] = bad;
    assert.ok(validateState(s).length > 0, `${field} = ${JSON.stringify(bad)} should be rejected`);
  }
});

function memoryBackend() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k), map };
}
const storageOn = (backend) => createStorage({ backend, key: 'tisa:v1', legacy: { trip: 'tisa:trip', theme: 'tisa:theme' }, corruptPrefix: 'tisa:corrupt:', ...opts });

test('S6-1: a note, a check-in and a bag are saved through storage.js under tisa: and survive a reload; v3 data in storage upgrades', () => {
  const backend = memoryBackend();
  backend.setItem('tisa:v1', JSON.stringify(v3State()));
  const s = storageOn(backend);
  const { state, status } = s.load();
  assert.equal(status, 'migrated');
  const trip = state.trips[state.activeTripId];
  trip.journal['2026-12-06'] = { note: 'שוק צף', updatedAt: '2026-12-06T15:00:00Z' };
  trip.checkins.push({ id: 'ci1', kind: 'flight', title: 'טיסה לבנגקוק', transferId: 't1', stopId: null, date: '2026-12-04', time: '', zone: 'Asia/Jerusalem', booking: 'ABC123', link: '', note: '', done: false });
  trip.luggage.bags.push({ id: 'b1', name: 'מזוודה גדולה', limitGrams: null, items: [{ id: 'i1', name: 'נעליים', grams: 850 }] });
  assert.equal(s.save(state).ok, true);
  assert.ok([...backend.map.keys()].every((k) => k.startsWith('tisa:')));
  const again = storageOn(backend).load();
  assert.equal(again.status, 'ok');
  const t = again.state.trips['trip-1'];
  assert.equal(t.journal['2026-12-06'].note, 'שוק צף');
  assert.equal(t.checkins[0].transferId, 't1');
  assert.equal(t.luggage.bags[0].items[0].grams, 850);
  assert.equal(t.expenses[0].split.shares.p1, 7000, 'stage 4 data intact');
  assert.equal(t.transfers[0].expenseId, 'e2', '0.5.3 data intact');
});

test('S6-12: backup round trip keeps journal, check-ins and luggage with all earlier data; a v3 backup still imports', () => {
  const { state } = storageOn(memoryBackend()).load();
  const src = migrate(v3State(), opts).trips['trip-1'];
  const trip = state.trips[state.activeTripId];
  Object.assign(trip, structuredClone(src));
  trip.id = state.activeTripId;
  trip.journal = { '2026-12-05': { note: 'נחתנו', updatedAt: '2026-12-05T20:00:00Z' } };
  trip.checkins = [{ id: 'ci1', kind: 'hotel', title: 'מלון בבנגקוק', transferId: null, stopId: 'd1', date: '2026-12-05', time: '14:00', zone: 'Asia/Bangkok', booking: '', link: 'https://example.com', note: '', done: true }];
  trip.luggage = { bags: [{ id: 'b1', name: 'תיק גב', limitGrams: 7000, items: [{ id: 'i1', name: 'מחשב', grams: 1350 }] }] };
  const back = parseBackup(JSON.stringify(exportBackup(state, new Date())), opts);
  assert.equal(back.ok, true);
  const t2 = back.state.trips[back.state.activeTripId];
  for (const k of [...OLD_FIELDS, 'journal', 'checkins', 'luggage']) assert.deepEqual(t2[k], trip[k], k);
  const old = parseBackup(JSON.stringify({ format: 'tisa-backup', schemaVersion: 3, exportedAt: '2026-11-19T00:00:00Z', data: v3State() }), opts);
  assert.equal(old.ok, true);
  const t3 = old.state.trips['trip-1'];
  assert.deepEqual(t3.luggage, { bags: [] });
  assert.equal(t3.transfers[0].booking, 'ABC123');
});
