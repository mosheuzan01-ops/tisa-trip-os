// Pre-stage-10, PR B: a new trip comes with the default budget (plan20k) and, once its dates are entered, the
// suggested route. An existing route is rebuilt from the template only after a preview and a yes, and the old one
// goes to the archive. Owner decision 2026-11-21 (docs/GOALS_STAGE10.md "PR B"). Sample dates only (2030, rule 16).
// Written before the code (TDD).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readyTrip, fillRoute, rebuildRoute, stopNameFor, TEMPLATE_ID } from '../src/js/core/template.js';
import { createDefaultState } from '../src/js/core/schema.js';
import { planRoute, tripCounts } from '../src/js/core/route-plan.js';
import { summarize, dailyBase, effectiveRates } from '../src/js/core/money.js';
import { saveTransfer } from '../src/js/core/transfers.js';
import { addDays } from '../src/js/core/itinerary.js';
import { daysBetween } from '../src/js/core/trip.js';
import { TH } from '../data/packs/th.js';
import { readText } from './helpers.js';

const idGen = (p = 'x') => { let n = 0; return () => `${p}${++n}`; };
const opts = { now: () => new Date('2030-01-01T00:00:00Z'), appVersion: '0.0.0-test', makeId: idGen('s'), countryCode: 'TH', tripName: 'תאילנד' };
const START = '2030-12-20';
const END = '2031-01-20';
const fresh = () => { const st = createDefaultState(opts); return st.trips[st.activeTripId]; };
const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0);

test('B-1: a new trip gets the plan20k budget (20,000 with the flight, emergency 2,500 apart) and the full checklist', () => {
  const trip = fresh();
  readyTrip(trip, TH, 'he', idGen('r'));
  assert.equal(trip.budget.profileId, TEMPLATE_ID);
  const { emergency, ...rest } = trip.budget.categoriesMinor;
  assert.equal(sum(rest), 2_000_000);
  assert.equal(rest.flight, 500_000);
  assert.equal(sum(rest) - rest.flight, 1_500_000);
  assert.equal(emergency, 250_000);
  assert.equal(trip.templateOffer, 'applied', 'no "switch to the template" card for a trip that is already on it');
  assert.equal(trip.checklist.length, TH.checklistBuiltin.length);
  assert.ok(trip.checklist.every((x) => !x.done));
  assert.deepEqual(trip.destinations, [], 'no dates yet, so no route');
  assert.equal(trip.startDate, null);
});

test('B-2: a trip with its own budget keeps it; readyTrip twice changes nothing', () => {
  const trip = fresh();
  trip.budget = { ...trip.budget, totalMinor: 1_234_500 };
  const before = structuredClone(trip.budget);
  readyTrip(trip, TH, 'he', idGen('r'));
  assert.deepEqual(trip.budget, before);
  const t2 = fresh();
  readyTrip(t2, TH, 'he', idGen('a'));
  const snap = JSON.stringify(t2);
  readyTrip(t2, TH, 'he', idGen('b'));
  assert.equal(JSON.stringify(t2), snap);
});

test('B-3: dates on a trip with no stops build the suggested route; stops that exist are never replaced', () => {
  const trip = fresh();
  trip.startDate = START;
  trip.endDate = END;
  const r = fillRoute(trip, TH, 'he', idGen('f'));
  assert.ok(r.added > 0);
  assert.equal(trip.destinations.length, r.added);
  assert.ok(trip.destinations.every((x) => x.suggested === true));
  assert.equal(trip.destinations[0].startDate, addDays(START, 1), 'first night on the plane');
  assert.equal(trip.destinations.at(-1).endDate, END);
  const snap = JSON.stringify(trip.destinations);
  assert.equal(fillRoute(trip, TH, 'he', idGen('g')).added, 0);
  assert.equal(JSON.stringify(trip.destinations), snap);
  const noDates = fresh();
  assert.equal(fillRoute(noDates, TH, 'he', idGen('h')).added, 0);
  assert.deepEqual(noDates.destinations, []);
});

test('B-4: rebuilding an existing route: the old one goes to the archive exactly; nothing else changes', () => {
  const trip = fresh();
  trip.startDate = '2030-03-01';
  trip.endDate = '2030-03-10';
  trip.destinations = [{ id: 'own1', name: 'עיר א', startDate: '2030-03-02', endDate: '2030-03-03', note: 'שלי' }, { id: 'own2', name: 'עיר ב', startDate: '2030-03-03', endDate: '2030-03-04', note: '' }];
  trip.expenses = [{ id: 'e1', amount: 100, baseMinor: 10_000, category: 'food', status: 'paid', destinationId: 'own1' }];
  trip.checklist = [{ id: 'c1', group: 'documents', name: 'דרכון', qty: 1, note: '', done: true }];
  const old = structuredClone(trip.destinations);
  const keep = structuredClone({ expenses: trip.expenses, checklist: trip.checklist, budget: trip.budget, transfers: trip.transfers });
  const r = rebuildRoute(trip, { start: START, end: END }, TH, 'he', idGen('n'), '2030-01-02T00:00:00.000Z');
  assert.deepEqual(r.warnings, []);
  assert.equal(trip.startDate, START);
  assert.equal(trip.endDate, END);
  assert.deepEqual(trip.archive.routes.at(-1), { at: '2030-01-02T00:00:00.000Z', destinations: old });
  assert.deepEqual(trip.destinations.map((x) => x.name), planRoute(START, END, TH.routeTemplate, 'he', idGen('p')).stops.map((x) => x.name));
  assert.deepEqual({ expenses: trip.expenses, checklist: trip.checklist, budget: trip.budget, transfers: trip.transfers }, keep);
  assert.deepEqual(stopNameFor(trip, 'own1'), { name: 'עיר א', archived: true }, 'an expense on an old stop still shows its name');
});

test('B-5: a rebuild that cannot make a route changes nothing', () => {
  const trip = fresh();
  trip.startDate = '2030-03-01';
  trip.endDate = '2030-03-10';
  trip.destinations = [{ id: 'own1', name: 'עיר א', startDate: '2030-03-02', endDate: '2030-03-04', note: '' }];
  const snap = JSON.stringify(trip);
  const r = rebuildRoute(trip, { start: '2030-03-01', end: '2030-03-04' }, TH, 'he', idGen('n'), '2030-01-02T00:00:00.000Z');
  assert.ok(r.warnings.includes('route.tooShort'));
  assert.equal(JSON.stringify(trip), snap);
});

test('B-6: route, calendar and budget agree: every night after the flight has one stop; the flight counts once', () => {
  const trip = fresh();
  readyTrip(trip, TH, 'he', idGen('r'));
  trip.startDate = START;
  trip.endDate = END;
  fillRoute(trip, TH, 'he', idGen('f'));
  const nights = daysBetween(START, END);
  for (let i = 1; i < nights; i += 1) {
    const night = addDays(START, i);
    assert.equal(trip.destinations.filter((x) => x.startDate <= night && night < x.endDate).length, 1, night);
  }
  assert.equal(trip.destinations.filter((x) => x.startDate <= START && START < x.endDate).length, 0, 'first night on the plane');
  assert.deepEqual(tripCounts(START, END, trip.destinations), { dates: nights + 1, nights, lodgingNights: nights - 1 });
  assert.equal(dailyBase(trip.budget, { start: START, end: END }), Math.floor(1_500_000 / (nights + 1)), 'daily base leaves the flight out');
  // A round trip: the price sits on the outbound flight only; the return is "included".
  const rates = effectiveRates({}, TH.planningRates);
  let t = saveTransfer(trip, { kind: 'flight', from: 'עיר א', to: 'עיר ב', date: START, time: '', company: '', booking: '', price: '4000', currency: 'ILS', link: '', status: 'paid', note: '', ticket: 'roundtrip', flightNo: 'ZZ 1' }, null, rates, idGen('t'));
  t = saveTransfer(t, { kind: 'flight', from: 'עיר ב', to: 'עיר א', date: END, time: '', company: '', booking: '', price: '', currency: 'ILS', link: '', status: 'paid', note: '', ticket: 'included', flightNo: 'ZZ 2' }, null, rates, idGen('u'));
  const flight = summarize(t.budget, t.expenses, rates).categories.find((c) => c.id === 'flight');
  assert.equal(flight.usedMinor, 400_000);
  assert.equal(flight.planMinor, 500_000);
});

test('B-7: wiring: new trip and reset use readyTrip; every place that saves dates fills an empty route', () => {
  const app = readText('src/js/app.js');
  assert.match(app, /status === 'new'[^\n]*readyTrip/);
  assert.match(app, /storage\.reset\(\)[\s\S]{0,300}readyTrip/);
  assert.equal((app.match(/fillRoute\(/g) ?? []).length, 2, 'home dates sheet and settings dates');
  const html = readText('index.html');
  assert.match(html, /name="mode" value="template"/);
  assert.match(html, /data-slot="itin-template-card"/);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="LATISA">/);
});
