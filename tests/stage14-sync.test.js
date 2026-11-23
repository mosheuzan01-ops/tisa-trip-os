// Stage 14: mapping between the local trip and cloud records, and the sync engine, against a FAKE backend
// (tests/fakes/fake-cloud.js) through the real src/js/core/cloud-api.js. No network. Sample data only.
// Owner decisions (2026-11-23): shared = route, places, flight details, participants, shared expenses (and their
// repayments); personal = budget, own flight price/status/note/booking/seat, checklist, luggage, journal, check-ins,
// expenses that are not split, settings. Only the trip owner changes the trip dates. Photos stay on the phone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tripToRecords, recordsToTrip, isSharedExpense, hashValue, recKey } from '../src/js/core/sync-map.js';
import { emptySyncState, runSync, uploadTrip, downloadTrip, noteLocalChanges, pendingCount } from '../src/js/core/sync-engine.js';
import { createCloudApi, CloudError } from '../src/js/core/cloud-api.js';
import { createDefaultState, validateState } from '../src/js/core/schema.js';
import { createKv, authStorage, keepCloudCopy, hasSavedSession, SYNC_KEY, AUTH_KEY } from '../src/js/core/storage.js';
import { createFakeCloud, fakeClient } from './fakes/fake-cloud.js';

const clone = (v) => JSON.parse(JSON.stringify(v));
let n = 0;
const makeId = () => { n += 1; return `id-${String(n).padStart(4, '0')}`; };
const T = (min) => new Date(Date.parse('2026-11-23T12:00:00Z') + min * 60_000).toISOString();

/** A trip with every field the app stores today, sample values only. */
function richState() {
  const state = createDefaultState({ now: () => new Date('2026-11-20T08:00:00Z'), appVersion: '1.1.0', makeId, countryCode: 'TH', tripName: 'תאילנד' });
  const trip = state.trips[state.activeTripId];
  Object.assign(trip, {
    startDate: '2026-12-20', endDate: '2027-01-20',
    destinations: [{ id: 'stop-1', name: 'Sample city', startDate: '2026-12-20', endDate: '2026-12-24', note: '' }, { name: 'broken stop, no id' }],
    places: [{ id: 'place-1', name: 'Sample temple', category: 'temple', status: 'want', lat: null, lng: null, address: '', note: '', stopId: 'stop-1', plannedDate: null, visitedDate: null, photoIds: ['photo-1'], createdAt: T(0), updatedAt: T(0) }],
    transfers: [{ id: 'tr-1', kind: 'flight', from: 'TLV', to: 'BKK', date: '2026-12-20', time: '10:00', company: 'Sample Air', booking: 'SAMPLE1', priceMinor: 250000, currency: 'ILS', link: '', status: 'booked', note: 'window', expenseId: 'exp-flight', flightNo: 'SA123', seat: '12A', seatPriceMinor: null, ticket: 'oneway' }],
    people: [{ id: 'person-1', name: 'Sample A' }, { id: 'person-2', name: 'Sample B' }],
    expenses: [
      { id: 'exp-flight', amountMinor: 250000, currency: 'ILS', rate: 1, baseMinor: 250000, category: 'flight', date: '2026-12-20', destinationId: null, description: 'TLV – BKK', note: '', method: 'card', status: 'paid', transferId: 'tr-1' },
      { id: 'exp-dinner', amountMinor: 30000, currency: 'THB', rate: 0.1, baseMinor: 3000, category: 'food', date: '2026-12-21', destinationId: 'stop-1', description: 'Sample dinner', note: '', method: 'cash', status: 'paid', paidBy: 'person-1', sharedBy: ['person-1', 'person-2'] },
    ],
    repayments: [{ id: 'rep-1', from: 'person-2', to: 'person-1', minor: 1500, date: '2026-12-22' }],
    rates: { ILS_THB: 9 },
    checklist: [{ id: 'item-1', group: 'documents', name: 'Sample passport check', qty: 1, note: '', done: false }],
    tasks: [{ id: 'task-1', title: 'Sample task', status: 'open', due: null, note: '' }],
    checkins: [{ id: 'ci-1', title: 'Sample check-in', booking: 'X', note: '' }],
    events: [{ id: 'ev-1', title: 'Sample event' }],
    journal: { '2026-12-21': { text: 'Sample note', updatedAt: T(1) } },
    info: { notes: { insurance: 'Sample policy note' } },
    assistant: { asked: 2 },
    photos: [{ id: 'photo-1', date: '2026-12-21', width: 10, height: 10, bytes: 100 }],
    templateOffer: 'new', builtinOffer: 'done', futureField: { kept: true },
  });
  trip.budget.totalMinor = 2000000; trip.budget.anchor = 'total';
  trip.luggage.bags.push({ id: 'bag-1', name: 'Sample bag', items: [] });
  trip.smartBag.activities.push('beach');
  trip.archive.budgets.push({ at: T(0), budget: { totalMinor: 1 } });
  state.trips[trip.id] = trip;
  return state;
}

function setup() {
  const fake = createFakeCloud();
  const a = fake.addUser({ email: 'user-a@example.com', status: 'approved', display_name: 'Sample A' });
  const b = fake.addUser({ email: 'user-b@example.com', status: 'approved', display_name: 'Sample B' });
  const clientA = fakeClient(fake);
  const clientB = fakeClient(fake);
  return { fake, a, b, clientA, clientB, apiA: createCloudApi(clientA), apiB: createCloudApi(clientB) };
}
async function signIn(client, email) { const r = await client.auth.signInWithPassword({ email, password: 'Sample-Passw0rd!' }); assert.equal(r.error, null); }

/** What the app does after a sync: keep the engine's state and put the trips it returned into the local data. */
function commit(state, sync, res) {
  for (const [id, trip] of Object.entries(res.trips)) state.trips[id] = trip;
  return res.sync;
}

// ---------------------------------------------------------------- mapping
test('M1: trip -> records -> trip gives back exactly the same trip (every field, unknown and broken ones too)', () => {
  const trip = Object.values(richState().trips)[0];
  const { meta, records } = tripToRecords(trip);
  assert.deepEqual(recordsToTrip(trip, meta, records), trip);
});

test('M2: the owner-approved split between shared and personal', () => {
  const st = richState(); const trip = Object.values(st.trips)[0];
  const { meta, records } = tripToRecords(trip);
  const kinds = (scope) => [...new Set([...records.values()].filter((r) => r.scope === scope).map((r) => r.kind))].sort();
  assert.deepEqual(kinds('shared'), ['expense', 'person', 'place', 'repayment', 'stop', 'transfer']);
  assert.deepEqual(meta, { name: 'תאילנד', countryCode: 'TH', startDate: '2026-12-20', endDate: '2027-01-20' });
  for (const k of ['budget', 'rates', 'luggage', 'smartBag', 'journal', 'info', 'assistant', 'archive']) {
    assert.equal(records.get(recKey('personal', 'obj', k))?.scope, 'personal', k);
  }
  for (const [kind, id] of [['item', 'item-1'], ['task', 'task-1'], ['checkin', 'ci-1'], ['event', 'ev-1'], ['transfer-mine', 'tr-1'], ['place-mine', 'place-1'], ['expense', 'exp-flight']]) {
    assert.ok(records.has(recKey('personal', kind, id)), `${kind} ${id} is personal`);
  }
  assert.ok(records.has(recKey('shared', 'expense', 'exp-dinner')), 'a split expense is shared');
  assert.ok(!records.has(recKey('shared', 'expense', 'exp-flight')), 'an expense that is not split is not shared');
  const all = JSON.stringify([...records.values()]);
  assert.doesNotMatch(all, /"bytes"|templateOffer|builtinOffer|"width"/, 'photos and one-time offers stay on the phone');
  assert.ok(![...records.values()].some((r) => r.rec_id === 'photos' || r.kind === 'photo'), 'no photo records');
  assert.ok(records.has(recKey('personal', 'extra', 'futureField')), 'an unknown field is kept (personal)');
  assert.ok(records.has(recKey('personal', 'loose', 'destinations')), 'an entry without an id is kept (personal)');
});

test('M3: flight details are shared, the price, status, note, booking, seat and linked expense are personal', () => {
  const trip = Object.values(richState().trips)[0];
  const { records } = tripToRecords(trip);
  const shared = records.get(recKey('shared', 'transfer', 'tr-1')).data.v;
  for (const k of ['priceMinor', 'currency', 'seatPriceMinor', 'expenseId', 'seat', 'booking', 'status', 'note']) assert.ok(!(k in shared), `${k} is not shared`);
  for (const k of ['from', 'to', 'date', 'time', 'company', 'flightNo', 'kind', 'ticket', 'link']) assert.ok(k in shared, `${k} is shared`);
  const mine = records.get(recKey('personal', 'transfer-mine', 'tr-1')).data.v;
  assert.equal(mine.priceMinor, 250000); assert.equal(mine.status, 'booked'); assert.equal(mine.note, 'window');
  const place = records.get(recKey('shared', 'place', 'place-1')).data.v;
  assert.ok(!('photoIds' in place), 'photo links of a place stay personal');
});

test('M4: isSharedExpense follows the existing split fields only', () => {
  assert.equal(isSharedExpense({ id: 'x' }), false);
  assert.equal(isSharedExpense({ id: 'x', paidBy: 'p' }), true);
  assert.equal(isSharedExpense({ id: 'x', sharedBy: ['p'] }), true);
  assert.equal(isSharedExpense({ id: 'x', sharedBy: [] }), false);
  assert.equal(isSharedExpense({ id: 'x', split: { mode: 'percent', shares: {} } }), true);
  assert.equal(hashValue({ a: 1, b: [2] }), hashValue({ b: [2], a: 1 }), 'hash ignores key order');
});

// ---------------------------------------------------------------- engine
test('E1: first upload, then repeated syncs and a repeated upload create no duplicates and change nothing', async () => {
  const { fake, apiA, clientA } = setup(); await signIn(clientA, 'user-a@example.com');
  const state = richState(); const id = state.activeTripId; const before = clone(state);
  let sync = emptySyncState();
  const up = await uploadTrip({ api: apiA, sync, trip: state.trips[id], nowIso: T(1) });
  assert.equal(up.result, 'created'); sync = up.sync;
  sync = commit(state, sync, await runSync({ api: apiA, sync, state, nowIso: T(2) }));
  const count = fake.records.size;
  assert.ok(count >= 20, `records stored: ${count}`);
  for (let i = 0; i < 3; i += 1) sync = commit(state, sync, await runSync({ api: apiA, sync, state, nowIso: T(3 + i) }));
  const again = await uploadTrip({ api: apiA, sync, trip: state.trips[id], nowIso: T(9) });
  assert.equal(again.result, 'exists');
  sync = commit(state, again.sync, await runSync({ api: apiA, sync: again.sync, state, nowIso: T(10) }));
  assert.equal(fake.records.size, count, 'no duplicate rows');
  assert.equal(fake.trips.size, 1, 'one trip in the cloud');
  assert.deepEqual(state, before, 'local data unchanged by syncing');
  assert.equal(pendingCount(sync, state), 0);
  assert.equal(validateState(state).length, 0);
});

test('E2: a friend sees the shared trip without the owner\'s budget, price or personal expense', async () => {
  const { apiA, apiB, clientA, clientB } = setup(); await signIn(clientA, 'user-a@example.com'); await signIn(clientB, 'user-b@example.com');
  const stA = richState(); const id = stA.activeTripId;
  let syncA = (await uploadTrip({ api: apiA, sync: emptySyncState(), trip: stA.trips[id], nowIso: T(1) })).sync;
  syncA = commit(stA, syncA, await runSync({ api: apiA, sync: syncA, state: stA, nowIso: T(2) }));
  assert.equal(await apiA.share(id, 'USER-B@example.com '), 'ok');

  const stB = createDefaultState({ now: () => new Date(T(0)), appVersion: '1.1.0', makeId, countryCode: 'TH', tripName: 'B trip' });
  let syncB = commit(stB, emptySyncState(), await runSync({ api: apiB, sync: emptySyncState(), state: stB, nowIso: T(3) }));
  const listed = syncB.cloudTrips.find((x) => x.id === id);
  assert.equal(listed?.role, 'member');
  const dl = await downloadTrip({ api: apiB, sync: syncB, serverTrip: listed, nowIso: T(4) });
  stB.trips[id] = dl.trip; syncB = dl.sync;
  const tB = stB.trips[id];
  assert.equal(tB.startDate, '2026-12-20'); assert.equal(tB.name, 'תאילנד');
  assert.deepEqual(tB.destinations.map((x) => x.id), ['stop-1']);
  assert.deepEqual(tB.people.map((x) => x.id), ['person-1', 'person-2']);
  assert.deepEqual(tB.expenses.map((x) => x.id), ['exp-dinner'], 'only the shared expense');
  assert.equal(tB.budget.totalMinor, null, 'no budget of the owner');
  assert.equal(tB.transfers[0].flightNo, 'SA123');
  assert.equal(tB.transfers[0].priceMinor, undefined, 'no flight price of the owner');
  assert.equal(tB.transfers[0].booking, undefined, 'no booking reference of the owner');
  assert.deepEqual(tB.checklist, [], 'no checklist of the owner');
  assert.equal(tB.places[0].photoIds, undefined);
  assert.equal(validateState(stB).length, 0, 'still a valid state');
  assert.ok(stB.trips[stB.activeTripId], 'B keeps its own trip too');
});

test('E3 (S14-4): edits made offline wait, then sync after the network is back, with no loss or duplicate', async () => {
  const { fake, apiA, apiB, clientA, clientB } = setup(); await signIn(clientA, 'user-a@example.com'); await signIn(clientB, 'user-b@example.com');
  const stA = richState(); const id = stA.activeTripId;
  let syncA = (await uploadTrip({ api: apiA, sync: emptySyncState(), trip: stA.trips[id], nowIso: T(1) })).sync;
  syncA = commit(stA, syncA, await runSync({ api: apiA, sync: syncA, state: stA, nowIso: T(2) }));
  await apiA.share(id, 'user-b@example.com');
  fake.fail = 'network';
  stA.trips[id].destinations.push({ id: 'stop-2', name: 'Offline stop', startDate: '2026-12-24', endDate: '2026-12-28', note: '' });
  noteLocalChanges(syncA, stA, T(3));
  assert.equal(pendingCount(syncA, stA), 1, 'one change waits');
  const kept = clone(stA);
  await assert.rejects(runSync({ api: apiA, sync: syncA, state: stA, nowIso: T(4) }), (e) => e instanceof CloudError && e.kind === 'offline');
  assert.deepEqual(stA, kept, 'nothing local changed while offline');
  fake.fail = null;
  syncA = commit(stA, syncA, await runSync({ api: apiA, sync: syncA, state: stA, nowIso: T(5) }));
  assert.equal(pendingCount(syncA, stA), 0);
  const stB = createDefaultState({ now: () => new Date(T(0)), appVersion: '1.1.0', makeId, countryCode: 'TH', tripName: 'B' });
  const syncB0 = commit(stB, emptySyncState(), await runSync({ api: apiB, sync: emptySyncState(), state: stB, nowIso: T(6) }));
  const dl = await downloadTrip({ api: apiB, sync: syncB0, serverTrip: syncB0.cloudTrips[0], nowIso: T(7) });
  assert.deepEqual(dl.trip.destinations.map((x) => x.id), ['stop-1', 'stop-2']);
  const rows = [...fake.records.values()].filter((r) => r.kind === 'stop' && r.rec_id === 'stop-2');
  assert.equal(rows.length, 1, 'stored once');
});

for (const failure of ['network', 500, 502, 402, 401]) {
  test(`E4 (S14-5): server failure "${failure}" never changes or deletes local data, and keeps the waiting changes`, async () => {
    const { fake, apiA, clientA } = setup(); await signIn(clientA, 'user-a@example.com');
    const st = richState(); const id = st.activeTripId;
    let sync = (await uploadTrip({ api: apiA, sync: emptySyncState(), trip: st.trips[id], nowIso: T(1) })).sync;
    sync = commit(st, sync, await runSync({ api: apiA, sync, state: st, nowIso: T(2) }));
    st.trips[id].checklist.push({ id: 'item-2', group: 'money', name: 'Sample card', qty: 1, note: '', done: false });
    noteLocalChanges(sync, st, T(3));
    const keptState = JSON.stringify(st); const keptSync = JSON.stringify(sync);
    fake.fail = failure;
    await assert.rejects(runSync({ api: apiA, sync, state: st, nowIso: T(4) }), (e) => e instanceof CloudError);
    assert.equal(JSON.stringify(st), keptState, 'local data byte for byte the same');
    assert.equal(JSON.stringify(sync), keptSync, 'sync state untouched (the change still waits)');
    fake.fail = null;
    sync = commit(st, sync, await runSync({ api: apiA, sync, state: st, nowIso: T(5) }));
    assert.equal(pendingCount(sync, st), 0);
  });
}

test('E5: edit conflict, last edit wins on both phones, and the losing version is kept as a copy', async () => {
  const { apiA, apiB, clientA, clientB } = setup(); await signIn(clientA, 'user-a@example.com'); await signIn(clientB, 'user-b@example.com');
  const stA = richState(); const id = stA.activeTripId;
  let syncA = (await uploadTrip({ api: apiA, sync: emptySyncState(), trip: stA.trips[id], nowIso: T(1) })).sync;
  syncA = commit(stA, syncA, await runSync({ api: apiA, sync: syncA, state: stA, nowIso: T(2) }));
  await apiA.share(id, 'user-b@example.com');
  const stB = createDefaultState({ now: () => new Date(T(0)), appVersion: '1.1.0', makeId, countryCode: 'TH', tripName: 'B' });
  let syncB = commit(stB, emptySyncState(), await runSync({ api: apiB, sync: emptySyncState(), state: stB, nowIso: T(3) }));
  const dl = await downloadTrip({ api: apiB, sync: syncB, serverTrip: syncB.cloudTrips[0], nowIso: T(4) });
  stB.trips[id] = dl.trip; syncB = dl.sync;
  // A edits first (earlier), B edits later; A syncs first.
  stA.trips[id].destinations[0].note = 'A says'; noteLocalChanges(syncA, stA, T(10));
  stB.trips[id].destinations[0].note = 'B says'; noteLocalChanges(syncB, stB, T(11));
  syncA = commit(stA, syncA, await runSync({ api: apiA, sync: syncA, state: stA, nowIso: T(12) }));
  syncB = commit(stB, syncB, await runSync({ api: apiB, sync: syncB, state: stB, nowIso: T(13) }));
  syncA = commit(stA, syncA, await runSync({ api: apiA, sync: syncA, state: stA, nowIso: T(14) }));
  assert.equal(stA.trips[id].destinations[0].note, 'B says');
  assert.equal(stB.trips[id].destinations[0].note, 'B says');
  assert.ok(syncB.conflicts.some((c) => c.type === 'kept-local' && JSON.stringify(c.remote).includes('A says')), 'A\'s version kept as a copy');
  // Now A edits later than B but syncs second: A's edit wins.
  stB.trips[id].destinations[0].note = 'B again'; noteLocalChanges(syncB, stB, T(20));
  stA.trips[id].destinations[0].note = 'A again'; noteLocalChanges(syncA, stA, T(21));
  syncB = commit(stB, syncB, await runSync({ api: apiB, sync: syncB, state: stB, nowIso: T(22) }));
  syncA = commit(stA, syncA, await runSync({ api: apiA, sync: syncA, state: stA, nowIso: T(23) }));
  syncB = commit(stB, syncB, await runSync({ api: apiB, sync: syncB, state: stB, nowIso: T(24) }));
  assert.equal(stB.trips[id].destinations[0].note, 'A again');
  assert.ok(syncA.conflicts.some((c) => JSON.stringify(c.remote).includes('B again')), 'B\'s version kept as a copy on A');
  // B's own version lost on B: it is kept there too, with a notice.
  syncB.conflicts.length = 0;
  stB.trips[id].destinations[0].note = 'B old'; noteLocalChanges(syncB, stB, T(25));
  stA.trips[id].destinations[0].note = 'A newest'; noteLocalChanges(syncA, stA, T(26));
  syncA = commit(stA, syncA, await runSync({ api: apiA, sync: syncA, state: stA, nowIso: T(27) }));
  const res = await runSync({ api: apiB, sync: syncB, state: stB, nowIso: T(28) });
  syncB = commit(stB, syncB, res);
  assert.equal(stB.trips[id].destinations[0].note, 'A newest');
  assert.ok(syncB.conflicts.some((c) => c.type === 'replaced' && JSON.stringify(c.local).includes('B old')), 'B\'s losing version kept');
  assert.ok(res.notices.some((x) => x.type === 'replaced'), 'B is told');
});

test('E6: a stop deleted by a friend leaves the owner\'s phone, and a copy is kept there', async () => {
  const { apiA, apiB, clientA, clientB } = setup(); await signIn(clientA, 'user-a@example.com'); await signIn(clientB, 'user-b@example.com');
  const stA = richState(); const id = stA.activeTripId;
  let syncA = (await uploadTrip({ api: apiA, sync: emptySyncState(), trip: stA.trips[id], nowIso: T(1) })).sync;
  syncA = commit(stA, syncA, await runSync({ api: apiA, sync: syncA, state: stA, nowIso: T(2) }));
  await apiA.share(id, 'user-b@example.com');
  const stB = createDefaultState({ now: () => new Date(T(0)), appVersion: '1.1.0', makeId, countryCode: 'TH', tripName: 'B' });
  let syncB = commit(stB, emptySyncState(), await runSync({ api: apiB, sync: emptySyncState(), state: stB, nowIso: T(3) }));
  const dl = await downloadTrip({ api: apiB, sync: syncB, serverTrip: syncB.cloudTrips[0], nowIso: T(4) });
  stB.trips[id] = dl.trip; syncB = dl.sync;
  stB.trips[id].destinations = stB.trips[id].destinations.filter((x) => x.id !== 'stop-1');
  noteLocalChanges(syncB, stB, T(5));
  syncB = commit(stB, syncB, await runSync({ api: apiB, sync: syncB, state: stB, nowIso: T(6) }));
  const res = await runSync({ api: apiA, sync: syncA, state: stA, nowIso: T(7) });
  syncA = commit(stA, syncA, res);
  assert.deepEqual(stA.trips[id].destinations.map((x) => x.id ?? 'no-id'), ['no-id'], 'the deleted stop is gone, the broken entry stays');
  assert.ok(syncA.conflicts.some((c) => c.type === 'removed' && c.local?.v?.id === 'stop-1'), 'a copy of the deleted stop is kept');
});

test('E7: only the owner changes the trip dates; a friend\'s change is not sent and is kept as a copy', async () => {
  const { fake, apiA, apiB, clientA, clientB } = setup(); await signIn(clientA, 'user-a@example.com'); await signIn(clientB, 'user-b@example.com');
  const stA = richState(); const id = stA.activeTripId;
  let syncA = (await uploadTrip({ api: apiA, sync: emptySyncState(), trip: stA.trips[id], nowIso: T(1) })).sync;
  syncA = commit(stA, syncA, await runSync({ api: apiA, sync: syncA, state: stA, nowIso: T(2) }));
  await apiA.share(id, 'user-b@example.com');
  const stB = createDefaultState({ now: () => new Date(T(0)), appVersion: '1.1.0', makeId, countryCode: 'TH', tripName: 'B' });
  let syncB = commit(stB, emptySyncState(), await runSync({ api: apiB, sync: emptySyncState(), state: stB, nowIso: T(3) }));
  const dl = await downloadTrip({ api: apiB, sync: syncB, serverTrip: syncB.cloudTrips[0], nowIso: T(4) });
  stB.trips[id] = dl.trip; syncB = dl.sync;
  stB.trips[id].startDate = '2026-01-01'; noteLocalChanges(syncB, stB, T(5));
  const res = await runSync({ api: apiB, sync: syncB, state: stB, nowIso: T(6) });
  syncB = commit(stB, syncB, res);
  assert.equal(fake.trips.get(id).start_date, '2026-12-20', 'server unchanged');
  assert.equal(stB.trips[id].startDate, '2026-12-20', 'the owner\'s date comes back');
  assert.ok(res.notices.some((x) => x.type === 'datesOwnerOnly'));
  assert.ok(syncB.conflicts.some((c) => c.type === 'datesOwnerOnly' && c.local.startDate === '2026-01-01'));
  // The owner's change does reach the friend.
  stA.trips[id].endDate = '2027-01-22'; noteLocalChanges(syncA, stA, T(7));
  syncA = commit(stA, syncA, await runSync({ api: apiA, sync: syncA, state: stA, nowIso: T(8) }));
  syncB = commit(stB, syncB, await runSync({ api: apiB, sync: syncB, state: stB, nowIso: T(9) }));
  assert.equal(stB.trips[id].endDate, '2027-01-22');
});

for (const status of ['pending', 'blocked']) {
  test(`E8 (S14-2): a ${status} user sends and reads no trip data`, async () => {
    const { fake, clientA } = setup();
    const u = fake.addUser({ email: `${status}@example.com`, status });
    await signIn(clientA, `${status}@example.com`);
    const api = createCloudApi(clientA);
    const st = richState(); const kept = clone(st);
    fake.calls.length = 0;
    const res = await runSync({ api, sync: emptySyncState(), state: st, nowIso: T(1) });
    assert.equal(res.status, status);
    assert.deepEqual(fake.calls.map((c) => c.fn), ['my_profile'], 'only the profile is read');
    await assert.rejects(uploadTrip({ api, sync: res.sync, trip: st.trips[st.activeTripId], nowIso: T(2) }), (e) => e.kind === 'denied');
    assert.deepEqual(st, kept);
    assert.equal(fake.records.size, 0); assert.equal(fake.trips.size, 0);
    assert.ok(u);
  });
}

test('E9 (S14-6 / restore): after a backup import the sync waits for the user\'s choice and sends nothing', async () => {
  const { fake, apiA, clientA } = setup(); await signIn(clientA, 'user-a@example.com');
  const st = richState(); const id = st.activeTripId;
  let sync = (await uploadTrip({ api: apiA, sync: emptySyncState(), trip: st.trips[id], nowIso: T(1) })).sync;
  sync = commit(st, sync, await runSync({ api: apiA, sync, state: st, nowIso: T(2) }));
  sync.restorePending = true;
  st.trips[id].destinations = [];
  fake.calls.length = 0;
  const res = await runSync({ api: apiA, sync, state: st, nowIso: T(3) });
  assert.equal(res.status, 'restore');
  assert.deepEqual(fake.calls.map((c) => c.fn), ['my_profile']);
  assert.ok([...fake.records.values()].some((r) => r.kind === 'stop' && !r.deleted), 'the cloud copy is untouched');
});

test('E10: an expense that becomes shared moves to the shared list once, and is counted once', async () => {
  const { fake, apiA, apiB, clientA, clientB } = setup(); await signIn(clientA, 'user-a@example.com'); await signIn(clientB, 'user-b@example.com');
  const stA = richState(); const id = stA.activeTripId;
  let syncA = (await uploadTrip({ api: apiA, sync: emptySyncState(), trip: stA.trips[id], nowIso: T(1) })).sync;
  syncA = commit(stA, syncA, await runSync({ api: apiA, sync: syncA, state: stA, nowIso: T(2) }));
  await apiA.share(id, 'user-b@example.com');
  const flight = stA.trips[id].expenses.find((e) => e.id === 'exp-flight');
  flight.paidBy = 'person-1'; flight.sharedBy = ['person-1', 'person-2'];
  noteLocalChanges(syncA, stA, T(3));
  syncA = commit(stA, syncA, await runSync({ api: apiA, sync: syncA, state: stA, nowIso: T(4) }));
  syncA = commit(stA, syncA, await runSync({ api: apiA, sync: syncA, state: stA, nowIso: T(5) }));
  assert.equal(stA.trips[id].expenses.filter((e) => e.id === 'exp-flight').length, 1, 'once on the owner\'s phone');
  const rows = [...fake.records.values()].filter((r) => r.kind === 'expense' && r.rec_id === 'exp-flight');
  assert.deepEqual(rows.map((r) => [r.scope === 'shared' ? 'shared' : 'personal', r.deleted]).sort(), [['personal', true], ['shared', false]]);
  const stB = createDefaultState({ now: () => new Date(T(0)), appVersion: '1.1.0', makeId, countryCode: 'TH', tripName: 'B' });
  const syncB = commit(stB, emptySyncState(), await runSync({ api: apiB, sync: emptySyncState(), state: stB, nowIso: T(6) }));
  const dl = await downloadTrip({ api: apiB, sync: syncB, serverTrip: syncB.cloudTrips[0], nowIso: T(7) });
  assert.deepEqual(dl.trip.expenses.map((e) => e.id).sort(), ['exp-dinner', 'exp-flight']);
});

test('E11: a trip that is no longer shared with you stays on your phone, unlinked, with a notice', async () => {
  const { apiA, apiB, clientA, clientB, b } = setup(); await signIn(clientA, 'user-a@example.com'); await signIn(clientB, 'user-b@example.com');
  const stA = richState(); const id = stA.activeTripId;
  let syncA = (await uploadTrip({ api: apiA, sync: emptySyncState(), trip: stA.trips[id], nowIso: T(1) })).sync;
  syncA = commit(stA, syncA, await runSync({ api: apiA, sync: syncA, state: stA, nowIso: T(2) }));
  await apiA.share(id, 'user-b@example.com');
  const stB = createDefaultState({ now: () => new Date(T(0)), appVersion: '1.1.0', makeId, countryCode: 'TH', tripName: 'B' });
  let syncB = commit(stB, emptySyncState(), await runSync({ api: apiB, sync: emptySyncState(), state: stB, nowIso: T(3) }));
  const dl = await downloadTrip({ api: apiB, sync: syncB, serverTrip: syncB.cloudTrips[0], nowIso: T(4) });
  stB.trips[id] = dl.trip; syncB = dl.sync;
  await apiA.unshare(id, b);
  const kept = clone(stB.trips[id]);
  const res = await runSync({ api: apiB, sync: syncB, state: stB, nowIso: T(5) });
  syncB = commit(stB, syncB, res);
  assert.deepEqual(stB.trips[id], kept, 'nothing deleted');
  assert.equal(syncB.trips[id].linked, false);
  assert.ok(res.notices.some((x) => x.type === 'lost' && x.tripId === id));
});

test('E12: language and the assistant limit follow the account; theme and backup date stay on the phone', async () => {
  const { apiA, clientA, clientB } = setup(); await signIn(clientA, 'user-a@example.com'); await signIn(clientB, 'user-a@example.com');
  const apiA2 = createCloudApi(clientB);
  const st1 = richState(); st1.settings.assistantQuestionLimit = 7; st1.settings.theme = 'dark';
  let s1 = emptySyncState();
  noteLocalChanges(s1, st1, T(1));
  s1 = (await runSync({ api: apiA, sync: s1, state: st1, nowIso: T(2) })).sync;
  const st2 = richState(); st2.settings.theme = 'light';
  const res = await runSync({ api: apiA2, sync: emptySyncState(), state: st2, nowIso: T(3) });
  assert.equal(res.settings?.assistantQuestionLimit, 7);
  assert.equal(res.settings?.theme, undefined, 'theme is not taken from the account');
  assert.ok(s1);
});

test('E13: an approved admin syncing a trip never takes other people\'s personal records', async () => {
  const { fake, apiA, clientA, clientB, a } = setup(); await signIn(clientA, 'user-a@example.com');
  const m = fake.addUser({ email: 'admin@example.com', status: 'approved', role: 'admin' });
  const stA = richState(); const id = stA.activeTripId;
  let syncA = (await uploadTrip({ api: apiA, sync: emptySyncState(), trip: stA.trips[id], nowIso: T(1) })).sync;
  syncA = commit(stA, syncA, await runSync({ api: apiA, sync: syncA, state: stA, nowIso: T(2) }));
  await apiA.share(id, 'admin@example.com');
  await signIn(clientB, 'admin@example.com');
  const apiM = createCloudApi(clientB);
  const stM = createDefaultState({ now: () => new Date(T(0)), appVersion: '1.1.0', makeId, countryCode: 'TH', tripName: 'M' });
  const syncM = commit(stM, emptySyncState(), await runSync({ api: apiM, sync: emptySyncState(), state: stM, nowIso: T(3) }));
  const dl = await downloadTrip({ api: apiM, sync: syncM, serverTrip: syncM.cloudTrips[0], nowIso: T(4) });
  assert.equal(dl.trip.budget.totalMinor, null, 'the owner\'s budget is not copied into the admin\'s phone');
  assert.ok(a && m);
});

// ---------------------------------------------------------------- api errors and storage
test('API1: server answers become clear kinds (offline, auth, denied) and never throw anything else', async () => {
  const fake = createFakeCloud(); const client = fakeClient(fake); const api = createCloudApi(client);
  fake.addUser({ email: 'user-a@example.com', status: 'approved' }); await signIn(client, 'user-a@example.com');
  for (const [fail, kind] of [['network', 'offline'], [500, 'offline'], [503, 'offline'], [402, 'offline'], [401, 'auth'], [403, 'denied']]) {
    fake.fail = fail;
    await assert.rejects(api.myTrips(), (e) => e instanceof CloudError && e.kind === kind, String(fail));
  }
  fake.fail = null;
  await assert.rejects(api.share('nope', 'x@example.com'), (e) => e.kind === 'denied');
});

test('ST1: the sign-in session can only use latisa:auth: keys; tisa:v1 is out of its reach', () => {
  const map = new Map([['tisa:v1', '{"keep":true}']]);
  const backend = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
  const s = authStorage(backend);
  s.setItem(AUTH_KEY, 'session'); s.setItem(`${AUTH_KEY}-code-verifier`, 'v');
  s.setItem('tisa:v1', 'overwritten?'); s.removeItem('tisa:v1');
  assert.equal(map.get('tisa:v1'), '{"keep":true}');
  assert.equal(s.getItem('tisa:v1'), null, 'cannot read app data either');
  assert.equal(map.get(AUTH_KEY), 'session');
  assert.equal(hasSavedSession(backend), true);
  const kv = createKv({ backend, key: SYNC_KEY });
  assert.equal(kv.read(), null); assert.equal(kv.write({ v: 1 }), true); assert.deepEqual(kv.read(), { v: 1 });
  assert.equal(keepCloudCopy(backend, 'tisa:v1'), true);
  map.set('tisa:v1', 'changed');
  assert.equal(keepCloudCopy(backend, 'tisa:v1'), false, 'kept once, never overwritten');
  assert.equal(map.get('latisa:premigration:v1'), '{"keep":true}');
  for (const k of map.keys()) assert.match(k, /^(tisa:|latisa:)/);
  const broken = createKv({ backend: { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } }, key: SYNC_KEY });
  assert.equal(broken.read(), null); assert.equal(broken.write({}), false);
});
