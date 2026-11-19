// Stage 5: checklist and tasks (docs/GOALS_STAGE5.md S5-1..S5-9). Written before src/js/core/checklist.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GROUPS, groupKind, validateItem, makeItem, progress, needsCheck, validateVerify, seedChecklist, seedTasks,
  validateTask, makeTask, taskState, openTasks, nextTask, cleanItems, cleanTasks, NAME_MAX,
} from '../src/js/core/checklist.js';
import { TH } from '../data/packs/th.js';
import { SCHEMA_VERSION, migrate, validateState, createDefaultState } from '../src/js/core/schema.js';
import { createStorage } from '../src/js/core/storage.js';
import { exportBackup, parseBackup } from '../src/js/core/backup.js';
import { readText } from './helpers.js';

let n = 0;
const id = () => `i${++n}`;
const item = (o) => makeItem({ group: 'documents', name: 'דרכון', qty: '1', note: '', ...o }, id);

test('six groups: three for preparation, three for packing', () => {
  assert.deepEqual(GROUPS, ['documents', 'money', 'comms', 'health', 'clothing', 'chargers']);
  assert.deepEqual(GROUPS.map(groupKind), ['prep', 'prep', 'prep', 'pack', 'pack', 'pack']);
});

test('validateItem: name, quantity, note and group are checked', () => {
  assert.deepEqual(validateItem({ group: 'money', name: 'כרטיס אשראי', qty: '2', note: '' }), []);
  assert.deepEqual(validateItem({ group: 'money', name: ' ', qty: '1' }), ['name.missing']);
  assert.deepEqual(validateItem({ group: 'money', name: 'x'.repeat(NAME_MAX + 1), qty: '1' }), ['name.tooLong']);
  for (const bad of ['0', '-1', '1.5', 'abc', '1000']) assert.deepEqual(validateItem({ group: 'money', name: 'a', qty: bad }), ['qty.invalid'], bad);
  assert.deepEqual(validateItem({ group: 'money', name: 'a', qty: '' }), [], 'empty quantity means 1');
  assert.deepEqual(validateItem({ group: 'boats', name: 'a', qty: '1' }), ['group.invalid']);
  assert.deepEqual(validateItem({ group: 'money', name: 'a', qty: '1', note: 'x'.repeat(141) }), ['note.tooLong']);
  const it = item({ qty: '' });
  assert.deepEqual([it.qty, it.done, it.note], [1, false, '']);
});

test('S5-4: two separate progress bars, including 0 items and 100%', () => {
  assert.deepEqual(progress([]), { prep: { done: 0, total: 0, pct: null }, pack: { done: 0, total: 0, pct: null } });
  const list = [
    item({ group: 'documents' }), item({ group: 'money' }), item({ group: 'comms' }),
    item({ group: 'clothing' }), item({ group: 'chargers' }),
  ];
  list[0].done = true;
  list[3].done = true;
  assert.deepEqual(progress(list), { prep: { done: 1, total: 3, pct: 33 }, pack: { done: 1, total: 2, pct: 50 } });
  list[4].done = true;
  assert.equal(progress(list).pack.pct, 100);
  list[1].done = true;
  list[2].done = true;
  assert.equal(progress(list).prep.pct, 100);
  list[2].done = false; // un-tick
  assert.equal(progress(list).prep.pct, 66, 'rounded down: 100% only when all are done');
});

test('S5-8: rule-dependent items stay "to check" until a check date is written; source and date are validated', () => {
  const visa = item({ name: 'אשרה', verify: true });
  assert.deepEqual(visa.verify, { source: '', checkedAt: null });
  assert.equal(needsCheck(visa), true);
  assert.equal(needsCheck({ ...visa, verify: { source: 'אתר רשמי', checkedAt: '2026-11-19' } }), false);
  assert.equal(needsCheck(item({})), false);
  assert.deepEqual(validateVerify({ source: 'אתר', checkedAt: '2026-11-19' }), []);
  assert.deepEqual(validateVerify({ source: '', checkedAt: '' }), []);
  assert.deepEqual(validateVerify({ source: 'x'.repeat(201), checkedAt: '' }), ['source.tooLong']);
  assert.deepEqual(validateVerify({ source: '', checkedAt: '2026-02-30' }), ['checkedAt.invalid']);
});

test('S5-8: the starter list and tasks hold names only: no numbers, rules, dates or medicine names', () => {
  assert.ok(TH.checklistSeed.length >= 12);
  assert.deepEqual([...new Set(TH.checklistSeed.map((x) => x.group))].sort(), [...GROUPS].sort(), 'every group has items');
  for (const x of [...TH.checklistSeed, ...TH.taskSeed]) {
    const text = JSON.stringify(x.name ?? x.title);
    assert.doesNotMatch(text, /\d/, `no numbers: ${text}`);
  }
  const verify = TH.checklistSeed.filter((x) => x.verify).map((x) => x.name.en);
  for (const want of ['Passport validity', 'Visa and entry requirements', 'International driving permit']) assert.ok(verify.includes(want), want);
  assert.equal(TH.checklistSeed.filter((x) => x.group === 'health' && /medic|תרופ/i.test(JSON.stringify(x.name))).length, 1, 'one general medicine item');
  assert.deepEqual(TH.taskSeed.map((x) => x.title.en), ['Book flights', 'Travel insurance', 'Check entry requirements', 'Book stays', 'Plan transfers', 'Prepare payment methods', 'Check documents']);
  const locales = readText('locales/he.json') + readText('locales/en.json');
  assert.doesNotMatch(locales.match(/"(list|task)\.[^"]*": "[^"]*"/g)?.join('') ?? '', /\d/, 'checklist copy has no numbers');
});

test('S5-3: seeding makes fresh items with new ids; verify items start unchecked', () => {
  const items = seedChecklist(TH, 'he', id);
  assert.equal(items.length, TH.checklistSeed.length);
  assert.ok(items.every((x) => x.done === false && x.qty === 1 && /^i\d+$/.test(x.id)));
  assert.ok(items.filter((x) => x.verify).every(needsCheck));
  const tasks = seedTasks(TH, 'he', id);
  assert.equal(tasks.length, 7);
  assert.ok(tasks.every((x) => x.status === 'open' && x.due === null));
  assert.equal(seedTasks(TH, 'en', id)[0].title, 'Book flights');
});

test('tasks: validation and status', () => {
  assert.deepEqual(validateTask({ title: 'ביטוח', status: 'open', due: '', note: '' }), []);
  assert.deepEqual(validateTask({ title: '', status: 'open' }), ['title.missing']);
  assert.deepEqual(validateTask({ title: 'a', status: 'maybe' }), ['status.invalid']);
  assert.deepEqual(validateTask({ title: 'a', status: 'open', due: '2026-13-01' }), ['due.invalid']);
  assert.deepEqual(validateTask({ title: 'x'.repeat(81), status: 'open' }), ['title.tooLong']);
  assert.equal(makeTask({ title: 'a', status: 'doing', due: '' }, id).due, null);
});

test('S5-6: overdue by the destination calendar; done is never overdue', () => {
  const t = (due, status = 'open') => ({ id: 'x', title: 'a', status, due, note: '' });
  assert.equal(taskState(t('2026-12-01'), '2026-11-30'), 'upcoming');
  assert.equal(taskState(t('2026-12-01'), '2026-12-01'), 'today');
  assert.equal(taskState(t('2026-12-01'), '2026-12-02'), 'overdue');
  assert.equal(taskState(t('2026-12-01', 'doing'), '2026-12-02'), 'overdue');
  assert.equal(taskState(t('2026-12-01', 'done'), '2026-12-02'), 'done');
  assert.equal(taskState(t(null), '2026-12-02'), 'none');
});

test('S5-7: open tasks and the next task (earliest due date, then list order)', () => {
  const list = [
    { id: 'a', title: 'A', status: 'open', due: null },
    { id: 'b', title: 'B', status: 'doing', due: '2026-12-03' },
    { id: 'c', title: 'C', status: 'done', due: '2026-11-01' },
    { id: 'd', title: 'D', status: 'open', due: '2026-12-01' },
  ];
  assert.deepEqual(openTasks(list).map((x) => x.id), ['a', 'b', 'd']);
  assert.equal(nextTask(list).id, 'd');
  assert.equal(nextTask([list[0], list[2]]).id, 'a', 'no dates: the first open one');
  assert.equal(nextTask([list[2]]), null);
});

test('clean helpers skip broken entries without touching the data', () => {
  const raw = [item({}), null, { id: 'x' }, 'y'];
  assert.equal(cleanItems(raw).length, 1);
  assert.equal(cleanTasks([{ id: 't', title: 'a', status: 'open', due: null }, { id: 'u' }]).length, 1);
  assert.equal(raw.length, 4);
});

// ---------- S5-2: schema 2 -> 3 ----------
const opts = { now: () => new Date('2026-11-19T10:00:00Z'), appVersion: '0.5.0', makeId: () => 'trip-1', countryCode: 'TH', tripName: 'תאילנד' };

function v2State() {
  const s = createDefaultState(opts);
  s.schemaVersion = 2;
  const trip = s.trips['trip-1'];
  delete trip.tasks;
  trip.startDate = '2026-12-05'; trip.endDate = '2027-01-03';
  trip.destinations = [{ id: 'd1', name: 'בנגקוק', startDate: '2026-12-05', endDate: '2026-12-08', note: '' }];
  trip.budget = { currency: 'ILS', totalMinor: null, categoriesMinor: { food: 210000, emergency: 250000 }, profileId: 'realistic', estimate: true };
  trip.rates = { ILS_THB: 11 };
  trip.expenses = [{ id: 'e1', amountMinor: 30000, currency: 'THB', rate: 0.1, baseMinor: 3000, category: 'food', date: '2026-12-06', destinationId: 'd1', description: 'פאד תאי', method: 'cash', status: 'paid', note: '', paidBy: 'p1', split: { mode: 'percent', shares: { p1: 7000, p2: 3000 } } }];
  trip.people = [{ id: 'p1', name: 'משה' }, { id: 'p2', name: 'דנה' }];
  trip.repayments = [{ id: 'r1', from: 'p2', to: 'p1', minor: 900, date: '2026-12-07' }];
  trip.checklist = [{ id: 'old', name: 'פריט ישן' }];
  return s;
}

test('S5-2: real v2 data migrates to v3: nothing lost, tasks added, old checklist items get defaults', () => {
  assert.equal(SCHEMA_VERSION, 3);
  const before = v2State();
  const out = migrate(structuredClone(before), opts);
  assert.equal(out.schemaVersion, 3);
  const a = before.trips['trip-1'];
  const b = out.trips['trip-1'];
  for (const k of ['startDate', 'endDate', 'destinations', 'budget', 'rates', 'expenses', 'people', 'repayments']) assert.deepEqual(b[k], a[k], k);
  assert.deepEqual(b.tasks, []);
  assert.deepEqual(b.checklist, [{ id: 'old', name: 'פריט ישן', group: 'documents', qty: 1, note: '', done: false }]);
  assert.deepEqual(validateState(out), []);
  const fresh = createDefaultState(opts);
  assert.equal(fresh.schemaVersion, 3);
  assert.deepEqual(fresh.trips['trip-1'].tasks, []);
});

function memoryBackend() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k), map };
}
const storageOn = (backend) => createStorage({ backend, key: 'tisa:v1', legacy: { trip: 'tisa:trip', theme: 'tisa:theme' }, corruptPrefix: 'tisa:corrupt:', ...opts });

test('S5-1: an item and a task are saved through storage.js under tisa: and survive a reload; v2 data in storage upgrades', () => {
  const backend = memoryBackend();
  backend.setItem('tisa:v1', JSON.stringify(v2State()));
  const s = storageOn(backend);
  const { state, status } = s.load();
  assert.equal(status, 'migrated');
  const trip = state.trips[state.activeTripId];
  trip.checklist.push(item({ name: 'מטען', group: 'chargers' }));
  trip.tasks.push(makeTask({ title: 'ביטוח', status: 'open', due: '2026-11-30', note: '' }, id));
  assert.equal(s.save(state).ok, true);
  assert.ok([...backend.map.keys()].every((k) => k.startsWith('tisa:')));
  const again = storageOn(backend).load().state.trips['trip-1'];
  assert.equal(again.checklist.length, 2);
  assert.equal(again.tasks[0].title, 'ביטוח');
  assert.equal(again.expenses[0].split.shares.p1, 7000, 'stage 4 data intact');
});

test('S5-9: backup round trip keeps itinerary, money, checklist and tasks; a v2 backup still imports', () => {
  const { state } = storageOn(memoryBackend()).load();
  const trip = state.trips[state.activeTripId];
  trip.destinations = [{ id: 'd', name: 'x', startDate: '2026-12-05', endDate: '2026-12-08', note: '' }];
  trip.expenses = v2State().trips['trip-1'].expenses;
  trip.checklist = seedChecklist(TH, 'he', id);
  trip.tasks = seedTasks(TH, 'he', id);
  const back = parseBackup(JSON.stringify(exportBackup(state, new Date())), opts);
  assert.equal(back.ok, true);
  const t2 = back.state.trips[back.state.activeTripId];
  for (const k of ['destinations', 'expenses', 'budget', 'checklist', 'tasks']) assert.deepEqual(t2[k], trip[k], k);
  const old = parseBackup(JSON.stringify({ format: 'tisa-backup', schemaVersion: 2, exportedAt: '2026-11-19T00:00:00Z', data: v2State() }), opts);
  assert.equal(old.ok, true);
  assert.deepEqual(old.state.trips['trip-1'].tasks, []);
});
