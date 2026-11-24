// Stage 14 fix (1.1.1): moving the trip on this phone into the account. The backup download and the upload are two
// separate steps (on an iPhone the download opens the share sheet, and an upload started under it never reached the
// server). The trip is linked to the account only after the server created it AND took its records; until then it
// stays "on this device only", and the phone's data is never changed. Fake backend, sample data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptySyncState, runSync, uploadTrip, pendingCount, markBackup, markMoveFailed, migrateTrip, singleFlight, moveProgress, deleteTripFromAccount } from '../src/js/core/sync-engine.js';
import { createCloudApi, CloudError } from '../src/js/core/cloud-api.js';
import { createDefaultState } from '../src/js/core/schema.js';
import { recKey, tripToRecords } from '../src/js/core/sync-map.js';
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

// ---------- M1 (final review of 1.1.1): records reached the server, the answer was lost, then a local delete ----------
const cloudRow = (fake, kind, recId) => [...fake.records.values()].find((r) => r.kind === kind && r.rec_id === recId);
/** The server takes the rows, but the answer never reaches the phone. */
const answerLost = (api) => ({ ...api, push: async (rows) => { await api.push(rows); throw new CloudError('offline', 'Failed to fetch', 0); } });

test('MG9 (M1): records reached the server but the answer was lost, the user deletes one, the retry: it does not come back, on the phone or in the cloud', async () => {
  const fake = createFakeCloud();
  const api = await approvedApi(fake, 'mg9@example.com');
  const state = sampleState(); const id = state.activeTripId;
  const sync = markBackup(await signedIn(api, state), id, T(1));
  const first = await migrateTrip({ api: answerLost(api), sync, trip: state.trips[id], nowIso: T(2) });
  assert.equal(first.result, 'failed');
  assert.equal(first.sync.migration.stage, 'records');
  assert.ok(!linked(first.sync, id));
  assert.equal(cloudRow(fake, 'item', 'item-1')?.deleted, false, 'the record really reached the server');
  state.trips[id].checklist = []; // the user deletes it on the phone
  const after = clone(state);
  const retry = await migrateTrip({ api, sync: first.sync, trip: state.trips[id], nowIso: T(5) });
  assert.equal(retry.result, 'done');
  assert.ok(linked(retry.sync, id));
  assert.equal(retry.trip, null, 'the phone copy is not replaced (the deleted record is not brought back)');
  assert.deepEqual(state, after);
  assert.equal(cloudRow(fake, 'item', 'item-1').deleted, true, 'the delete was sent to the cloud');
  assert.equal(cloudRow(fake, 'place', 'place-1').deleted, false, 'the other records stay');
  assert.equal(pendingCount(retry.sync, state), 0, 'nothing left waiting');
  assert.ok(retry.sync.conflicts.some((c) => c.key === recKey('personal', 'item', 'item-1') && c.remote?.v?.name === 'Sample item'), 'the cloud version is kept as a copy');
  assert.equal(moveProgress(retry.sync, id).sentKeys, undefined, 'the list of earlier sent records is dropped once moved');
  // later syncs, on this phone and on another phone of the same account, do not bring it back
  const next = await runSync({ api, sync: retry.sync, state, nowIso: T(6) });
  assert.deepEqual(Object.keys(next.trips), []);
  const client2 = fakeClient(fake);
  await client2.auth.signInWithPassword({ email: 'mg9@example.com', password: 'Sample-Passw0rd!' });
  const api2 = createCloudApi(client2);
  const pulled = (await api2.pull(id, null)).filter((r) => r.kind === 'item' && r.rec_id === 'item-1');
  assert.deepEqual(pulled.map((r) => r.deleted), [true]);
});

test('MG10 (M1): the delete survives a second failed try (offline when creating) and a new backup before the retry', async () => {
  const fake = createFakeCloud();
  const api = await approvedApi(fake, 'mg10@example.com');
  const state = sampleState(); const id = state.activeTripId;
  let sync = markBackup(await signedIn(api, state), id, T(1));
  sync = (await migrateTrip({ api: answerLost(api), sync, trip: state.trips[id], nowIso: T(2) })).sync;
  state.trips[id].checklist = [];
  fake.fail = 'network';
  const second = await migrateTrip({ api, sync, trip: state.trips[id], nowIso: T(3) });
  assert.equal(second.result, 'failed');
  assert.equal(second.sync.migration.stage, 'create');
  fake.fail = null;
  sync = markBackup(second.sync, id, T(4)); // "back up again" before the retry
  const retry = await migrateTrip({ api, sync, trip: state.trips[id], nowIso: T(5) });
  assert.equal(retry.result, 'done');
  assert.equal(retry.trip, null);
  assert.equal(state.trips[id].checklist.length, 0);
  assert.equal(cloudRow(fake, 'item', 'item-1').deleted, true);
});

test('MG11 (M1): the delete is limited to what this phone sent: a record it never had is still taken from the cloud, and an untouched one stays', async () => {
  const fake = createFakeCloud();
  const api = await approvedApi(fake, 'mg11@example.com');
  const state = sampleState(); const id = state.activeTripId;
  const sync = markBackup(await signedIn(api, state), id, T(1));
  const first = await migrateTrip({ api: answerLost(api), sync, trip: state.trips[id], nowIso: T(2) });
  const me = first.sync.userId;
  await api.push([{ trip_id: id, scope: me, kind: 'item', rec_id: 'item-other', data: { v: { id: 'item-other', group: 'documents', name: 'Sample from elsewhere', qty: 1, note: '', done: false } }, deleted: false, edited_at: T(3) }]);
  const retry = await migrateTrip({ api, sync: first.sync, trip: state.trips[id], nowIso: T(5) });
  assert.equal(retry.result, 'done');
  assert.ok(retry.trip, 'the record the phone never had comes in');
  assert.deepEqual(retry.trip.checklist.map((x) => x.id).sort(), ['item-1', 'item-other']);
  assert.equal(cloudRow(fake, 'item', 'item-other').deleted, false);
  assert.equal(cloudRow(fake, 'item', 'item-1').deleted, false, 'a record still on the phone is not deleted');
});

test('MG12 (M1): after the move, normal sync of edits and deletes still works', async () => {
  const fake = createFakeCloud();
  const api = await approvedApi(fake, 'mg12@example.com');
  const state = sampleState(); const id = state.activeTripId;
  let sync = markBackup(await signedIn(api, state), id, T(1));
  sync = (await migrateTrip({ api: answerLost(api), sync, trip: state.trips[id], nowIso: T(2) })).sync;
  state.trips[id].checklist = [];
  sync = (await migrateTrip({ api, sync, trip: state.trips[id], nowIso: T(5) })).sync;
  state.trips[id].places[0].name = 'Sample place, edited';
  state.trips[id].expenses = [];
  const res = await runSync({ api, sync, state, nowIso: T(7) });
  assert.deepEqual(Object.keys(res.trips), []);
  assert.equal(cloudRow(fake, 'place', 'place-1').data.v.name, 'Sample place, edited');
  assert.equal(cloudRow(fake, 'expense', 'exp-1')?.deleted ?? true, true);
  assert.equal(cloudRow(fake, 'item', 'item-1').deleted, true);
  assert.equal(pendingCount(res.sync, state), 0);
});

// ---------- M2 (1.1.3): moving a copy of a trip that is already in the account (from another phone) ----------
// e.g. a backup restored on a second device, or this phone after "restore to this phone only" or another account.
// The phone's version wins only for what this phone itself sent in an earlier, unfinished try. Anything else already
// in the account keeps the later edit (as every sync does); the phone's own version, with no known edit time, is kept
// as a copy. Before the fix the stale copy overwrote the account and the other phone, and a delete came back.
async function movedFromPhoneA(fake, email) {
  const apiA = await approvedApi(fake, email);
  const phoneA = sampleState(); const id = phoneA.activeTripId;
  const stale = clone(phoneA); // the backup file, taken before the later edits on phone A
  let syncA = markBackup(await signedIn(apiA, phoneA), id, T(1));
  syncA = (await migrateTrip({ api: apiA, sync: syncA, trip: phoneA.trips[id], nowIso: T(2) })).sync;
  phoneA.trips[id].checklist[0].name = 'Sample item, edited on phone A';
  phoneA.trips[id].places = []; // deleted on phone A
  phoneA.trips[id].startDate = '2026-12-21';
  syncA = (await runSync({ api: apiA, sync: syncA, state: phoneA, nowIso: T(10) })).sync;
  const client = fakeClient(fake);
  await client.auth.signInWithPassword({ email, password: 'Sample-Passw0rd!' });
  return { apiA, phoneA, syncA, id, stale, apiB: createCloudApi(client) };
}

test('MG13 (M2): a stale copy of a trip already in the account: the newer edit and the delete stay, in the cloud and on the other phone', async () => {
  const fake = createFakeCloud();
  const { apiA, phoneA, syncA, id, stale, apiB } = await movedFromPhoneA(fake, 'mg13@example.com');
  const phoneAbefore = clone(phoneA);
  stale.trips[id].checklist.push({ id: 'item-b', group: 'documents', name: 'Sample added on phone B', qty: 1, note: '', done: false });
  const syncB = markBackup((await runSync({ api: apiB, sync: emptySyncState(), state: stale, nowIso: T(20) })).sync, id, T(21));
  assert.ok(!linked(syncB, id), 'phone B: the trip is on this device only');
  const res = await migrateTrip({ api: apiB, sync: syncB, trip: stale.trips[id], nowIso: T(22) });
  assert.equal(res.result, 'done');
  assert.equal(fake.trips.size, 1, 'no second trip');
  assert.equal(cloudRow(fake, 'item', 'item-1').data.v.name, 'Sample item, edited on phone A', 'the newer edit stays in the cloud');
  assert.equal(cloudRow(fake, 'place', 'place-1').deleted, true, 'the delete made on phone A does not come back');
  assert.equal(cloudRow(fake, 'item', 'item-b')?.deleted, false, 'a record only phone B has is added');
  assert.ok(res.trip, 'phone B takes the account\'s version');
  assert.equal(res.trip.checklist.find((x) => x.id === 'item-1').name, 'Sample item, edited on phone A');
  assert.deepEqual(res.trip.places, []);
  assert.ok(res.trip.checklist.some((x) => x.id === 'item-b'), 'and keeps what only it had');
  assert.ok(res.sync.conflicts.some((c) => c.key === recKey('personal', 'item', 'item-1') && c.local?.v?.name === 'Sample item'), 'phone B\'s older version is kept as a copy');
  assert.ok(res.sync.conflicts.some((c) => c.key === recKey('shared', 'place', 'place-1') && c.local?.v?.name === 'Sample place'), 'and so is the place it still had');
  const next = await runSync({ api: apiA, sync: syncA, state: phoneA, nowIso: T(30) });
  const tripA = next.trips[id] ?? phoneA.trips[id];
  assert.equal(tripA.checklist.find((x) => x.id === 'item-1').name, 'Sample item, edited on phone A', 'phone A keeps its edit');
  assert.deepEqual(tripA.places, [], 'phone A: the deleted place does not come back');
  assert.ok(tripA.checklist.some((x) => x.id === 'item-b'), 'phone A gets what phone B added');
  assert.deepEqual(phoneA, phoneAbefore, 'phone A\'s own data was not touched by the move');
});

test('MG14 (M2): the same move keeps the account\'s trip header (dates), and phone B\'s older header is kept as a copy', async () => {
  const fake = createFakeCloud();
  const { id, stale, apiB } = await movedFromPhoneA(fake, 'mg14@example.com');
  const syncB = markBackup((await runSync({ api: apiB, sync: emptySyncState(), state: stale, nowIso: T(20) })).sync, id, T(21));
  const res = await migrateTrip({ api: apiB, sync: syncB, trip: stale.trips[id], nowIso: T(22) });
  assert.equal(res.result, 'done');
  assert.equal(fake.trips.get(id).start_date, '2026-12-21', 'the account\'s dates stay');
  assert.equal(res.trip.startDate, '2026-12-21', 'phone B takes them');
  assert.ok(res.sync.conflicts.some((c) => c.key === 'meta' && c.local?.startDate === '2026-12-20'), 'phone B\'s header is kept as a copy');
  assert.equal(pendingCount(res.sync, { trips: { [id]: res.trip } }), 0, 'nothing left waiting');
});

test('MG15 (M2): that move fails half way, then a retry: the stale copy still does not overwrite the account', async () => {
  const fake = createFakeCloud();
  const { id, stale, apiB } = await movedFromPhoneA(fake, 'mg15@example.com');
  stale.trips[id].checklist.push({ id: 'item-b', group: 'documents', name: 'Sample added on phone B', qty: 1, note: '', done: false }); // so the first try really sends
  let syncB = markBackup((await runSync({ api: apiB, sync: emptySyncState(), state: stale, nowIso: T(20) })).sync, id, T(21));
  const first = await migrateTrip({ api: answerLost(apiB), sync: syncB, trip: stale.trips[id], nowIso: T(22) });
  assert.equal(first.result, 'failed');
  assert.equal(moveProgress(first.sync, id).created, undefined, 'phone B did not create this trip');
  assert.equal(moveProgress(first.sync, id).adopted, true, 'it found the trip already in the account');
  syncB = markBackup(first.sync, id, T(23));
  const retry = await migrateTrip({ api: apiB, sync: syncB, trip: stale.trips[id], nowIso: T(24) });
  assert.equal(retry.result, 'done');
  assert.equal(cloudRow(fake, 'item', 'item-1').data.v.name, 'Sample item, edited on phone A');
  assert.equal(cloudRow(fake, 'place', 'place-1').deleted, true);
  assert.equal(fake.trips.get(id).start_date, '2026-12-21');
  assert.equal(cloudRow(fake, 'item', 'item-b')?.deleted, false);
  assert.equal(fake.trips.size, 1);
});

test('MG16 (M2): this phone created the trip, the records failed, a new backup and an edit, then a retry: the phone still wins', async () => {
  const fake = createFakeCloud();
  const api = await approvedApi(fake, 'mg16@example.com');
  const state = sampleState(); const id = state.activeTripId;
  let sync = markBackup(await signedIn(api, state), id, T(1));
  sync = (await migrateTrip({ api: answerLost(api), sync, trip: state.trips[id], nowIso: T(2) })).sync;
  assert.equal(moveProgress(sync, id).created, true, 'kept: this phone created the trip');
  fake.fail = 'network';
  sync = (await migrateTrip({ api, sync, trip: state.trips[id], nowIso: T(3) })).sync;
  fake.fail = null;
  assert.equal(moveProgress(sync, id).created, true, 'kept through a failure when creating');
  sync = markBackup(sync, id, T(4));
  assert.equal(moveProgress(sync, id).created, true, 'and through a new backup');
  state.trips[id].checklist[0].name = 'Sample item, edited later';
  state.trips[id].name = 'Sample trip, renamed';
  const after = clone(state);
  const retry = await migrateTrip({ api, sync, trip: state.trips[id], nowIso: T(5) });
  assert.equal(retry.result, 'done');
  assert.equal(retry.trip, null);
  assert.deepEqual(state, after);
  assert.equal(cloudRow(fake, 'item', 'item-1').data.v.name, 'Sample item, edited later');
  assert.equal(fake.trips.get(id).name, 'Sample trip, renamed');
  assert.equal(moveProgress(retry.sync, id).created, undefined, 'dropped once moved');
});

test('MG17 (M2): the account does not list the trip after "exists": nothing is sent, the phone header is not replaced, not linked', async () => {
  const fake = createFakeCloud();
  const api = await approvedApi(fake, 'mg17@example.com');
  const state = sampleState(); const id = state.activeTripId; const before = clone(state);
  const sync = await signedIn(api, state);
  await uploadTrip({ api, sync, trip: state.trips[id], nowIso: T(1) });
  fake.calls.length = 0;
  const res = await migrateTrip({ api: { ...api, myTrips: async () => [] }, sync, trip: state.trips[id], nowIso: T(2) });
  assert.equal(res.result, 'failed');
  assert.equal(res.sync.migration.stage, 'records');
  assert.ok(!linked(res.sync, id));
  assert.ok(!fake.calls.some((c) => c.fn === 'push_records' || c.fn === 'update_trip'));
  assert.deepEqual(state, before);
});

test('MG18 (M2): a move left unfinished by 1.1.2 (sent records, no flag) is still finished the 1.1.2 way after the update: the phone wins', async () => {
  const fake = createFakeCloud();
  const api = await approvedApi(fake, 'mg18@example.com');
  const state = sampleState(); const id = state.activeTripId;
  let sync = markBackup(await signedIn(api, state), id, T(1));
  sync = (await migrateTrip({ api: answerLost(api), sync, trip: state.trips[id], nowIso: T(2) })).sync;
  // the state 1.1.2 kept: sentKeys inside sync.migration, no per-trip list and no created / adopted flag
  sync = { ...sync, migration: { ...sync.migration, sentKeys: sync.moves[id].sentKeys } };
  delete sync.moves;
  assert.ok(sync.migration.sentKeys.length > 0);
  state.trips[id].checklist[0].name = 'Sample item, edited later';
  state.trips[id].places = [];
  const after = clone(state);
  const retry = await migrateTrip({ api, sync, trip: state.trips[id], nowIso: T(5) });
  assert.equal(retry.result, 'done');
  assert.equal(retry.trip, null);
  assert.deepEqual(state, after);
  assert.equal(cloudRow(fake, 'item', 'item-1').data.v.name, 'Sample item, edited later');
  assert.equal(cloudRow(fake, 'place', 'place-1').deleted, true);
});

// ---------- B (1.1.3): two trips on one phone. The move progress of each trip is kept on its own ----------
// Before the fix one slot (sync.migration) held it: starting to move trip 2 erased what trip 1's unfinished move had
// sent, and a record then deleted from trip 1 came back on its retry (M1 again, with two trips).
function twoTrips() {
  const state = sampleState();
  const one = state.activeTripId;
  const two = 'trip-two-sample';
  state.trips[two] = { ...clone(state.trips[one]), id: two, name: 'Second sample trip', photos: [] };
  state.trips[two].checklist = [{ id: 'item-two', group: 'documents', name: 'Sample item of trip 2', qty: 1, note: '', done: false }];
  return { state, one, two };
}

test('MG19 (B): trip 1 half sent, then a backup of trip 2, then a delete in trip 1 and its retry: the delete stays, in the cloud and on the phone', async () => {
  const fake = createFakeCloud();
  const api = await approvedApi(fake, 'mg19@example.com');
  const { state, one, two } = twoTrips();
  let sync = markBackup(await signedIn(api, state), one, T(1));
  sync = (await migrateTrip({ api: answerLost(api), sync, trip: state.trips[one], nowIso: T(2) })).sync;
  assert.equal(cloudRow(fake, 'item', 'item-1')?.deleted, false, 'trip 1\'s record really reached the server');
  sync = markBackup(sync, two, T(3)); // the user starts moving trip 2
  state.trips[one].checklist = []; // and deletes the record in trip 1
  const after = clone(state);
  sync = markBackup(sync, one, T(4));
  const retry = await migrateTrip({ api, sync, trip: state.trips[one], nowIso: T(5) });
  assert.equal(retry.result, 'done');
  assert.equal(retry.trip, null, 'the deleted record is not brought back to the phone');
  assert.deepEqual(state, after);
  assert.equal(cloudRow(fake, 'item', 'item-1').deleted, true, 'the delete reached the cloud');
  assert.equal(fake.trips.size, 1, 'one trip in the account, no duplicate');
});

test('MG20 (B): the same, when trip 2 is fully moved in between: trip 1\'s delete still stays, and trip 2 is untouched', async () => {
  const fake = createFakeCloud();
  const api = await approvedApi(fake, 'mg20@example.com');
  const { state, one, two } = twoTrips();
  let sync = markBackup(await signedIn(api, state), one, T(1));
  sync = (await migrateTrip({ api: answerLost(api), sync, trip: state.trips[one], nowIso: T(2) })).sync;
  sync = markBackup(sync, two, T(3));
  const moved2 = await migrateTrip({ api, sync, trip: state.trips[two], nowIso: T(4) });
  assert.equal(moved2.result, 'done');
  sync = moved2.sync;
  state.trips[one].checklist = [];
  const records = fake.records.size;
  sync = markBackup(sync, one, T(5));
  const retry = await migrateTrip({ api, sync, trip: state.trips[one], nowIso: T(6) });
  assert.equal(retry.result, 'done');
  assert.equal(retry.trip, null);
  assert.equal(cloudRow(fake, 'item', 'item-1').deleted, true);
  assert.equal(cloudRow(fake, 'item', 'item-two').deleted, false, 'trip 2\'s record stays');
  assert.equal(fake.records.size, records, 'no new record: only the delete of an existing one');
  assert.equal(fake.trips.size, 2);
  assert.ok(linked(retry.sync, one) && linked(retry.sync, two));
});

test('MG21 (B): trip 1 was created by this phone and half sent; trip 2 starts and fails; an edit in trip 1 and its retry: the phone still wins', async () => {
  const fake = createFakeCloud();
  const api = await approvedApi(fake, 'mg21@example.com');
  const { state, one, two } = twoTrips();
  let sync = markBackup(await signedIn(api, state), one, T(1));
  sync = (await migrateTrip({ api: answerLost(api), sync, trip: state.trips[one], nowIso: T(2) })).sync;
  sync = markBackup(sync, two, T(3));
  fake.fail = 'network';
  sync = (await migrateTrip({ api, sync, trip: state.trips[two], nowIso: T(4) })).sync;
  fake.fail = null;
  state.trips[one].checklist[0].name = 'Sample item, edited later';
  const retry = await migrateTrip({ api, sync: markBackup(sync, one, T(5)), trip: state.trips[one], nowIso: T(6) });
  assert.equal(retry.result, 'done');
  assert.equal(retry.trip, null, 'the phone copy is not replaced by its own older half-sent copy');
  assert.equal(cloudRow(fake, 'item', 'item-1').data.v.name, 'Sample item, edited later');
});

test('MG22 (B): a state left by 1.1.2 (progress inside sync.migration) survives a backup of another trip', async () => {
  const fake = createFakeCloud();
  const api = await approvedApi(fake, 'mg22@example.com');
  const { state, one, two } = twoTrips();
  let sync = markBackup(await signedIn(api, state), one, T(1));
  const first = await migrateTrip({ api: answerLost(api), sync, trip: state.trips[one], nowIso: T(2) });
  // what 1.1.2 kept: one slot with the trip id and sentKeys, no per-trip list and no flags
  const keys = [...tripToRecords(state.trips[one]).records.keys()];
  sync = { ...first.sync, migration: { tripId: one, step: 'failed', backupAt: T(1), stage: 'records', kind: 'offline', at: T(2), sentKeys: keys } };
  delete sync.moves;
  sync = markBackup(sync, two, T(3));
  state.trips[one].checklist = [];
  const retry = await migrateTrip({ api, sync: markBackup(sync, one, T(4)), trip: state.trips[one], nowIso: T(5) });
  assert.equal(retry.result, 'done');
  assert.equal(retry.trip, null);
  assert.equal(cloudRow(fake, 'item', 'item-1').deleted, true);
});

test('MG23 (B): the move cannot start (library not loaded) for trip 2: trip 1\'s progress is not copied onto trip 2 and not lost', async () => {
  const fake = createFakeCloud();
  const api = await approvedApi(fake, 'mg23@example.com');
  const { state, one, two } = twoTrips();
  let sync = markBackup(await signedIn(api, state), one, T(1));
  sync = (await migrateTrip({ api: answerLost(api), sync, trip: state.trips[one], nowIso: T(2) })).sync;
  const p1 = moveProgress(sync, one);
  assert.ok(p1.sentKeys.length > 0 && p1.created);
  sync = markMoveFailed(markBackup(sync, two, T(3)), two, 'offline', T(4));
  assert.equal(sync.migration.tripId, two);
  assert.equal(sync.migration.step, 'failed');
  assert.equal(sync.migration.backupAt, T(3), 'the dialog still knows trip 2 was backed up');
  assert.deepEqual(moveProgress(sync, two), {}, 'nothing of trip 1 on trip 2');
  assert.deepEqual(moveProgress(sync, one), p1, 'trip 1 kept as it was');
  // a 1.1.2 state of trip 1 inside sync.migration is not copied onto trip 2 either
  const old = { ...emptySyncState(), userId: sync.userId, migration: { tripId: one, step: 'failed', backupAt: T(1), stage: 'records', kind: 'offline', at: T(2), sentKeys: p1.sentKeys } };
  const after = markMoveFailed(old, two, 'offline', T(5));
  assert.deepEqual(moveProgress(after, two), {});
  assert.deepEqual(moveProgress(after, one).sentKeys, p1.sentKeys);
  assert.equal(after.migration.sentKeys, undefined, 'the dialog state holds no progress any more');
});

test('MG24 (B): deleting a trip from the account drops its move progress only; a later move of it starts clean', async () => {
  const fake = createFakeCloud();
  const api = await approvedApi(fake, 'mg24@example.com');
  const { state, one, two } = twoTrips();
  let sync = markBackup(await signedIn(api, state), two, T(1));
  sync = (await migrateTrip({ api: answerLost(api), sync, trip: state.trips[two], nowIso: T(2) })).sync;
  sync = markBackup(sync, one, T(3));
  sync = (await migrateTrip({ api, sync, trip: state.trips[one], nowIso: T(4) })).sync;
  const p2 = moveProgress(sync, two);
  const del = await deleteTripFromAccount({ api, sync, tripId: one, nowIso: T(5) });
  assert.deepEqual(moveProgress(del.sync, one), {});
  assert.deepEqual(moveProgress(del.sync, two), p2, 'trip 2\'s unfinished move is kept');
  const again = await migrateTrip({ api, sync: markBackup(del.sync, one, T(6)), trip: state.trips[one], nowIso: T(7) });
  assert.equal(again.result, 'done');
  assert.equal(again.trip, null);
  assert.equal(fake.trips.size, 2);
});
