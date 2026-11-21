// Stage 9 PR 2: flight details, a round-trip ticket as one expense, seat payments kept out of the budget,
// the latisa-flights import (duplicates skipped, nothing overwritten) and flight items on the checklist.
// Written before the code (TDD). Sample data only (rule 16): made-up flight numbers on the "ZZ" code, 2030 dates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateTransfer, makeTransfer, saveTransfer, flightKey } from '../src/js/core/transfers.js';
import { FLIGHTS_FORMAT, parseFlightsFile, importFlights } from '../src/js/core/flights.js';
import { GROUPS, groupKind, cleanItems, makeItem, addFlightItems } from '../src/js/core/checklist.js';
import { effectiveRates, summarize } from '../src/js/core/money.js';
import { migrate } from '../src/js/core/schema.js';
import { exportBackup, parseBackup } from '../src/js/core/backup.js';
import { TH } from '../data/packs/th.js';
import { readJson, readText } from './helpers.js';

const RATES = effectiveRates({}, TH.planningRates);
const CUR = ['ILS', 'THB', 'USD'];
const idGen = (p = 'x') => { let n = 0; return () => `${p}${++n}`; };
const base = { kind: 'flight', from: 'עיר א', to: 'עיר ב', date: '2030-03-01', time: '', company: '', booking: '', price: '', currency: 'ILS', link: '', status: 'planned', note: '' };
const fileOf = (flights) => JSON.stringify({ format: 'latisa-flights', version: 1, flights });
const OUT = { flightNo: 'ZZ 101', from: 'עיר א', to: 'עיר ב', date: '2030-03-01', time: '08:00', status: 'paid', ticket: 'roundtrip', price: '3000', currency: 'ILS', seat: '1A', seatPrice: '90' };
const BACK = { flightNo: 'ZZ 102', from: 'עיר ב', to: 'עיר א', date: '2030-04-01', status: 'paid', ticket: 'included' };

// ---------- flight details ----------
test('F-1: flight fields are validated: flight number shape, seat length, seat price, ticket kind', () => {
  assert.deepEqual(validateTransfer({ ...base, flightNo: 'ZZ 101', seat: '1A', seatPrice: '90', ticket: 'roundtrip' }, CUR), []);
  assert.deepEqual(validateTransfer({ ...base, flightNo: 'not a flight' }, CUR), ['flightNo.invalid']);
  assert.deepEqual(validateTransfer({ ...base, seat: 'x'.repeat(9) }, CUR), ['seat.tooLong']);
  assert.deepEqual(validateTransfer({ ...base, seatPrice: '1.999' }, CUR), ['seatPrice.invalid']);
  assert.deepEqual(validateTransfer({ ...base, seatPrice: '90', currency: 'EUR' }, CUR), ['currency.invalid']);
  assert.deepEqual(validateTransfer({ ...base, ticket: 'maybe' }, CUR), ['ticket.invalid']);
  assert.deepEqual(validateTransfer({ ...base, ticket: 'included', price: '100' }, CUR), ['price.included'], 'the return leg of a round trip has no price of its own');
  assert.deepEqual(validateTransfer(base, CUR), [], 'old callers without the new fields still pass');
});

test('F-2: makeTransfer keeps the flight details; a non-flight carries none of them', () => {
  const f = makeTransfer({ ...base, flightNo: ' zz  101 ', seat: ' 1a ', seatPrice: '90', ticket: 'roundtrip' }, () => 't1');
  assert.deepEqual([f.flightNo, f.seat, f.seatPriceMinor, f.ticket], ['ZZ 101', '1A', 9000, 'roundtrip']);
  const bus = makeTransfer({ ...base, kind: 'bus', flightNo: 'ZZ 101', seat: '1A', seatPrice: '90', ticket: 'roundtrip' }, () => 't2');
  assert.deepEqual([bus.flightNo, bus.seat, bus.seatPriceMinor, bus.ticket], ['', '', null, 'oneway']);
  const old = { id: 'o1', kind: 'flight', from: 'א', to: 'ב', date: '2030-03-01', time: '', company: '', booking: '', priceMinor: null, currency: 'ILS', link: '', status: 'planned', note: '', expenseId: null };
  const edited = makeTransfer({ ...base, note: 'n' }, () => 'never', old);
  assert.deepEqual([edited.id, edited.flightNo, edited.ticket, edited.seatPriceMinor], ['o1', '', 'oneway', null], 'an old record gets defaults, same id');
});

test('F-3: a round-trip ticket is ONE expense in the flight category; the return leg adds nothing', () => {
  const id = idGen('r');
  let trip = { transfers: [], expenses: [] };
  trip = saveTransfer(trip, { ...base, flightNo: 'ZZ 101', price: '3000', status: 'paid', ticket: 'roundtrip' }, null, RATES, id);
  trip = saveTransfer(trip, { ...base, from: 'עיר ב', to: 'עיר א', date: '2030-04-01', flightNo: 'ZZ 102', status: 'paid', ticket: 'included' }, null, RATES, id);
  assert.equal(trip.transfers.length, 2);
  assert.equal(trip.expenses.length, 1);
  assert.deepEqual([trip.expenses[0].category, trip.expenses[0].amountMinor, trip.expenses[0].status], ['flight', 300000, 'paid']);
  assert.equal(trip.transfers[1].expenseId, null);
  assert.equal(summarize({ categoriesMinor: { flight: 500000 } }, trip.expenses).paidMinor, 300000);
});

test('F-4: seat payments stay in the flight details and never become a budget expense', () => {
  const id = idGen('s');
  let trip = { transfers: [], expenses: [] };
  trip = saveTransfer(trip, { ...base, flightNo: 'ZZ 101', price: '3000', status: 'paid', seatPrice: '90', seat: '1A' }, null, RATES, id);
  assert.equal(trip.expenses.length, 1);
  assert.equal(trip.expenses[0].amountMinor, 300000, 'ticket only');
  assert.equal(trip.transfers[0].seatPriceMinor, 9000);
  const noTicket = saveTransfer({ transfers: [], expenses: [] }, { ...base, flightNo: 'ZZ 103', seatPrice: '90' }, null, RATES, id);
  assert.equal(noTicket.expenses.length, 0, 'a seat price alone adds no expense');
});

test('F-5: the duplicate key is flight number + date, ignoring case and spaces', () => {
  assert.equal(flightKey({ kind: 'flight', flightNo: 'zz101', date: '2030-03-01' }), flightKey({ kind: 'flight', flightNo: 'ZZ 101', date: '2030-03-01' }));
  assert.notEqual(flightKey({ kind: 'flight', flightNo: 'ZZ 101', date: '2030-03-02' }), flightKey({ kind: 'flight', flightNo: 'ZZ 101', date: '2030-03-01' }));
  assert.equal(flightKey({ kind: 'flight', flightNo: '', date: '2030-03-01' }), null, 'no number: no key');
  assert.equal(flightKey({ kind: 'bus', flightNo: 'ZZ 101', date: '2030-03-01' }), null);
});

// ---------- latisa-flights import ----------
test('I-1: the file must be latisa-flights version 1 with a flights list', () => {
  assert.equal(FLIGHTS_FORMAT, 'latisa-flights');
  assert.deepEqual(parseFlightsFile(''), { ok: false, error: 'empty' });
  assert.deepEqual(parseFlightsFile('{oops'), { ok: false, error: 'notJson' });
  assert.deepEqual(parseFlightsFile(JSON.stringify({ format: 'tisa-backup', version: 1, flights: [] })), { ok: false, error: 'format' });
  assert.deepEqual(parseFlightsFile(JSON.stringify({ format: 'latisa-flights', version: 2, flights: [] })), { ok: false, error: 'future' });
  assert.deepEqual(parseFlightsFile(JSON.stringify({ format: 'latisa-flights', version: 1, flights: {} })), { ok: false, error: 'structure' });
  const ok = parseFlightsFile(fileOf([OUT, BACK]));
  assert.equal(ok.ok, true);
  assert.equal(ok.flights.length, 2);
});

const opts = () => ({ rates: RATES, currencies: CUR, makeId: idGen('i') });

test('I-2: new flights are added; a priced round trip makes one flight expense; seats stay out', () => {
  const trip = { transfers: [], expenses: [], checklist: [] };
  const r = importFlights(trip, [OUT, BACK], opts());
  assert.equal(r.added, 2);
  assert.deepEqual([r.duplicates.length, r.invalid.length], [0, 0]);
  assert.equal(r.trip.transfers.length, 2);
  assert.equal(r.trip.expenses.length, 1);
  assert.deepEqual([r.trip.expenses[0].category, r.trip.expenses[0].amountMinor], ['flight', 300000]);
  assert.equal(r.trip.transfers.find((x) => x.flightNo === 'ZZ 101').seatPriceMinor, 9000);
  assert.ok(r.trip.transfers.every((x) => x.kind === 'flight'));
  assert.deepEqual(trip, { transfers: [], expenses: [], checklist: [] }, 'the input trip is not mutated');
});

test('I-3: a duplicate (same number and date) is skipped; the existing record and its expense are untouched', () => {
  const first = importFlights({ transfers: [], expenses: [] }, [OUT], opts()).trip;
  const before = structuredClone(first);
  const r = importFlights(first, [{ ...OUT, flightNo: 'zz101', price: '9999', status: 'planned', note: 'different' }], opts());
  assert.equal(r.added, 0);
  assert.deepEqual(r.duplicates.map((d) => d.flightNo), ['zz101']);
  assert.deepEqual(r.trip.transfers, before.transfers);
  assert.deepEqual(r.trip.expenses, before.expenses);
});

test('I-4: importing the same file twice changes nothing the second time', () => {
  const once = importFlights({ transfers: [], expenses: [] }, [OUT, BACK], opts()).trip;
  const twice = importFlights(once, [OUT, BACK], opts());
  assert.equal(twice.added, 0);
  assert.equal(twice.duplicates.length, 2);
  assert.deepEqual(twice.trip, once);
});

test('I-5: a flight listed twice in one file is added once', () => {
  const r = importFlights({ transfers: [], expenses: [] }, [OUT, { ...OUT, flightNo: 'ZZ101' }], opts());
  assert.equal(r.added, 1);
  assert.equal(r.duplicates.length, 1);
  assert.equal(r.trip.expenses.length, 1);
});

test('I-6: bad entries are skipped with a reason; good ones still come in; every other field of the trip stays', () => {
  const trip = {
    name: 'דוגמה', transfers: [{ id: 'bus1', kind: 'bus', from: 'א', to: 'ב', date: '2030-03-05', time: '', company: '', booking: '', priceMinor: null, currency: 'ILS', link: '', status: 'planned', note: '', expenseId: null }],
    expenses: [{ id: 'e0', amountMinor: 1000 }], checklist: [{ id: 'c1', group: 'documents', name: 'דרכון', qty: 1, note: '', done: true }], photos: [{ id: 'p1' }],
  };
  const r = importFlights(trip, [{ ...OUT, flightNo: '' }, { ...OUT, date: '2030-02-30', flightNo: 'ZZ 104' }, { ...BACK, price: '10' }, 'junk', { ...OUT, flightNo: 'ZZ 105', date: '2030-03-02' }], opts());
  assert.equal(r.added, 1);
  assert.deepEqual(r.invalid.map((x) => x.index), [0, 1, 2, 3]);
  assert.ok(r.invalid[0].errors.includes('flightNo.missing'));
  assert.ok(r.invalid[2].errors.includes('price.included'));
  assert.equal(r.trip.transfers.length, 2);
  assert.deepEqual(r.trip.transfers[0], trip.transfers[0]);
  assert.deepEqual(r.trip.expenses[0], trip.expenses[0]);
  assert.deepEqual([r.trip.name, r.trip.checklist, r.trip.photos], [trip.name, trip.checklist, trip.photos]);
});

test('I-7: a hand-entered flight with the same number and date also counts as a duplicate', () => {
  const trip = saveTransfer({ transfers: [], expenses: [] }, { ...base, flightNo: 'ZZ 101', price: '2500', status: 'booked' }, null, RATES, idGen('h'));
  const r = importFlights(trip, [OUT, { ...OUT, flightNo: 'ZZ 109' }], opts());
  assert.equal(r.added, 1, 'only the new number comes in');
  assert.deepEqual(r.trip.transfers[0], trip.transfers[0]);
  assert.deepEqual(r.trip.expenses[0], trip.expenses[0]);
  assert.deepEqual(r.trip.transfers.map((x) => x.flightNo), ['ZZ 101', 'ZZ 109']);
});

test('I-8: flight details survive a backup and restore', () => {
  const state = migrate(JSON.parse(fs.readFileSync(new URL('./fixtures/v5-stage7.json', import.meta.url), 'utf8')));
  const tr = state.trips[state.activeTripId];
  const r = importFlights(tr, [OUT, BACK], opts());
  assert.equal(r.added, 2);
  state.trips[state.activeTripId] = r.trip;
  const back = parseBackup(JSON.stringify(exportBackup(state, new Date('2030-01-01T00:00:00Z'))));
  assert.equal(back.ok, true);
  assert.deepEqual(back.state.trips[back.state.activeTripId].transfers, r.trip.transfers);
  assert.deepEqual(back.state.trips[back.state.activeTripId].expenses, r.trip.expenses);
});

// ---------- checklist ----------
test('C-1: new groups: offline downloads (prep), flight food and flight comfort (pack); old groups stay', () => {
  for (const g of ['documents', 'money', 'comms', 'health', 'clothing', 'chargers', 'offline', 'flightFood', 'flightComfort']) assert.ok(GROUPS.includes(g), g);
  assert.deepEqual([groupKind('offline'), groupKind('flightFood'), groupKind('flightComfort')], ['prep', 'pack', 'pack']);
  const he = readJson('locales/he.json');
  const en = readJson('locales/en.json');
  for (const g of GROUPS) { assert.ok(he[`list.group.${g}`], `he ${g}`); assert.ok(en[`list.group.${g}`], `en ${g}`); }
});

test('C-2: the flight items cover the three new groups, in Hebrew and English, with no numbers or dates', () => {
  const seed = TH.flightChecklistSeed;
  assert.ok(Array.isArray(seed) && seed.length >= 9);
  for (const g of ['offline', 'flightFood', 'flightComfort']) assert.ok(seed.some((x) => x.group === g), g);
  for (const x of seed) {
    assert.ok(GROUPS.includes(x.group) && x.name.he && x.name.en, JSON.stringify(x));
    assert.doesNotMatch(`${x.name.he} ${x.name.en}`, /\d/, 'no made-up numbers');
  }
  const starter = new Set(TH.checklistSeed.map((x) => x.name.he));
  assert.ok(seed.every((x) => !starter.has(x.name.he)), 'no item repeats the starter list');
});

test('C-3: adding flight items twice adds them once; own items, ticks and notes stay', () => {
  assert.ok(Array.isArray(TH.flightChecklistSeed), 'the pack has flight items');
  const own = [makeItem({ group: 'documents', name: 'דרכון', qty: '', note: 'בתיק' }, () => 'own1')];
  own[0].done = true;
  const one = addFlightItems(own, TH, 'he', idGen('f'));
  assert.equal(one.added, TH.flightChecklistSeed.length);
  assert.deepEqual(one.items[0], own[0]);
  const two = addFlightItems(one.items, TH, 'he', idGen('g'));
  assert.equal(two.added, 0);
  assert.deepEqual(two.items, one.items);
  assert.equal(cleanItems(two.items).length, two.items.length);
});

test('C-4: an item the user already has under the same name (any case or spacing) is not added again', () => {
  assert.ok(Array.isArray(TH.flightChecklistSeed), 'the pack has flight items');
  const name = TH.flightChecklistSeed[0].name.he;
  const own = [makeItem({ group: 'clothing', name: `  ${name}  `, qty: '', note: '' }, () => 'own1')];
  const r = addFlightItems(own, TH, 'he', idGen('f'));
  assert.equal(r.added, TH.flightChecklistSeed.length - 1);
  assert.equal(r.items.filter((x) => x.name.trim() === name).length, 1);
});

// ---------- release ----------
test('R-1: the new core file is cached for offline use, and the version moved past 0.8.0 everywhere', () => {
  assert.ok(readText('sw.js').includes("'./src/js/core/flights.js'"));
  const v = readJson('config/app.config.json').appVersion;
  assert.notEqual(v, '0.8.0');
  assert.equal(readJson('package.json').version, v);
  assert.match(readText('sw.js'), new RegExp(`const VERSION = '${v.replace(/\./g, '\\.')}';`));
});

test('R-2: the flights screen has a working import entry and the lists screen a flight-items button', () => {
  const html = readText('index.html');
  assert.match(html, /data-action="flights-import"/);
  assert.match(html, /id="flights-import-file"[^>]*accept="application\/json,\.json"/);
  assert.match(html, /id="dlg-flights-import"/);
  // Pre-stage-10 PR A (owner decision): the flight items are part of the built-in list; one button adds what is missing.
  assert.match(html, /data-action="list-builtin"/);
});
