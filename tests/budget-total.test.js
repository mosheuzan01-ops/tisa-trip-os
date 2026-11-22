// 1.0.1 (owner, 2026-11-22): the budget is one total ("how much money do you have for the trip"). The categories are
// an optional plan under "details": a suggested split (the approved template's ratios), saved only on an explicit
// approval; editing a category never changes the total. The emergency fund is part of the total, set aside like the
// flight. Existing data (no budget.anchor) keeps the 1.0.0 numbers exactly. docs/BUDGET_AND_START.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  summarize, dailyBase, effectiveRates, toMinor, parseWholeShekels, setTotal, suggestSplit, applySuggestion,
  withProfile, fxApprox, ANCHOR_TOTAL,
} from '../src/js/core/money.js';
import { applyTemplate, TEMPLATE_ID } from '../src/js/core/template.js';
import { createDefaultState } from '../src/js/core/schema.js';
import { TH } from '../data/packs/th.js';

const ILS = (n) => toMinor(n);
const exp = (category, amount, status = 'paid') => ({ id: `${category}-${amount}-${status}`, category, baseMinor: ILS(amount), status });
const tpl = TH.budgetTemplates.find((x) => x.id === TEMPLATE_ID);
const total = (n, cats = {}) => setTotal({ currency: 'ILS', totalMinor: null, categoriesMinor: cats }, ILS(n));
const legacyTemplate = () => ({
  currency: 'ILS', totalMinor: null, profileId: TEMPLATE_ID, estimate: true,
  categoriesMinor: { ...Object.fromEntries(Object.entries(tpl.categories).map(([k, v]) => [k, ILS(v)])), emergency: ILS(tpl.emergency) },
});
const pick = (s) => ({ totalMinor: s.totalMinor, paidMinor: s.paidMinor, plannedMinor: s.plannedMinor, committedMinor: s.committedMinor, freeMinor: s.freeMinor, freeBeforePlanMinor: s.freeBeforePlanMinor, flightReserveMinor: s.flightReserveMinor, hasBudget: s.hasBudget, hasCategories: s.hasCategories, emergency: s.emergency, categories: s.categories });

test('BT-1 one total, nothing else: free = total - expenses; no flight or emergency set aside', () => {
  const b = total(15000);
  assert.equal(b.anchor, ANCHOR_TOTAL);
  const s = summarize(b, [exp('food', 120), exp('lodging', 900, 'planned')]);
  assert.equal(s.hasBudget, true);
  assert.equal(s.totalMinor, ILS(15000));
  assert.equal(s.freeMinor, ILS(15000 - 120 - 900));
  assert.equal(s.flightReserveMinor, 0);
  assert.equal(s.emergencyHeldMinor, 0);
  assert.equal(s.unallocatedMinor, ILS(15000));
});

test('BT-2 setTotal changes only the total (and marks it as the anchor): categories, names and emergency stay', () => {
  const before = { currency: 'ILS', totalMinor: null, categoriesMinor: { flight: ILS(4000), food: ILS(2000), emergency: ILS(1000) }, categoryNames: { food: 'אוכל שלי' }, hidden: ['green'] };
  const after = setTotal(before, ILS(15000));
  assert.deepEqual({ ...after, totalMinor: undefined, anchor: undefined }, { ...before, totalMinor: undefined, anchor: undefined });
  assert.equal(after.totalMinor, ILS(15000));
  assert.equal(after.currency, 'ILS');
});

test('BT-3 the total is the anchor: categories are a plan; "left to split" or "over" is shown, the total never moves', () => {
  const s = summarize(total(15000, { flight: ILS(4000), lodging: ILS(5000) }), []);
  assert.equal(s.totalMinor, ILS(15000));
  assert.equal(s.allocatedMinor, ILS(9000));
  assert.equal(s.unallocatedMinor, ILS(6000));
  const over = summarize(total(15000, { flight: ILS(10000), lodging: ILS(8000) }), []);
  assert.equal(over.totalMinor, ILS(15000));
  assert.equal(over.unallocatedMinor, ILS(-3000));
});

test('BT-4 the emergency fund is part of the total: set aside in free, counted once (its expenses use it up first)', () => {
  const b = total(15000, { emergency: ILS(2000) });
  const s0 = summarize(b, []);
  assert.equal(s0.allocatedMinor, ILS(2000));
  assert.equal(s0.emergencyHeldMinor, ILS(2000));
  assert.equal(s0.freeMinor, ILS(13000));
  const s1 = summarize(b, [exp('emergency', 500)]);
  assert.equal(s1.freeMinor, ILS(13000), 'an emergency expense inside the fund does not lower free twice');
  assert.equal(s1.emergency.usedMinor, ILS(500));
  const s2 = summarize(b, [exp('emergency', 2600)]);
  assert.equal(s2.freeMinor, ILS(12400), 'beyond the fund, the rest comes out of free');
  assert.equal(s2.paidMinor + s2.plannedMinor + s2.committedMinor + s2.flightReserveMinor + s2.emergencyHeldMinor + s2.freeMinor, s2.totalMinor);
});

test('BT-5 flight reserve as in 1.0.0, only from a saved flight category; with a total only there is none', () => {
  const b = total(20000, { flight: ILS(5000) });
  assert.equal(summarize(b, []).flightReserveMinor, ILS(5000));
  assert.equal(summarize(b, []).freeMinor, ILS(15000));
  assert.equal(summarize(b, [exp('flight', 5000, 'paid')]).freeMinor, ILS(15000), 'a paid flight is taken once');
  assert.equal(summarize(total(20000), [exp('flight', 5000, 'paid')]).freeMinor, ILS(15000), 'no flight category: the flight is just an expense');
});

test('BT-6 existing data (no anchor) gives exactly the 1.0.0 results', () => {
  const cases = [
    [legacyTemplate(), []],
    [legacyTemplate(), [exp('flight', 5000, 'planned'), exp('food', 300), exp('emergency', 400)]],
    [{ currency: 'ILS', totalMinor: ILS(12000), categoriesMinor: {} }, [exp('food', 50)]],
    [{ currency: 'USD', totalMinor: ILS(1000), categoriesMinor: {} }, []],
    [{ currency: 'ILS', totalMinor: null, categoriesMinor: { food: 0, flight: 0, emergency: 0 } }, []],
  ];
  const rates = effectiveRates({}, TH.planningRates);
  // The 1.0.0 numbers, written out (docs/BUDGET_AND_START.md): template 20,000 with 5,000 for the flight and 2,500
  // emergency apart; home totals as entered (USD converted); category names at 0 are no budget.
  const want = [
    { totalMinor: ILS(20000), freeMinor: ILS(15000), freeBeforePlanMinor: ILS(15000), flightReserveMinor: ILS(5000), hasBudget: true },
    { totalMinor: ILS(20000), freeMinor: ILS(14700), freeBeforePlanMinor: ILS(14700), flightReserveMinor: 0, hasBudget: true },
    { totalMinor: ILS(12000), freeMinor: ILS(11950), freeBeforePlanMinor: ILS(11950), flightReserveMinor: 0, hasBudget: true },
    { totalMinor: ILS(3700), freeMinor: ILS(3700), freeBeforePlanMinor: ILS(3700), flightReserveMinor: 0, hasBudget: true },
    { totalMinor: 0, freeMinor: 0, freeBeforePlanMinor: 0, flightReserveMinor: 0, hasBudget: false },
  ];
  cases.forEach(([b, e], i) => {
    const s = pick(summarize(b, e, rates));
    for (const [k, v] of Object.entries(want[i])) assert.equal(s[k], v, `case ${i}: ${k}`);
    assert.equal(summarize(b, e, rates).emergencyHeldMinor, 0, `case ${i}: emergency stays apart in old data`);
  });
  assert.equal(summarize(legacyTemplate(), []).emergency.planMinor, ILS(2500));
});

test('BT-7 the suggested split: the approved template ratios, only existing categories, whole shekels, exactly the total', () => {
  const sug = suggestSplit(ILS(15000), TH);
  const ids = TH.budgetCategories.map((c) => c.id);
  assert.deepEqual(Object.keys(sug).sort(), [...ids].sort(), 'every existing category, nothing invented, no emergency');
  assert.deepEqual({ flight: sug.flight, lodging: sug.lodging, food: sug.food, attractions: sug.attractions, transport: sug.transport, ins: sug['insurance-sim-gear'], misc: sug.misc, green: sug.green },
    { flight: ILS(3750), lodging: ILS(3750), food: ILS(2625), attractions: ILS(1725), transport: ILS(1650), ins: ILS(750), misc: ILS(750), green: 0 });
  for (const n of [15000, 9999, 1, 20000, 123457]) {
    const s = suggestSplit(ILS(n), TH);
    assert.equal(Object.values(s).reduce((a, v) => a + v, 0), ILS(n), `${n} splits exactly`);
    assert.ok(Object.values(s).every((v) => Number.isInteger(v) && v >= 0 && v % 100 === 0), `${n} whole shekels`);
  }
});

test('BT-8 a suggestion changes nothing until it is approved; approving keeps the total, the anchor, emergency and names', () => {
  const b = total(15000, { emergency: ILS(1000) });
  b.categoryNames = { food: 'אוכל שלי' };
  const frozen = JSON.stringify(b);
  const sug = suggestSplit(b.totalMinor, TH);
  assert.equal(JSON.stringify(b), frozen, 'suggestSplit does not touch the budget');
  assert.equal(summarize(b, []).freeMinor, ILS(14000), 'not approved: only the emergency fund is set aside');
  const a = applySuggestion(b, sug);
  assert.equal(a.totalMinor, ILS(15000));
  assert.equal(a.anchor, ANCHOR_TOTAL);
  assert.equal(a.categoriesMinor.emergency, ILS(1000));
  assert.equal(a.categoriesMinor.flight, ILS(3750));
  assert.deepEqual(a.categoryNames, { food: 'אוכל שלי' });
  assert.equal(summarize(a, []).unallocatedMinor, ILS(-1000), 'the suggestion fills the total, so the fund shows as over');
});

test('BT-9 loading the template on an anchored budget changes only the categories; the total stays', () => {
  const b = total(15000);
  const next = withProfile(b, tpl, 'he');
  assert.equal(next.totalMinor, ILS(15000));
  assert.equal(next.anchor, ANCHOR_TOTAL);
  assert.equal(next.categoriesMinor.flight, ILS(5000));
  const old = withProfile({ currency: 'ILS', totalMinor: null, categoriesMinor: { emergency: ILS(700) } }, tpl, 'he');
  assert.equal(old.totalMinor, null, 'old data: as in 1.0.0');
  assert.equal(old.categoriesMinor.emergency, ILS(700), 'the user\'s own emergency amount is never wiped');
  const st = createDefaultState({ now: () => new Date('2030-01-01T00:00:00Z'), appVersion: '0.0.0-test', makeId: () => 'x1', countryCode: 'TH', tripName: 'תאילנד' });
  const trip = st.trips[st.activeTripId];
  trip.budget = total(15000);
  applyTemplate(trip, TH, 'he', () => 'r1', '2030-01-01T00:00:00.000Z');
  assert.equal(trip.budget.totalMinor, ILS(15000));
  assert.equal(trip.budget.anchor, ANCHOR_TOTAL);
});

test('BT-10 the total is typed as whole shekels: "15,000" and "15000" are fine; decimals, 0 and text are refused', () => {
  assert.equal(parseWholeShekels('15,000'), ILS(15000));
  assert.equal(parseWholeShekels(' 15000 '), ILS(15000));
  assert.equal(parseWholeShekels('1,234,567'), ILS(1234567));
  for (const bad of ['15000.5', '0', '-5', 'abc', '', '15,00', '1.000']) assert.ok(Number.isNaN(parseWholeShekels(bad)), bad);
});

test('BT-11 the total in dollars and baht, by the trip rates, as whole units', () => {
  const rates = effectiveRates({}, TH.planningRates);
  assert.deepEqual(fxApprox(ILS(15000), rates), { USD: 4054, THB: 150000 });
});

test('BT-12 daily base on an anchored budget: the total less the flight and the emergency fund, over the dates', () => {
  const dates = { start: '2030-12-20', end: '2031-01-20' };
  assert.equal(dailyBase(total(20000, { flight: ILS(5000), emergency: ILS(2000) }), dates), Math.floor(ILS(13000) / 32));
  assert.equal(dailyBase(total(16000), dates), ILS(500));
  assert.equal(dailyBase(legacyTemplate(), dates), Math.floor(ILS(15000) / 32), 'old data: as in 1.0.0');
});

test('BT-13 1.0.1 in every place the version is set (docs/FREEZE.md: a fix reaches phones only with a new version)', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  assert.equal(JSON.parse(read('config/app.config.json')).appVersion, '1.0.1');
  assert.equal(JSON.parse(read('package.json')).version, '1.0.1');
  assert.equal(/const VERSION = '([^']+)'/.exec(read('sw.js'))[1], '1.0.1');
});
