// 1.1.2: deleting a trip from the account (owner only). The server deletes the trip, its records and its members
// (supabase/migrations/0003_delete_trip.sql); every phone KEEPS its own copy, unlinked ("on this device only").
// Fake backend (tests/fakes/fake-cloud.js) through the real src/js/core/cloud-api.js. No network. Sample data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptySyncState, runSync, markBackup, migrateTrip, downloadTrip, deleteTripFromAccount } from '../src/js/core/sync-engine.js';
import { createCloudApi, CloudError } from '../src/js/core/cloud-api.js';
import { createDefaultState } from '../src/js/core/schema.js';
import { createFakeCloud, fakeClient } from './fakes/fake-cloud.js';

const clone = (v) => JSON.parse(JSON.stringify(v));
let n = 0;
const makeId = () => { n += 1; return `dl-${String(n).padStart(4, '0')}`; };
const T = (min) => new Date(Date.parse('2026-11-23T12:00:00Z') + min * 60_000).toISOString();

function phoneState(name) {
  const state = createDefaultState({ now: () => new Date('2026-11-20T08:00:00Z'), appVersion: '1.1.2', makeId, countryCode: 'TH', tripName: name });
  const trip = state.trips[state.activeTripId];
  Object.assign(trip, {
    startDate: '2026-12-20', endDate: '2027-01-10',
    destinations: [{ id: `${trip.id}-stop`, name: 'Sample city', startDate: '2026-12-20', endDate: '2026-12-24', note: '' }],
    expenses: [{ id: `${trip.id}-exp`, amountMinor: 1000, currency: 'ILS', rate: 1, baseMinor: 1000, category: 'food', date: '2026-12-21', destinationId: null, description: 'Sample', note: '', method: 'cash', status: 'paid' }],
    checklist: [{ id: `${trip.id}-item`, group: 'documents', name: 'Sample item', qty: 1, note: '', done: false }],
  });
  return state;
}

async function user(fake, email, status = 'approved') {
  const uid = fake.addUser({ email, status });
  const client = fakeClient(fake);
  assert.equal((await client.auth.signInWithPassword({ email, password: 'Sample-Passw0rd!' })).error, null);
  return { uid, api: createCloudApi(client) };
}

/** A phone of the owner with its own trip, moved into the account (1.1.1 two steps). */
async function movedPhone(api, name) {
  const state = phoneState(name);
  const id = state.activeTripId;
  let sync = (await runSync({ api, sync: emptySyncState(), state, nowIso: T(0) })).sync;
  sync = markBackup(sync, id, T(1));
  const res = await migrateTrip({ api, sync, trip: state.trips[id], nowIso: T(2) });
  assert.equal(res.result, 'done');
  sync = (await runSync({ api, sync: res.sync, state, nowIso: T(3) })).sync;
  return { state, id, sync };
}

const recordsOf = (fake, id) => [...fake.records.values()].filter((r) => r.trip_id === id).length;

test('DL1: the owner deletes a trip: the trip, all its records and members go; the other trip and the phone stay as they were', async () => {
  const fake = createFakeCloud();
  const { api, uid } = await user(fake, 'dl1@example.com');
  const keep = await movedPhone(api, 'Sample trip B');
  const gone = await movedPhone(api, 'Sample trip A');
  const friend = await user(fake, 'dl1-friend@example.com');
  assert.equal(await api.share(gone.id, 'dl1-friend@example.com'), 'ok');
  const keepRecords = recordsOf(fake, keep.id);
  assert.ok(recordsOf(fake, gone.id) > 3 && keepRecords > 3);
  const phoneBefore = clone(gone.state);
  const syncBefore = clone(gone.sync);

  const res = await deleteTripFromAccount({ api, sync: gone.sync, tripId: gone.id, nowIso: T(10) });
  assert.equal(res.result, 'deleted');
  assert.equal(fake.trips.has(gone.id), false);
  assert.equal(recordsOf(fake, gone.id), 0, 'shared and personal records are gone');
  assert.equal(fake.members.has(gone.id), false, 'the friend lost access too');
  assert.equal(fake.trips.has(keep.id), true);
  assert.equal(recordsOf(fake, keep.id), keepRecords, 'the other trip is untouched');
  assert.deepEqual(gone.state, phoneBefore, 'nothing on the phone changed');
  assert.deepEqual(gone.sync, syncBefore, 'the sync state passed in is not changed (a new one is returned)');
  const e = res.sync.trips[gone.id];
  assert.equal(e.linked, false, 'the copy on this phone is now "on this device only"');
  assert.equal(e.deletedAt, T(10));
  assert.equal(res.sync.declined[gone.id], true, 'the app does not offer to move it again by itself');
  assert.equal(res.sync.cloudTrips.some((x) => x.id === gone.id), false);
  assert.ok(friend.uid && uid);
});

test('DL2: deleting again after a lost answer is safe: "missing" counts as done', async () => {
  const fake = createFakeCloud();
  const { api } = await user(fake, 'dl2@example.com');
  const p = await movedPhone(api, 'Sample trip');
  assert.equal(await api.deleteTrip(p.id), 'deleted'); // the server deleted it, the answer was lost on the way
  const res = await deleteTripFromAccount({ api, sync: p.sync, tripId: p.id, nowIso: T(10) });
  assert.equal(res.result, 'missing');
  assert.equal(res.sync.trips[p.id].linked, false);
});

test('DL3: a member cannot delete the trip: the app refuses without calling, and the server refuses too', async () => {
  const fake = createFakeCloud();
  const owner = await user(fake, 'dl3-owner@example.com');
  const p = await movedPhone(owner.api, 'Sample trip');
  const friend = await user(fake, 'dl3-friend@example.com');
  await owner.api.share(p.id, 'dl3-friend@example.com');
  const st = createDefaultState({ now: () => new Date('2026-11-20T08:00:00Z'), appVersion: '1.1.2', makeId, countryCode: 'TH', tripName: 'Friend trip' });
  let fsync = (await runSync({ api: friend.api, sync: emptySyncState(), state: st, nowIso: T(5) })).sync;
  const dl = await downloadTrip({ api: friend.api, sync: fsync, serverTrip: fsync.cloudTrips.find((x) => x.id === p.id), nowIso: T(6) });
  fsync = dl.sync;
  assert.equal(fsync.trips[p.id].role, 'member');
  fake.calls.length = 0;
  await assert.rejects(deleteTripFromAccount({ api: friend.api, sync: fsync, tripId: p.id, nowIso: T(7) }), (e) => e instanceof CloudError && e.kind === 'denied');
  assert.equal(fake.calls.some((c) => c.fn === 'delete_trip'), false, 'nothing was sent');
  await assert.rejects(friend.api.deleteTrip(p.id), (e) => e instanceof CloudError && e.kind === 'denied');
  assert.equal(fake.trips.has(p.id), true);
  assert.ok(recordsOf(fake, p.id) > 3);
});

test('DL4: a pending, a blocked and a signed-out user cannot delete; a stranger cannot delete someone else\'s trip', async () => {
  const fake = createFakeCloud();
  const owner = await user(fake, 'dl4-owner@example.com');
  const p = await movedPhone(owner.api, 'Sample trip');
  const pending = await user(fake, 'dl4-p@example.com', 'pending');
  const blocked = await user(fake, 'dl4-x@example.com', 'blocked');
  const stranger = await user(fake, 'dl4-c@example.com');
  for (const u of [pending, blocked, stranger]) {
    await assert.rejects(u.api.deleteTrip(p.id), (e) => e instanceof CloudError && e.kind === 'denied');
  }
  const anon = createCloudApi(fakeClient(fake));
  await assert.rejects(anon.deleteTrip(p.id), (e) => e instanceof CloudError);
  fake.setStatus(owner.uid, 'blocked');
  await assert.rejects(owner.api.deleteTrip(p.id), (e) => e instanceof CloudError && e.kind === 'denied');
  assert.equal(fake.trips.has(p.id), true);
});

test('DL5: no network or a server error: nothing is deleted, the error kind is kept, the phone stays linked', async () => {
  const fake = createFakeCloud();
  const { api } = await user(fake, 'dl5@example.com');
  const p = await movedPhone(api, 'Sample trip');
  for (const [fail, kind] of [['network', 'offline'], [500, 'offline'], [402, 'offline']]) {
    fake.fail = fail;
    await assert.rejects(deleteTripFromAccount({ api, sync: p.sync, tripId: p.id, nowIso: T(10) }), (e) => e instanceof CloudError && e.kind === kind);
    fake.fail = null;
    assert.equal(fake.trips.has(p.id), true);
    assert.equal(p.sync.trips[p.id].linked, true);
  }
});

test('DL6: the owner\'s other phone keeps its copy, unlinked, with a "deleted" notice; a friend\'s phone keeps its copy too', async () => {
  const fake = createFakeCloud();
  const owner = await user(fake, 'dl6-owner@example.com');
  const p = await movedPhone(owner.api, 'Sample trip');
  const friend = await user(fake, 'dl6-friend@example.com');
  await owner.api.share(p.id, 'dl6-friend@example.com');
  // the friend's phone and a second phone of the owner both have the trip, linked
  const copies = [];
  for (const who of [friend, owner]) {
    const st = createDefaultState({ now: () => new Date('2026-11-20T08:00:00Z'), appVersion: '1.1.2', makeId, countryCode: 'TH', tripName: 'Other' });
    let s = (await runSync({ api: who.api, sync: emptySyncState(), state: st, nowIso: T(5) })).sync;
    const dl = await downloadTrip({ api: who.api, sync: s, serverTrip: s.cloudTrips.find((x) => x.id === p.id), nowIso: T(6) });
    st.trips[p.id] = dl.trip; s = dl.sync;
    copies.push({ st, s });
  }
  await deleteTripFromAccount({ api: owner.api, sync: p.sync, tripId: p.id, nowIso: T(10) });
  const [fr, ow] = await Promise.all(copies.map(async (c, i) => {
    const before = clone(c.st.trips[p.id]);
    const r = await runSync({ api: i === 0 ? friend.api : owner.api, sync: c.s, state: c.st, nowIso: T(11) });
    return { r, before, after: c.st.trips[p.id] };
  }));
  for (const x of [fr, ow]) {
    assert.deepEqual(x.after, x.before, 'the copy on the phone is untouched');
    assert.equal(x.r.trips[p.id], undefined, 'no change to the trip is returned');
    assert.equal(x.r.sync.trips[p.id].linked, false);
  }
  assert.deepEqual(ow.r.notices.map((x) => x.type), ['deleted'], 'the owner is told it was deleted from the account');
  assert.equal(ow.r.sync.declined[p.id], true, 'and is not asked to move it back by itself');
  assert.deepEqual(fr.r.notices.map((x) => x.type), ['lost'], 'the friend is told it is no longer shared');
});
