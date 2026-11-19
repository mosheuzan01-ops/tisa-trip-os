// Stage 4: money logic (docs/GOALS_STAGE4.md S4-1..S4-9, S4-13). Written before src/js/core/money.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMoney, toMinor, effectiveRates, rateToBase, currenciesFor, validateRates, ratesConsistent, validateExpense, makeExpense,
  categoryIds, profileToBudget, summarize, daysLeft, dailyAllowance, filterExpenses, pieSlices, EMERGENCY,
} from '../src/js/core/money.js';
import { TH } from '../data/packs/th.js';
import { SCHEMA_VERSION, migrate, validateState, createDefaultState } from '../src/js/core/schema.js';
import { createStorage } from '../src/js/core/storage.js';
import { exportBackup, parseBackup } from '../src/js/core/backup.js';

const RATES = effectiveRates({}, TH.planningRates);
let n = 0;
const id = () => `e${++n}`;
const ex = (o) => makeExpense({ amount: '100', currency: 'ILS', category: 'food', date: '2026-12-10', status: 'paid', method: 'cash', ...o }, RATES, id);

test('S4-2: money is parsed to whole minor units; 0.1 + 0.2 has no rounding error', () => {
  assert.equal(parseMoney('0.1') + parseMoney('0.2'), 30);
  assert.equal(parseMoney('12,500.50'), 1250050);
  assert.equal(parseMoney(' 7 '), 700);
  for (const bad of ['', 'abc', '-5', '0', '1.234', '1e3', '99999999999']) assert.ok(Number.isNaN(parseMoney(bad)), bad);
  let sum = 0;
  for (let i = 0; i < 1000; i += 1) sum += parseMoney('0.10');
  assert.equal(sum, 10000);
  assert.equal(toMinor(12000.5), 1200050);
  assert.equal(toMinor(0.1 + 0.2), 30);
});

test('rates: planning defaults, overrides, conversion to shekels, validation', () => {
  assert.deepEqual(RATES, { ILS_THB: 10, USD_ILS: 3.7, USD_THB: 37, planning: true });
  assert.deepEqual(effectiveRates({ ILS_THB: 12 }, TH.planningRates), { ILS_THB: 12, USD_ILS: 3.7, USD_THB: 37, planning: false });
  assert.equal(rateToBase('ILS', RATES), 1);
  assert.equal(rateToBase('THB', RATES), 0.1);
  assert.equal(rateToBase('USD', RATES), 3.7);
  assert.ok(Number.isNaN(rateToBase('EUR', RATES)));
  assert.deepEqual(currenciesFor(RATES), ['ILS', 'THB', 'USD']);
  assert.deepEqual(validateRates({ ILS_THB: '10', USD_ILS: '3.7', USD_THB: '37' }), []);
  assert.deepEqual(validateRates({ ILS_THB: '0', USD_ILS: 'x', USD_THB: '37' }), ['ILS_THB.invalid', 'USD_ILS.invalid']);
  assert.equal(ratesConsistent(RATES), true);
  assert.equal(ratesConsistent({ ILS_THB: 10, USD_ILS: 3.7, USD_THB: 40 }), false);
});

test('S4-3: an expense keeps its own rate; changing the rate later does not touch it', () => {
  const old = ex({ amount: '100', currency: 'THB' });
  assert.deepEqual([old.amountMinor, old.currency, old.rate, old.baseMinor], [10000, 'THB', 0.1, 1000]);
  const newRates = effectiveRates({ ILS_THB: 12 }, TH.planningRates);
  const later = makeExpense({ amount: '100', currency: 'THB', category: 'food', date: '2026-12-11', status: 'paid', method: 'cash' }, newRates, id);
  assert.equal(later.baseMinor, 833);
  assert.equal(old.baseMinor, 1000, 'saved expense unchanged');
  const usd = ex({ amount: '10.50', currency: 'USD' });
  assert.equal(usd.baseMinor, 3885);
  assert.ok(Number.isInteger(usd.amountMinor) && Number.isInteger(usd.baseMinor));
});

test('validateExpense: every field is checked, with message keys', () => {
  const cats = categoryIds(TH);
  const cur = currenciesFor(RATES);
  const good = { amount: '50', currency: 'THB', category: 'food', date: '2026-12-10', status: 'planned', method: 'card' };
  assert.deepEqual(validateExpense(good, cats, cur), []);
  assert.deepEqual(validateExpense({ ...good, amount: '' }, cats, cur), ['amount.missing']);
  assert.deepEqual(validateExpense({ ...good, amount: '1.999' }, cats, cur), ['amount.invalid']);
  assert.deepEqual(validateExpense({ ...good, currency: 'EUR' }, cats, cur), ['currency.invalid']);
  assert.deepEqual(validateExpense({ ...good, category: 'boats' }, cats, cur), ['category.invalid']);
  assert.deepEqual(validateExpense({ ...good, date: '' }, cats, cur), ['date.missing']);
  assert.deepEqual(validateExpense({ ...good, date: '2026-02-30' }, cats, cur), ['date.invalid']);
  assert.deepEqual(validateExpense({ ...good, status: 'maybe' }, cats, cur), ['status.invalid']);
  assert.deepEqual(validateExpense({ ...good, method: 'gold' }, cats, cur), ['method.invalid']);
  assert.deepEqual(validateExpense({ ...good, description: 'x'.repeat(81) }, cats, cur), ['description.tooLong']);
  assert.deepEqual(validateExpense({ ...good, note: 'x'.repeat(141) }, cats, cur), ['note.tooLong']);
});

test('nine categories: the pack\'s eight plus emergency', () => {
  assert.deepEqual(categoryIds(TH), [...TH.budgetCategories.map((c) => c.id), EMERGENCY]);
  assert.equal(categoryIds(TH).length, 9);
});

test('S4-7: a profile becomes an editable budget marked as an estimate; emergency 2,500 (owner, 2026-11-19)', () => {
  const b = profileToBudget(TH.budgetProfiles[1]);
  assert.equal(b.profileId, 'realistic');
  assert.equal(b.estimate, true);
  assert.equal(b.currency, 'ILS');
  assert.equal(b.categoriesMinor.flight, 390000);
  assert.equal(b.categoriesMinor[EMERGENCY], 250000);
  assert.equal(Object.entries(b.categoriesMinor).filter(([k]) => k !== EMERGENCY).reduce((s, [, v]) => s + v, 0), 1527000, 'running budget unchanged');
});

const budget = { currency: 'ILS', totalMinor: null, profileId: null, estimate: false, categoriesMinor: { food: 100000, lodging: 200000, transport: 0, [EMERGENCY]: 50000 } };

test('S4-4 + S4-6: paid / planned / committed / free add up to the budget; categories and overspend', () => {
  const list = [
    ex({ amount: '300', category: 'food', status: 'paid' }),
    ex({ amount: '800', category: 'food', status: 'planned' }),
    ex({ amount: '1500', category: 'lodging', status: 'committed' }),
    ex({ amount: '120', category: 'transport', status: 'paid' }),
    ex({ amount: '200', category: EMERGENCY, status: 'paid' }),
  ];
  const s = summarize(budget, list);
  assert.equal(s.totalMinor, 300000, 'emergency is not part of the running budget');
  assert.deepEqual([s.paidMinor, s.plannedMinor, s.committedMinor, s.freeMinor], [42000, 80000, 150000, 28000]);
  assert.equal(s.paidMinor + s.plannedMinor + s.committedMinor + s.freeMinor, s.totalMinor);
  const food = s.categories.find((c) => c.id === 'food');
  assert.deepEqual([food.planMinor, food.usedMinor, food.leftMinor, food.over], [100000, 110000, -10000, true]);
  const lodging = s.categories.find((c) => c.id === 'lodging');
  assert.deepEqual([lodging.leftMinor, lodging.over], [50000, false]);
  assert.equal(s.categories.find((c) => c.id === 'transport').over, true, 'spending in a 0 category is over');
  assert.deepEqual(s.emergency, { planMinor: 50000, usedMinor: 20000, leftMinor: 30000, over: false });
});

test('summarize with only a home total (no categories yet) and with no budget', () => {
  const s = summarize({ currency: 'ILS', totalMinor: 1200050, categoriesMinor: {} }, [ex({ amount: '50' })]);
  assert.deepEqual([s.totalMinor, s.paidMinor, s.freeMinor, s.hasCategories], [1200050, 5000, 1195050, false]);
  const usd = summarize({ currency: 'USD', totalMinor: 100000, categoriesMinor: {} }, [], RATES);
  assert.deepEqual([usd.totalMinor, usd.unconvertible], [370000, null], 'a USD home total counts in shekels');
  const eur = summarize({ currency: 'EUR', totalMinor: 100000, categoriesMinor: {} }, [], RATES);
  assert.deepEqual([eur.totalMinor, eur.unconvertible], [0, 'EUR'], 'no rate: not counted, and said so');
  const none = summarize(undefined, []);
  assert.deepEqual([none.totalMinor, none.freeMinor, none.hasBudget], [0, 0, false]);
});

test('S4-5: days left and daily allowance by the trip clock: before, middle, last day, after', () => {
  const dates = { start: '2026-12-05', end: '2027-01-03' }; // 30 days
  assert.equal(daysLeft(dates, '2026-11-19'), 30);
  assert.equal(daysLeft(dates, '2026-12-05'), 30);
  assert.equal(daysLeft(dates, '2026-12-20'), 15);
  assert.equal(daysLeft(dates, '2027-01-03'), 1);
  assert.equal(daysLeft(dates, '2027-01-04'), 0);
  assert.equal(daysLeft(null, '2027-01-04'), null);
  assert.deepEqual(dailyAllowance(300000, 30), { kind: 'ok', minor: 10000 });
  assert.deepEqual(dailyAllowance(100050, 15), { kind: 'ok', minor: 6600 }, 'rounded down to a whole shekel');
  assert.deepEqual(dailyAllowance(5000, 1), { kind: 'ok', minor: 5000 });
  assert.deepEqual(dailyAllowance(5000, 0), { kind: 'after' });
  assert.deepEqual(dailyAllowance(-100, 10), { kind: 'over', minor: -100 });
  assert.deepEqual(dailyAllowance(5000, null), { kind: 'noDates' });
});

test('S4-8: filters by day, category and stop; pie slices match the sums', () => {
  const list = [
    ex({ amount: '100', category: 'food', date: '2026-12-10', destinationId: 'bkk' }),
    ex({ amount: '300', category: 'lodging', date: '2026-12-10', destinationId: 'bkk' }),
    ex({ amount: '100', category: 'food', date: '2026-12-11', destinationId: 'cnx' }),
  ];
  assert.equal(filterExpenses(list, { date: '2026-12-10' }).length, 2);
  assert.equal(filterExpenses(list, { category: 'food' }).length, 2);
  assert.equal(filterExpenses(list, { destinationId: 'cnx' }).length, 1);
  assert.equal(filterExpenses(list, { date: '2026-12-10', category: 'food' }).length, 1);
  assert.equal(filterExpenses(list, {}).length, 3);
  const pie = pieSlices(list);
  assert.deepEqual(pie.map((p) => [p.id, p.minor]), [['lodging', 30000], ['food', 20000]]);
  assert.equal(pie[0].fraction, 0.6);
  assert.equal(pie[0].start, 0);
  assert.ok(Math.abs(pie[0].end - 0.6 * 2 * Math.PI) < 1e-9);
  assert.ok(Math.abs(pie[1].end - 2 * Math.PI) < 1e-9);
  assert.deepEqual(pieSlices([]), []);
});

// ---------- S4-13: data model v1 -> v2 ----------
const opts = { now: () => new Date('2026-11-19T10:00:00Z'), appVersion: '0.4.0', makeId: () => 'trip-1', countryCode: 'TH', tripName: 'תאילנד' };

test('S4-13: v1 data with a Stage 1 budget migrates to v2 without losing anything', () => {
  assert.equal(SCHEMA_VERSION, 2);
  const v1 = createDefaultState(opts);
  v1.schemaVersion = 1;
  const trip = v1.trips['trip-1'];
  trip.budget = { amount: 12000.5, currency: 'ILS', extra: 'keep' };
  trip.destinations = [{ id: 'd', name: 'x', startDate: '2026-12-05', endDate: '2026-12-08', note: '' }];
  trip.startDate = '2026-12-05';
  const out = migrate(structuredClone(v1), opts);
  assert.equal(out.schemaVersion, 2);
  const b = out.trips['trip-1'].budget;
  assert.deepEqual(b, { currency: 'ILS', totalMinor: 1200050, categoriesMinor: {}, profileId: null, estimate: false, extra: 'keep' });
  assert.deepEqual(out.trips['trip-1'].destinations, trip.destinations);
  assert.equal(out.trips['trip-1'].startDate, '2026-12-05');
  assert.deepEqual(validateState(out), []);
  const empty = createDefaultState(opts); empty.schemaVersion = 1;
  assert.deepEqual(migrate(empty, opts).trips['trip-1'].budget, { currency: 'ILS', totalMinor: null, categoriesMinor: {}, profileId: null, estimate: false });
});

test('S4-13: a fresh state is v2 with an empty money budget', () => {
  const s = createDefaultState(opts);
  assert.equal(s.schemaVersion, 2);
  assert.deepEqual(s.trips['trip-1'].budget, { currency: 'ILS', totalMinor: null, categoriesMinor: {}, profileId: null, estimate: false });
  assert.deepEqual(validateState(s), []);
});

function memoryBackend() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k), map };
}
const storageOn = (backend) => createStorage({ backend, key: 'tisa:v1', legacy: { trip: 'tisa:trip', theme: 'tisa:theme' }, corruptPrefix: 'tisa:corrupt:', ...opts });

test('S4-1: an expense is saved through storage.js under the tisa: key and survives a reload', () => {
  const backend = memoryBackend();
  const s = storageOn(backend);
  const { state } = s.load();
  const e = ex({ amount: '42.42', currency: 'THB', description: 'פאד תאי' });
  state.trips[state.activeTripId].expenses.push(e);
  assert.equal(s.save(state).ok, true);
  assert.ok([...backend.map.keys()].every((k) => k.startsWith('tisa:')));
  const again = storageOn(backend).load().state;
  assert.deepEqual(again.trips[again.activeTripId].expenses, [e]);
});

test('S4-9 + S4-13: backup round trip keeps budget, rates and expenses; a v1 backup still imports', () => {
  const { state } = storageOn(memoryBackend()).load();
  const trip = state.trips[state.activeTripId];
  trip.budget = profileToBudget(TH.budgetProfiles[0]);
  trip.rates = { ILS_THB: 11 };
  trip.expenses = [ex({ amount: '99.99', currency: 'USD' })];
  trip.destinations = [{ id: 'd', name: 'x', startDate: '2026-12-05', endDate: '2026-12-08', note: '' }];
  const back = parseBackup(JSON.stringify(exportBackup(state, new Date())), opts);
  assert.equal(back.ok, true);
  const t2 = back.state.trips[back.state.activeTripId];
  assert.deepEqual([t2.budget, t2.rates, t2.expenses, t2.destinations], [trip.budget, trip.rates, trip.expenses, trip.destinations]);
  const v1 = createDefaultState(opts); v1.schemaVersion = 1; v1.trips['trip-1'].budget = { amount: 500, currency: 'USD' };
  const old = parseBackup(JSON.stringify({ format: 'tisa-backup', schemaVersion: 1, exportedAt: '2026-11-01T00:00:00Z', data: v1 }), opts);
  assert.equal(old.ok, true);
  assert.equal(old.state.trips['trip-1'].budget.totalMinor, 50000);
  assert.equal(old.state.trips['trip-1'].budget.currency, 'USD');
});
