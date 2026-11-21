// Stage 9, PR 1 (docs/GOALS_STAGE9.md): budget template, route from the trip dates, archive, schema v6.
// Written before the code (rule 12). Sample dates only: never the owner's own trip dates (rule 16).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJson } from './helpers.js';
import { TH } from '../data/packs/th.js';
import { SCHEMA_VERSION, migrate, validateState, createDefaultState } from '../src/js/core/schema.js';
import { createStorage } from '../src/js/core/storage.js';
import { profileToBudget, summarize, EMERGENCY, dailyBase, moveBetween, renameCategory, visibleCategories, categoryLabel } from '../src/js/core/money.js';
import { daysBetween } from '../src/js/core/trip.js';
import { totalNights, findOverlaps, stopsOutsideTrip, sortStops } from '../src/js/core/itinerary.js';
import { planRoute, tripCounts } from '../src/js/core/route-plan.js';
import { applyTemplate, needsTemplateOffer, declineTemplate, stopNameFor, TEMPLATE_ID } from '../src/js/core/template.js';

const opts = { now: () => new Date('2026-11-21T10:00:00Z'), appVersion: '0.8.0', makeId: () => 'trip-1', countryCode: 'TH', tripName: 'תאילנד' };
let n = 0;
const makeId = () => `id${(n += 1)}`;
const v5 = () => readJson('tests/fixtures/v5-stage7.json');
const template = () => TH.budgetTemplates.find((x) => x.id === TEMPLATE_ID);
const sum = (o, skip = []) => Object.entries(o).filter(([k]) => !skip.includes(k)).reduce((s, [, v]) => s + v, 0);

// ---------- S9-1: the template's amounts ----------
test('S9-1: the template is 15,000 without the flight and 20,000 with it; emergency 2,500 stays outside', () => {
  const b = profileToBudget(template(), 'he');
  assert.equal(sum(b.categoriesMinor, ['flight', EMERGENCY]), 1_500_000);
  assert.equal(sum(b.categoriesMinor, [EMERGENCY]), 2_000_000);
  assert.equal(b.categoriesMinor[EMERGENCY], 250_000);
  const s = summarize(b, []);
  assert.equal(s.totalMinor, 2_000_000, 'the base budget does not include the emergency fund');
  assert.equal(s.emergency.planMinor, 250_000);
  assert.deepEqual(b.categoriesMinor, { flight: 500_000, lodging: 500_000, food: 350_000, transport: 220_000, attractions: 230_000, 'insurance-sim-gear': 100_000, misc: 100_000, emergency: 250_000 });
});

test('S9-1: template category names and the hidden "green" category; ids are the pack ids', () => {
  const b = profileToBudget(template(), 'he');
  assert.equal(b.categoryNames.food, 'אוכל ושתייה');
  assert.equal(b.categoryNames.misc, 'רזרבה, קניות ומתנות');
  assert.deepEqual(b.hidden, ['green']);
  assert.equal(b.profileId, TEMPLATE_ID);
  for (const id of Object.keys(b.categoriesMinor)) assert.ok(id === EMERGENCY || TH.budgetCategories.some((c) => c.id === id), id);
});

// ---------- S9-2: daily base ----------
test('S9-2: daily base = (budget without flight) / trip dates, in agorot: 32 dates -> 46,875', () => {
  const b = profileToBudget(template(), 'he');
  assert.equal(dailyBase(b, { start: '2030-03-01', end: '2030-04-01' }), 46_875); // 32 sample dates
  assert.equal(dailyBase(b, null), null);
  assert.equal(dailyBase({ categoriesMinor: {} }, { start: '2030-03-01', end: '2030-04-01' }), null);
  assert.equal(dailyBase(b, { start: '2030-03-01', end: '2030-03-07' }), Math.floor(1_500_000 / 7));
});

test('S9-2: counts: dates, nights, lodging nights (first night on the plane)', () => {
  const { stops } = planRoute('2030-03-01', '2030-04-01', TH.routeTemplate, 'he', makeId);
  assert.deepEqual(tripCounts('2030-03-01', '2030-04-01', stops), { dates: 32, nights: 31, lodgingNights: 30 });
});

// ---------- S9-3: the route from the dates ----------
const ranges = [
  ['2030-12-15', '2031-01-15'], // 32 dates, has 31.12
  ['2030-12-20', '2031-01-03'], // short, has 31.12
  ['2030-12-26', '2031-01-20'], // 31.12 early in the islands
  ['2030-12-05', '2031-01-12'], // long, 31.12 late
  ['2030-03-01', '2030-04-01'], // no 31.12
  ['2030-02-01', '2030-02-15'], // short, no 31.12
];
for (const [start, end] of ranges) {
  test(`S9-3: route for ${start}..${end}: plane night, Bangkok first, islands in the south, last 3 dates in Bangkok, no gaps or overlaps`, () => {
    const { stops, warnings } = planRoute(start, end, TH.routeTemplate, 'he', makeId);
    const list = sortStops(stops);
    const nights = daysBetween(start, end);
    assert.equal(totalNights(list), nights - 1, 'lodging = nights - 1 (first night on the plane)');
    assert.equal(daysBetween(start, list[0].startDate), 1, 'the first stop starts the day after departure');
    assert.equal(list[0].name, 'בנגקוק');
    assert.ok([2, 3].includes(daysBetween(list[0].startDate, list[0].endDate)), 'Bangkok at the start: 2-3 nights');
    const last = list[list.length - 1];
    assert.equal(last.name, 'בנגקוק');
    assert.deepEqual([last.startDate, last.endDate], [addDays(end, -2), end], 'last 3 dates in Bangkok, 2 nights');
    for (let i = 1; i < list.length; i += 1) assert.equal(list[i].startDate, list[i - 1].endDate, 'no gaps');
    assert.deepEqual(findOverlaps(list), []);
    assert.deepEqual(stopsOutsideTrip(list, { start, end }), []);
    const middle = list.slice(1, -1);
    for (const s of middle) {
      assert.ok(['קו סמוי', 'קו טאו', 'פוקט', 'קו פי פי', 'קו לנטה'].includes(s.name), s.name);
      assert.ok(daysBetween(s.startDate, s.endDate) >= 2, `${s.name} at least 2 nights`);
    }
    assert.ok(!list.some((s) => /פאי|צ'יאנג|קראבי/.test(s.name)), 'no north, no Pai, no Krabi');
    assert.ok(list.every((s) => s.suggested === true), 'every stop is marked as a suggestion');
    const ny = newYearNight(start, end);
    if (ny) {
      const samui = list.find((s) => s.name === 'קו סמוי');
      assert.ok(samui && samui.startDate <= ny && ny < samui.endDate, `Samui covers the night of ${ny}`);
      assert.deepEqual(warnings, []);
    }
  });
}

test('S9-3: the flexible stop (Koh Tao) is never the longest island, whatever the dates', () => {
  for (const [start, end] of ranges) {
    const middle = planRoute(start, end, TH.routeTemplate, 'he', makeId).stops.slice(1, -1);
    const tao = middle.find((s) => s.name === 'קו טאו');
    if (!tao) continue;
    const longest = Math.max(...middle.map((s) => daysBetween(s.startDate, s.endDate)));
    assert.ok(daysBetween(tao.startDate, tao.endDate) < longest, `${start}: Koh Tao ${daysBetween(tao.startDate, tao.endDate)} vs ${longest}`);
  }
});

test('S9-3: 31.12 on a Bangkok or plane night is a clear warning, never a silent move', () => {
  const plane = planRoute('2030-12-31', '2031-01-20', TH.routeTemplate, 'he', makeId);
  assert.ok(plane.warnings.includes('newYear.notOnIsland'));
  const lastBkk = planRoute('2030-12-10', '2031-01-02', TH.routeTemplate, 'he', makeId);
  assert.ok(lastBkk.warnings.includes('newYear.notOnIsland'));
});

test('S9-3: too short for the plan gives a warning and no invented stops; short trips drop Koh Tao first', () => {
  const tiny = planRoute('2030-03-01', '2030-03-05', TH.routeTemplate, 'he', makeId);
  assert.deepEqual(tiny.stops, []);
  assert.ok(tiny.warnings.includes('route.tooShort'));
  const short = planRoute('2030-02-01', '2030-02-15', TH.routeTemplate, 'he', makeId).stops.map((s) => s.name);
  assert.ok(!short.includes('קו טאו'), 'the flexible stop goes first');
  const long = planRoute('2030-12-15', '2031-01-15', TH.routeTemplate, 'he', makeId).stops.find((s) => s.name === 'קו טאו');
  assert.equal(long?.flexible, true);
});

// ---------- S9-4: archive ----------
test('S9-4: the old route and the three old templates are in the archive, marked stale, and not active', () => {
  assert.equal(TH.archive.destinations.length, 11);
  assert.deepEqual(TH.archive.budgetProfiles.map((p) => p.id), ['saver', 'realistic', 'comfort']);
  assert.equal(TH.archive.stale, true);
  assert.ok(!('destinations' in TH) && !('budgetProfiles' in TH) && !('defaultDates' in TH), 'nothing old at the top level');
  assert.deepEqual(TH.budgetTemplates.map((x) => x.id), [TEMPLATE_ID]);
  assert.ok(!JSON.stringify(TH.budgetTemplates).match(/20\.12|2026-12-20|2027-01-20/), 'no personal dates in the template');
});

// ---------- schema v6, with a copy kept before migrating ----------
test('v6: real v5 data migrates with nothing lost; archive and category fields are added', () => {
  const before = v5();
  const out = migrate(structuredClone(before), opts);
  assert.equal(SCHEMA_VERSION, 6);
  assert.equal(out.schemaVersion, 6);
  const a = before.trips.t;
  const b = out.trips.t;
  for (const k of Object.keys(a)) if (k !== 'budget') assert.deepEqual(b[k], a[k], k);
  assert.deepEqual({ ...b.budget, categoryNames: undefined, hidden: undefined }, { ...a.budget, categoryNames: undefined, hidden: undefined });
  assert.deepEqual(b.budget.categoryNames, {});
  assert.deepEqual(b.budget.hidden, []);
  assert.deepEqual(b.archive, { budgets: [], routes: [] });
  assert.equal(b.templateOffer, null);
  assert.deepEqual(validateState(out), []);
  assert.deepEqual(validateState(createDefaultState(opts)), []);
});

test('v6: before migrating, the storage keeps a one-time copy of the old data under its own key', () => {
  const raw = JSON.stringify(v5());
  const map = new Map([['tisa:v1', raw]]);
  const backend = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
  const storage = createStorage({ backend, key: 'tisa:v1', ...opts, premigrationPrefix: 'tisa:premigration:' });
  const loaded = storage.load();
  assert.equal(loaded.status, 'migrated');
  assert.equal(map.get('tisa:premigration:v5'), raw, 'the exact old text is kept');
  storage.save(loaded.state);
  createStorage({ backend, key: 'tisa:v1', ...opts, premigrationPrefix: 'tisa:premigration:' }).load();
  assert.equal(map.get('tisa:premigration:v5'), raw, 'never overwritten later');
  assert.equal(JSON.parse(map.get('tisa:v1')).schemaVersion, 6);
});

// ---------- S9-5: applying the template to a user who already has data ----------
test('S9-5: applying keeps every expense, transfer, check-in and photo; the old budget and route go to the archive', () => {
  const state = migrate(v5(), opts);
  const trip = state.trips.t;
  const before = structuredClone(trip);
  assert.equal(needsTemplateOffer(trip), true);
  trip.startDate = '2030-12-15'; trip.endDate = '2031-01-15';
  applyTemplate(trip, TH, 'he', makeId, '2026-11-21T10:00:00Z');
  for (const k of ['expenses', 'transfers', 'checkins', 'photos', 'journal', 'checklist', 'tasks', 'luggage']) assert.deepEqual(trip[k], before[k], k);
  assert.deepEqual(trip.archive.budgets[0].budget, before.budget);
  assert.deepEqual(trip.archive.routes[0].destinations, before.destinations);
  assert.equal(trip.budget.profileId, TEMPLATE_ID);
  assert.equal(trip.budget.categoriesMinor[EMERGENCY], before.budget.categoriesMinor[EMERGENCY], 'the user\'s own emergency amount stays');
  assert.equal(trip.templateOffer, 'applied');
  assert.equal(needsTemplateOffer(trip), false);
  assert.equal(totalNights(trip.destinations), 30);
  assert.deepEqual(validateState(state), []);
});

test('S9-5: declining changes nothing but the one-time flag; a new empty trip gets no card', () => {
  const state = migrate(v5(), opts);
  const trip = state.trips.t;
  const before = structuredClone(trip);
  declineTemplate(trip);
  assert.deepEqual({ ...trip, templateOffer: null }, { ...before, templateOffer: null });
  assert.equal(needsTemplateOffer(trip), false);
  assert.equal(needsTemplateOffer(createDefaultState(opts).trips['trip-1']), false);
});

test('S9-5: with no trip dates the template applies to the budget only; the stops stay', () => {
  const trip = migrate(v5(), opts).trips.t;
  const stops = structuredClone(trip.destinations);
  trip.startDate = null; trip.endDate = null;
  applyTemplate(trip, TH, 'he', makeId, '2026-11-21T10:00:00Z');
  assert.deepEqual(trip.destinations, stops);
  assert.deepEqual(trip.archive.routes, []);
});

// ---------- S9-6: editing never breaks expenses ----------
test('S9-6: moving money between categories keeps the total; bad moves change nothing', () => {
  const b = profileToBudget(template(), 'he');
  const moved = moveBetween(b, 'misc', 'food', 50_000);
  assert.equal(moved.categoriesMinor.misc, 50_000);
  assert.equal(moved.categoriesMinor.food, 400_000);
  assert.equal(sum(moved.categoriesMinor, [EMERGENCY]), 2_000_000);
  assert.deepEqual(moveBetween(b, 'misc', 'food', 200_000), b, 'not more than there is');
  assert.deepEqual(moveBetween(b, 'misc', 'misc', 100), b);
  assert.deepEqual(moveBetween(b, 'misc', 'food', 0), b);
  assert.equal(b.categoriesMinor.misc, 100_000, 'input untouched');
});

test('S9-6: renaming a category keeps its id, so expenses stay in it; empty name goes back to the default', () => {
  const b = profileToBudget(template(), 'he');
  const r = renameCategory(b, 'food', '  אוכל  ');
  assert.equal(r.categoryNames.food, 'אוכל');
  assert.equal(categoryLabel(r, 'food', 'Food'), 'אוכל');
  assert.equal(categoryLabel(renameCategory(r, 'food', ''), 'food', 'Food'), 'Food');
  assert.deepEqual(Object.keys(r.categoriesMinor), Object.keys(b.categoriesMinor));
});

test('S9-6: "green" is hidden only while it is empty; with an expense in it, it shows', () => {
  const b = profileToBudget(template(), 'he');
  const ids = TH.budgetCategories.map((c) => c.id);
  assert.ok(!visibleCategories(b, [], ids).includes('green'));
  assert.ok(visibleCategories(b, [{ category: 'green', baseMinor: 4000 }], ids).includes('green'));
  assert.ok(visibleCategories({ categoriesMinor: {}, hidden: [] }, [], ids).includes('green'), 'old budgets hide nothing');
});

test('S9-6: an expense linked to a stop that moved to the archive still shows its stop name', () => {
  const state = migrate(v5(), opts);
  const trip = state.trips.t;
  trip.startDate = '2030-12-15'; trip.endDate = '2031-01-15';
  applyTemplate(trip, TH, 'he', makeId, '2026-11-21T10:00:00Z');
  const e = trip.expenses.find((x) => x.destinationId === 'd2');
  assert.deepEqual(stopNameFor(trip, e.destinationId), { name: "צ'יאנג מאי", archived: true });
  assert.equal(stopNameFor(trip, 'nope'), null);
});

function addDays(iso, k) {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10);
}
function newYearNight(start, end) {
  for (let y = Number(start.slice(0, 4)); y <= Number(end.slice(0, 4)); y += 1) {
    const ny = `${y}-12-31`;
    if (start <= ny && ny < end) return ny;
  }
  return null;
}
