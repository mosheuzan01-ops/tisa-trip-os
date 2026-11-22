// Stage 13 (owner, 2026-11-22; docs/BUDGET_AND_START.md): a new trip starts with the shared trip dates and the
// suggested route, the built-in checklist, and no budget of its own (category names at 0); the 20,000 template is a
// manual choice. "Free" keeps the money planned for the flight aside until flight expenses cover it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultState } from '../src/js/core/schema.js';
import { readyTrip, needsTemplateOffer, TEMPLATE_ID } from '../src/js/core/template.js';
import { summarize, toMinor, dailyAllowance } from '../src/js/core/money.js';
import { planRoute } from '../src/js/core/route-plan.js';
import { TH } from '../data/packs/th.js';

const opts = { now: () => new Date('2030-01-01T00:00:00Z'), appVersion: '0.0.0-test', countryCode: 'TH', tripName: 'תאילנד' };
const idGen = (p) => { let n = 0; return () => `${p}-${++n}`; };
const fresh = () => {
  const s = createDefaultState({ ...opts, makeId: idGen('s') });
  const trip = s.trips[s.activeTripId];
  readyTrip(trip, TH, 'he', idGen('r'));
  return trip;
};
const ILS = (n) => toMinor(n);
const tplBudget = () => {
  const tpl = TH.budgetTemplates.find((x) => x.id === TEMPLATE_ID);
  const categoriesMinor = Object.fromEntries(Object.entries(tpl.categories).map(([k, v]) => [k, ILS(v)]));
  return { currency: 'ILS', totalMinor: null, categoriesMinor: { ...categoriesMinor, emergency: ILS(tpl.emergency) } };
};
const exp = (category, amount, status) => ({ id: `${category}-${amount}-${status}`, category, baseMinor: ILS(amount), status });

test('NB-1 a new trip has no budget of its own: the template category names at 0, emergency 0, not the template, not an estimate', () => {
  const trip = fresh();
  const tpl = TH.budgetTemplates.find((x) => x.id === TEMPLATE_ID);
  assert.deepEqual(Object.keys(trip.budget.categoriesMinor).sort(), [...Object.keys(tpl.categories), 'emergency'].sort());
  assert.ok(Object.values(trip.budget.categoriesMinor).every((v) => v === 0), JSON.stringify(trip.budget.categoriesMinor));
  assert.equal(trip.budget.profileId, null);
  assert.equal(trip.budget.estimate, false);
  assert.deepEqual(trip.budget.categoryNames, tpl.categoryNames.he);
  const s = summarize(trip.budget, []);
  assert.equal(s.hasBudget, false, 'category names at 0 are "no budget yet"');
  assert.equal(s.totalMinor, 0);
});

test('NB-2 a new trip does not get the "switch to the template" card (it is for older trips); the template stays a manual choice', () => {
  const trip = fresh();
  assert.equal(trip.templateOffer, 'new');
  assert.equal(needsTemplateOffer(trip), false);
  assert.ok(TH.budgetTemplates.some((x) => x.id === TEMPLATE_ID), 'the 20,000 template is still in the pack');
});

test('NB-3 a new trip starts with the shared trip dates and the suggested route, and the built-in checklist', () => {
  const trip = fresh();
  assert.deepEqual(TH.defaultTrip, { start: '2026-12-20', end: '2027-01-20' });
  assert.equal(trip.startDate, '2026-12-20');
  assert.equal(trip.endDate, '2027-01-20');
  const plan = planRoute('2026-12-20', '2027-01-20', TH.routeTemplate, 'he', idGen('x'));
  assert.deepEqual(trip.destinations.map((d) => [d.name, d.startDate, d.endDate]), plan.stops.map((d) => [d.name, d.startDate, d.endDate]));
  assert.ok(trip.destinations.length > 0);
  assert.ok(trip.checklist.length > 0);
});

test('NB-4 a trip with dates, stops or a budget of its own is left exactly as it is', () => {
  const s = createDefaultState({ ...opts, makeId: idGen('o') });
  const trip = s.trips[s.activeTripId];
  Object.assign(trip, { startDate: '2027-02-01', endDate: '2027-02-10', destinations: [{ id: 'mine', name: 'שלי', startDate: '2027-02-01', endDate: '2027-02-10', note: '' }] });
  trip.budget = { ...trip.budget, totalMinor: ILS(9000) };
  trip.checklist = [{ id: 'c1', group: 'documents', name: 'שלי', qty: 1, note: '', done: true }];
  const before = structuredClone(trip);
  readyTrip(trip, TH, 'he', idGen('r'));
  assert.deepEqual(trip, { ...before, templateOffer: before.templateOffer });
});

test('NB-5 a trip with dates but no stops gets the route for its own dates, not the default dates', () => {
  const s = createDefaultState({ ...opts, makeId: idGen('d') });
  const trip = s.trips[s.activeTripId];
  Object.assign(trip, { startDate: '2027-02-01', endDate: '2027-02-25' });
  readyTrip(trip, TH, 'he', idGen('r'));
  assert.equal(trip.startDate, '2027-02-01');
  assert.ok(trip.destinations.length > 0, 'no route for the trip dates');
  assert.equal(trip.destinations[0].startDate >= '2027-02-01', true);
});

test('NB-6 a budget entered at home counts while the categories are all 0', () => {
  const trip = fresh();
  const s = summarize({ ...trip.budget, totalMinor: ILS(15000) }, []);
  assert.equal(s.hasBudget, true);
  assert.equal(s.totalMinor, ILS(15000));
  assert.equal(s.freeMinor, ILS(15000), 'no flight planned: nothing set aside');
});

test('FR-1 template budget, no flight expense yet: free 15,000 and free before planning 15,000 (5,000 set aside)', () => {
  const s = summarize(tplBudget(), []);
  assert.equal(s.totalMinor, ILS(20000));
  assert.equal(s.flightReserveMinor, ILS(5000));
  assert.equal(s.freeMinor, ILS(15000));
  assert.equal(s.freeBeforePlanMinor, ILS(15000));
});

test('FR-2 a 5,000 flight (planned, committed or paid) is taken once, never twice', () => {
  for (const status of ['planned', 'committed', 'paid']) {
    const s = summarize(tplBudget(), [exp('flight', 5000, status)]);
    assert.equal(s.freeMinor, ILS(15000), status);
    assert.equal(s.flightReserveMinor, 0, status);
    assert.equal(s.freeBeforePlanMinor, ILS(15000), status);
  }
});

test('FR-3 a flight above the plan takes the real cost (5,600: free 14,400); below it, the rest stays set aside (4,200: free 15,000)', () => {
  assert.equal(summarize(tplBudget(), [exp('flight', 5600, 'paid')]).freeMinor, ILS(14400));
  const low = summarize(tplBudget(), [exp('flight', 4200, 'paid')]);
  assert.equal(low.flightReserveMinor, ILS(800));
  assert.equal(low.freeMinor, ILS(15000));
});

test('FR-4 paid + planned + committed + set aside + free = the running budget, exactly', () => {
  const list = [exp('food', 300, 'paid'), exp('lodging', 1200, 'planned'), exp('flight', 2000, 'committed'), exp('attractions', 150, 'paid')];
  const s = summarize(tplBudget(), list);
  assert.equal(s.paidMinor + s.plannedMinor + s.committedMinor + s.flightReserveMinor + s.freeMinor, s.totalMinor);
  assert.equal(s.flightReserveMinor, ILS(3000));
});

test('FR-5 "free today" follows the new free: 15,000 over 32 days is 468 a day, not 625', () => {
  const s = summarize(tplBudget(), []);
  assert.deepEqual(dailyAllowance(s.freeMinor, 32), { kind: 'ok', minor: ILS(468) });
});

test('FR-6 no flight category, or only a total entered at home: nothing is set aside (as before)', () => {
  assert.equal(summarize({ currency: 'ILS', totalMinor: ILS(10000), categoriesMinor: {} }, []).freeMinor, ILS(10000));
  const noFlight = summarize({ currency: 'ILS', totalMinor: null, categoriesMinor: { food: ILS(3000), lodging: ILS(4000) } }, []);
  assert.equal(noFlight.flightReserveMinor, 0);
  assert.equal(noFlight.freeMinor, ILS(7000));
});

test('FR-7 the emergency fund stays apart: a flight paid from emergency does not cover the flight plan', () => {
  const s = summarize(tplBudget(), [exp('emergency', 5000, 'paid')]);
  assert.equal(s.flightReserveMinor, ILS(5000));
  assert.equal(s.freeMinor, ILS(15000));
});
