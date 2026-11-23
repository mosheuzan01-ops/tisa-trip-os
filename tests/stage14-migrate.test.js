// Stage 14 fix (1.1.1): moving the trip on this phone into the account. The backup download and the upload are two
// separate steps (on an iPhone the download opens the share sheet, and an upload started under it never reached the
// server). The trip is linked to the account only after the server created it AND took its records; until then it
// stays "on this device only", and the phone's data is never changed. Fake backend, sample data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptySyncState, runSync, uploadTrip, pendingCount, markBackup, migrateTrip, singleFlight } from '../src/js/core/sync-engine.js';
import { createCloudApi, CloudError } from '../src/js/core/cloud-api.js';
import { createDefaultState } from '../src/js/core/schema.js';
import { recKey } from '../src/js/core/sync-map.js';
import { createFakeCloud, fakeClient } from './fakes/fake-cloud.js';

const clone = (v) => JSON.parse(JSON.stringify(v));
let n = 0;
const makeId = () => { n += 1; return `mg-${String(n).padStart(4, '0')}`; };
const T = (min) => new Date(Date.parse('2026-11-23T12:00:00Z') + min * 60_000).toISOString();

function sampleState() {
  const state = createDefaultState({ now: () => new Date('2026-11-20T08:00:00Z'), appVersion: '1.1.1', makeId, countryCode: 'TH', tripName: 'Sample trip' });
  const trip = state.trips[state.activeTripId];
  Object.assign(trip, {
    startDate: '2026-12-20', endDate: '2027-01-10',
    destinations: [{ id: 'stop-1', name: 'Sample city', startDate: '2026-12-20', endDate: '2026-12-24', note: '' }],
    expenses: [{ id: 'exp-1', amountMinor: 1000, currency: 'ILS', rate: 1, baseMinor: 1000, category: 'food', date: '2026-12-21', destinationId: 'stop-1', description: 'Sample', note: '', method: 'cash', status: 'paid' }],
    checklist: [{ id: 'item-1', group: 'documents', name: 'Sample item', qty: 1, note: '', done: false }],
    places: [{ id: 'place-1', name: 'Sample place', category: 'temple', status: 'want', lat: null, lng: null, address: '', note: '', stopId: 'stop-1', plannedDate: null, visitedDate: null, photoIds: [], createdAt: T(0), updatedAt: T(0) }],
  });
  return state;
}

async function approvedApi(fake, email) {
  fake.addUser({ email, status: 'approved' });
  const client = fakeClient(fake);
  const r = await client.auth.signInWithPassword({ email, password: 'Sample-Passw0rd!' });
  assert.equal(r.error, null);
  return createCloudApi(client);
}

/** The state the app has once signed in and approved: the profile is known (sync.userId), no trip linked yet. */
async function signedIn(api, state) {
  const res = await runSync({ api, sync: emptySyncState(), state, nowIso: T(0) });
  assert.equal(res.status, 'approved');
  return res.sync;
}

const linked = (sync, id) => Boolean(sync.trips?.[id]?.linked);

test('MG1: success = the trip is created first, then its records go up; only then it is linked, and nothing on the phone changes', async () => {
  const fake = createFakeCloud();
  const api = await approvedApi(fake, 'mg1@example.com');
  const state = sampleState(); const id = state.activeTripId; const before = clone(state);
  let sync = markBackup(await signedIn(api, state), id, T(1));
  assert.equal(sync.migration.step, 'ready');
  fake.calls.length = 0;
  const res = await migrateTrip({ api, sync, trip: state.trips[id], nowIso: T(2) });
  assert.equal(res.result, 'done');
  const fns = fake.calls.map((c) => c.fn);
  assert.equal(fns[0], 'create_trip', 'the trip is created before anything else');
  assert.ok(fns.indexOf('push_records') > fns.indexOf('create_trip'), 'records only after the trip exists');
  assert.equal(fake.trips.size, 1);
  assert.ok(fake.records.size >= 5, `records stored: ${fake.records.size}`);
  sync = res.sync;
  assert.ok(linked(sync, id));
  assert.equal(sync.trips[id].role, 'owner');
  assert.equal(sync.migration.step, 'done');
  assert.equal(res.trip, null, 'the phone copy is not replaced');
  assert.deepEqual(state, before);
  assert.equal(pendingCount(sync, state), 0, 'nothing left waiting');
  const count = fake.records.size;
  const again = await runSync({ api, sync, state, nowIso: T(3) });
  assert.equal(fake.records.size, count, 'the next sync adds no duplicates');
  assert.deepEqual(Object.keys(again.trips), [], 'and changes nothing on the phone');
});

test('MG2: no network when creating: a visible failure (stage create, offline), not linked, nothing sent; a retry then works', async () => {
  const fake = createFakeCloud();
  const api = await approvedApi(fake, 'mg2@example.com');
  const state = sampleState(); const id = state.activeTripId; const before = clone(state);
  const sync = markBackup(await signedIn(api, state), id, T(1));
  fake.fail = 'network';
  const res = await migrateTrip({ api, sync, trip: state.trips[id], nowIso: T(2) });
  assert.equal(res.result, 'failed');
  assert.equal(res.sync.migration.step, 'failed');
  assert.equal(res.sync.migration.stage, 'create');
  assert.equal(res.sync.migration.kind, 'offline');
  assert.equal(res.sync.migration.backupAt, T(1), 'the backup time is kept for the retry');
  assert.ok(!linked(res.sync, id), 'still on this device only');
  assert.equal(fake.trips.size, 0); assert.equal(fake.records.size, 0);
  assert.deepEqual(state, before);
  fake.fail = null;
  const retry = await migrateTrip({ api, sync: res.sync, trip: state.trips[id], nowIso: T(3) });
  assert.equal(retry.result, 'done');
  assert.ok(linked(retry.sync, id));
  assert.equal(fake.trips.size, 1);
});

test('MG3: the trip already exists in my account (an earlier attempt): no second trip, the records go up, it is linked', async () => {
  const fake = createFakeCloud();
  const api = await approvedApi(fake, 'mg3@example.com');
  const state = sampleState(); const id = state.activeTripId;
  const sync = await signedIn(api, state);
  await uploadTrip({ api, sync, trip: state.trips[id], nowIso: T(1) }); // an earlier attempt created the trip only
  assert.equal(fake.trips.size, 1); assert.equal(fake.records.size, 0);
  const res = await migrateTrip({ api, sync, trip: state.trips[id], nowIso: T(2) });
  assert.equal(res.result, 'done');
  assert.equal(fake.trips.size, 1, 'still one trip');
  assert.ok(fake.records.size >= 5);
  assert.ok(linked(res.sync, id));
  const head = fake.trips.get(id);
  assert.deepEqual([head.name, head.start_date, head.end_date], ['Sample trip', '2026-12-20', '2027-01-10'], 'the phone\'s header is in the cloud');
  assert.equal(res.trip, null, 'and the phone\'s header is not replaced');
});

test('MG4: the id belongs to someone else (taken): nothing is linked or sent, and the failure says so', async () => {
  const fake = createFakeCloud();
  const other = await approvedApi(fake, 'mg4-other@example.com');
  const api = await approvedApi(fake, 'mg4@example.com');
  const state = sampleState(); const id = state.activeTripId; const before = clone(state);
  await other.createTrip(id, { name: 'Other' });
  const sync = await signedIn(api, state);
  fake.calls.length = 0;
  const res = await migrateTrip({ api, sync, trip: state.trips[id], nowIso: T(2) });
  assert.equal(res.result, 'taken');
  assert.equal(res.sync.migration.step, 'failed');
  assert.equal(res.sync.migration.kind, 'taken');
  assert.ok(!linked(res.sync, id));
  assert.ok(!fake.calls.some((c) => c.fn === 'push_records'), 'no record is sent');
  assert.equal(fake.records.size, 0);
  assert.deepEqual(state, before);
});

test('MG5: sending the records fails: no success, not linked, the phone keeps everything; a retry finishes with no duplicate', async () => {
  const fake = createFakeCloud();
  const api = await approvedApi(fake, 'mg5@example.com');
  const state = sampleState(); const id = state.activeTripId; const before = clone(state);
  const sync = markBackup(await signedIn(api, state), id, T(1));
  const broken = { ...api, push: async () => { throw new CloudError('offline', 'Failed to fetch', 0); } };
  const res = await migrateTrip({ api: broken, sync, trip: state.trips[id], nowIso: T(2) });
  assert.equal(res.result, 'failed', 'no success before the records are in');
  assert.equal(res.sync.migration.stage, 'records');
  assert.equal(res.sync.migration.kind, 'offline');
  assert.ok(!linked(res.sync, id), 'still on this device only');
  assert.equal(fake.trips.size, 1, 'the trip itself was created');
  assert.deepEqual(state, before);
  const retry = await migrateTrip({ api, sync: res.sync, trip: state.trips[id], nowIso: T(3) });
  assert.equal(retry.result, 'done');
  assert.equal(fake.trips.size, 1);
  assert.ok(linked(retry.sync, id));
  assert.equal(pendingCount(retry.sync, state), 0);
});

test('MG6: records half sent, then edited on the phone, then a retry: the phone\'s newer version wins in the cloud and on the phone', async () => {
  const fake = createFakeCloud();
  const api = await approvedApi(fake, 'mg6@example.com');
  const state = sampleState(); const id = state.activeTripId;
  const sync = await signedIn(api, state);
  const cutOff = { ...api, push: async (rows) => { await api.push(rows); throw new CloudError('offline', 'Failed to fetch', 0); } };
  const first = await migrateTrip({ api: cutOff, sync, trip: state.trips[id], nowIso: T(2) });
  assert.equal(first.result, 'failed');
  state.trips[id].checklist[0].name = 'Sample item, edited later';
  const after = clone(state);
  const retry = await migrateTrip({ api, sync: first.sync, trip: state.trips[id], nowIso: T(5) });
  assert.equal(retry.result, 'done');
  assert.equal(retry.trip, null, 'the phone copy is not replaced by the older cloud copy');
  assert.deepEqual(state, after);
  const row = [...fake.records.values()].find((r) => r.kind === 'item' && r.rec_id === 'item-1');
  assert.equal(row.data.v.name, 'Sample item, edited later');
  assert.ok(recKey('personal', 'item', 'item-1') in retry.sync.trips[id].shadow);
});

test('MG7: a double tap runs one move: one create_trip call, one trip', async () => {
  const fake = createFakeCloud();
  const api = await approvedApi(fake, 'mg7@example.com');
  const state = sampleState(); const id = state.activeTripId;
  const sync = await signedIn(api, state);
  fake.calls.length = 0;
  const once = singleFlight(() => migrateTrip({ api, sync, trip: state.trips[id], nowIso: T(2) }));
  const [a, b] = await Promise.all([once(), once()]);
  assert.equal(a, b, 'the second tap gets the same run');
  assert.equal(fake.calls.filter((c) => c.fn === 'create_trip').length, 1);
  assert.equal(fake.trips.size, 1);
  const later = await once();
  assert.notEqual(later, a, 'after it finished, a new tap may run again');
});

test('MG8: a pending (not approved) user: denied, nothing linked, the failure is kept for the screen', async () => {
  const fake = createFakeCloud();
  fake.addUser({ email: 'mg8@example.com', status: 'pending' });
  const client = fakeClient(fake);
  await client.auth.signInWithPassword({ email: 'mg8@example.com', password: 'Sample-Passw0rd!' });
  const api = createCloudApi(client);
  const state = sampleState(); const id = state.activeTripId;
  const sync = { ...emptySyncState(), userId: [...fake.users.values()][0].id };
  const res = await migrateTrip({ api, sync, trip: state.trips[id], nowIso: T(2) });
  assert.equal(res.result, 'failed');
  assert.equal(res.sync.migration.kind, 'denied');
  assert.ok(!linked(res.sync, id));
});
