// Stage 3: route and dates (docs/GOALS_STAGE3.md S3-1 to S3-8). Written before src/js/core/itinerary.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, nightsOf, sortStops, totalNights, validateStop, findOverlaps, overlapsFor, outsideTrip,
  whereToday, seedIfNeeded, moveStop, replanOptions, diffStops, cleanStop, MAX_NAME, MAX_NOTE,
} from '../src/js/core/itinerary.js';
import { createDefaultState, validateState } from '../src/js/core/schema.js';
import { exportBackup, parseBackup } from '../src/js/core/backup.js';
import { createStorage } from '../src/js/core/storage.js';
import { TH } from '../data/packs/th.js';

const stop = (id, startDate, endDate, extra = {}) => ({ id, name: id, startDate, endDate, note: '', ...extra });
let n = 0;
const makeId = () => `id-${++n}`;
const opts = { now: () => new Date('2026-11-19T10:00:00Z'), appVersion: '0.3.0', makeId, countryCode: 'TH', tripName: 'X' };

function memoryBackend() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), map: m };
}

// ---------- S3-2: nights and order ----------
test('S3-2: nights come from the dates, across month and year ends', () => {
  assert.equal(nightsOf(stop('a', '2026-12-05', '2026-12-08')), 3);
  assert.equal(nightsOf(stop('b', '2026-12-28', '2027-01-01')), 4, 'year end');
  assert.equal(nightsOf(stop('c', '2027-01-30', '2027-02-02')), 3, 'month end');
  assert.equal(nightsOf(stop('d', '2028-02-28', '2028-03-01')), 2, 'leap year');
  assert.equal(nightsOf(stop('e', '2026-12-05', '2026-12-05')), 0, 'a day visit has no night');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2027-03-01', -1), '2027-02-28');
});

test('S3-2: stops are listed by date; ties keep their saved order', () => {
  const list = [stop('c', '2026-12-10', '2026-12-12'), stop('a', '2026-12-01', '2026-12-03'), stop('b1', '2026-12-05', '2026-12-06'), stop('b2', '2026-12-05', '2026-12-06')];
  assert.deepEqual(sortStops(list).map((s) => s.id), ['a', 'b1', 'b2', 'c']);
  assert.deepEqual(list.map((s) => s.id), ['c', 'a', 'b1', 'b2'], 'the input is not changed');
  assert.equal(totalNights(list), 2 + 2 + 1 + 1);
});

test('S3-2: the Thailand pack adds up to 29 nights over 11 stops', () => {
  const trip = { destinations: [] };
  assert.equal(seedIfNeeded(trip, TH.destinations, 'he', makeId), true);
  assert.equal(trip.destinations.length, 11);
  assert.equal(totalNights(trip.destinations), 29);
});

// ---------- S3-3: validation ----------
test('S3-3: leaving before arriving is an error; missing parts are errors', () => {
  assert.deepEqual(validateStop({ name: 'פאי', startDate: '2026-12-11', endDate: '2026-12-10' }), ['end.beforeStart']);
  assert.deepEqual(validateStop({ name: ' ', startDate: '', endDate: '2026-12-10' }).sort(), ['name.missing', 'start.missing'].sort());
  assert.deepEqual(validateStop({ name: 'x', startDate: '2026-02-30', endDate: 'abc' }).sort(), ['end.invalid', 'start.invalid'].sort());
  assert.deepEqual(validateStop({ name: 'x'.repeat(MAX_NAME + 1), startDate: '2026-12-01', endDate: '2026-12-02', note: 'y'.repeat(MAX_NOTE + 1) }).sort(), ['name.tooLong', 'note.tooLong']);
  assert.deepEqual(validateStop({ name: 'קו טאו', startDate: '2027-01-01', endDate: '2027-01-02', note: 'צלילה' }), []);
  assert.deepEqual(validateStop({ name: 'x', startDate: '2026-12-01', endDate: '2026-12-01' }), [], 'same day = day visit, allowed');
});

test('S3-3: overlaps are found; sharing a travel day is not an overlap', () => {
  const list = [stop('a', '2026-12-05', '2026-12-08'), stop('b', '2026-12-08', '2026-12-11'), stop('c', '2026-12-10', '2026-12-12'), stop('d', '2026-12-20', '2026-12-20')];
  assert.deepEqual([...findOverlaps(list)].sort(), ['b', 'c']);
  assert.deepEqual(overlapsFor({ id: 'new', startDate: '2026-12-07', endDate: '2026-12-09' }, list).map((s) => s.id), ['a', 'b']);
  assert.deepEqual(overlapsFor({ id: 'b', startDate: '2026-12-08', endDate: '2026-12-10' }, list).map((s) => s.id), [], 'a stop never overlaps itself; ends touching are fine');
  assert.deepEqual(overlapsFor({ id: 'n', startDate: '2026-12-06', endDate: '2026-12-06' }, list).map((s) => s.id), ['a'], 'a day visit inside another stay');
});

test('S3-3: stops outside the trip dates are flagged', () => {
  const list = [stop('a', '2026-12-04', '2026-12-08'), stop('b', '2026-12-08', '2026-12-11'), stop('c', '2027-01-02', '2027-01-04')];
  assert.deepEqual(outsideTrip(list, { startDate: '2026-12-05', endDate: '2027-01-03' }), ['a', 'c']);
  assert.deepEqual(outsideTrip(list, { startDate: null, endDate: null }), [], 'no trip dates, nothing to compare');
});

test('S3-3: a stop is cleaned before saving (trimmed, only known fields)', () => {
  const s = cleanStop({ id: 'x', name: '  פאי ', startDate: '2026-12-11', endDate: '2026-12-13', note: ' שוק לילה ', junk: 1, flexible: true, nightsRange: [1, 2] });
  assert.deepEqual(s, { id: 'x', name: 'פאי', startDate: '2026-12-11', endDate: '2026-12-13', note: 'שוק לילה', flexible: true, nightsRange: [1, 2] });
});

// ---------- S3-5: where am I today (Bangkok calendar date is passed in) ----------
test('S3-5: before, during (incl. travel day and a gap) and after the route', () => {
  const list = [stop('a', '2026-12-05', '2026-12-08'), stop('b', '2026-12-08', '2026-12-11'), stop('c', '2026-12-13', '2026-12-15')];
  assert.deepEqual(whereToday([], '2026-12-06'), { phase: 'empty' });
  assert.deepEqual(whereToday(list, '2026-11-19'), { phase: 'before', daysToGo: 16, nextId: 'a' });
  assert.deepEqual(whereToday(list, '2026-12-05'), { phase: 'during', stopId: 'a', night: 1, nights: 3, leaving: false });
  assert.deepEqual(whereToday(list, '2026-12-07'), { phase: 'during', stopId: 'a', night: 3, nights: 3, leaving: false });
  assert.deepEqual(whereToday(list, '2026-12-08'), { phase: 'during', stopId: 'b', night: 1, nights: 3, leaving: false }, 'travel day belongs to the new stop');
  assert.deepEqual(whereToday(list, '2026-12-12'), { phase: 'between', nextId: 'c' }, 'a gap between stops');
  assert.deepEqual(whereToday(list, '2026-12-15'), { phase: 'during', stopId: 'c', night: 2, nights: 2, leaving: true }, 'last day: still at the last stop, leaving today');
  assert.deepEqual(whereToday(list, '2026-12-16'), { phase: 'after' });
});

// ---------- First open: the pack fills the route once ----------
test('first open: the pack stops go in once, with names in the app language, and never again', () => {
  const trip = { destinations: [] };
  assert.equal(seedIfNeeded(trip, TH.destinations, 'he', makeId), true);
  assert.equal(trip.itinerarySeeded, true);
  assert.equal(trip.destinations[0].name, 'בנגקוק');
  assert.equal(trip.destinations[0].startDate, '2026-12-05');
  assert.equal(trip.destinations.find((s) => s.flexible).name, 'קו טאו');
  assert.ok(trip.destinations.every((s) => !('nights' in s)), 'nights are derived, not stored');
  assert.equal(new Set(trip.destinations.map((s) => s.id)).size, 11, 'unique ids');
  trip.destinations = [];
  assert.equal(seedIfNeeded(trip, TH.destinations, 'he', makeId), false, 'the user emptied the route: keep it empty');
  const mine = { destinations: [stop('m', '2026-12-01', '2026-12-02')] };
  assert.equal(seedIfNeeded(mine, TH.destinations, 'he', makeId), false, 'never mixes into existing stops');
  assert.equal(mine.destinations.length, 1);
});

// ---------- Reorder ----------
test('reorder: moving a stop keeps every stop\'s nights and re-chains the dates from the first day', () => {
  const list = [stop('a', '2026-12-05', '2026-12-08'), stop('b', '2026-12-08', '2026-12-10'), stop('c', '2026-12-10', '2026-12-11')];
  const up = moveStop(list, 'c', -1);
  assert.deepEqual(up.map((s) => [s.id, s.startDate, s.endDate]), [
    ['a', '2026-12-05', '2026-12-08'], ['c', '2026-12-08', '2026-12-09'], ['b', '2026-12-09', '2026-12-11'],
  ]);
  assert.equal(moveStop(list, 'a', -1), null, 'first cannot move up');
  assert.equal(moveStop(list, 'c', 1), null, 'last cannot move down');
  assert.equal(list[1].id, 'b', 'the input is not changed');
  const first = moveStop(list, 'a', 1);
  assert.deepEqual(first.map((s) => [s.id, s.startDate, s.endDate]), [
    ['b', '2026-12-05', '2026-12-07'], ['a', '2026-12-07', '2026-12-10'], ['c', '2026-12-10', '2026-12-11'],
  ]);
});

// ---------- Replan when the trip dates change ----------
const route = () => [
  stop('a', '2026-12-05', '2026-12-08'),
  stop('flex', '2026-12-08', '2026-12-09', { flexible: true, nightsRange: [1, 2] }),
  stop('z', '2026-12-09', '2026-12-10'),
];

test('replan "shift": the whole route moves with the new start', () => {
  const o = replanOptions(route(), { start: '2026-12-07', end: '2026-12-12' });
  assert.deepEqual(o.shift.stops.map((s) => [s.startDate, s.endDate]), [['2026-12-07', '2026-12-10'], ['2026-12-10', '2026-12-11'], ['2026-12-11', '2026-12-12']]);
  assert.deepEqual(o.shift.outside, []);
  const shorter = replanOptions(route(), { start: '2026-12-07', end: '2026-12-11' });
  assert.deepEqual(shorter.shift.outside, ['z'], 'warns about stops that no longer fit');
});

test('replan "fit": the flexible stop absorbs the change, inside its night range', () => {
  const longer = replanOptions(route(), { start: '2026-12-05', end: '2026-12-11' });
  assert.equal(longer.fit.ok, true);
  assert.deepEqual(longer.fit.stops.map((s) => [s.id, s.startDate, s.endDate]), [
    ['a', '2026-12-05', '2026-12-08'], ['flex', '2026-12-08', '2026-12-10'], ['z', '2026-12-10', '2026-12-11'],
  ]);
  const tooLong = replanOptions(route(), { start: '2026-12-05', end: '2026-12-13' });
  assert.deepEqual({ ok: tooLong.fit.ok, reason: tooLong.fit.reason, min: tooLong.fit.min, max: tooLong.fit.max }, { ok: false, reason: 'flexRange', min: 1, max: 2 });
  const none = replanOptions([stop('a', '2026-12-05', '2026-12-08')], { start: '2026-12-05', end: '2026-12-09' });
  assert.deepEqual({ ok: none.fit.ok, reason: none.fit.reason }, { ok: false, reason: 'noFlexible' });
  const moved = replanOptions(route(), { start: '2026-12-15', end: '2026-12-20' });
  assert.equal(moved.fit.ok, true, 'new start and one more night');
  assert.equal(moved.fit.stops.at(-1).endDate, '2026-12-20');
});

test('replan "dates only": no stop changes; stops outside the new dates are listed', () => {
  const o = replanOptions(route(), { start: '2026-12-06', end: '2026-12-10' });
  assert.deepEqual(o.datesOnly.stops, route());
  assert.deepEqual(o.datesOnly.outside, ['a']);
});

test('replan is not needed when the route already matches the new dates', () => {
  assert.equal(replanOptions(route(), { start: '2026-12-05', end: '2026-12-10' }).needed, false);
  assert.equal(replanOptions([], { start: '2026-12-05', end: '2026-12-10' }).needed, false);
  assert.equal(replanOptions(route(), { start: '2026-12-05', end: '2026-12-11' }).needed, true);
});

test('preview: "was" next to "will be", only for changed stops marked', () => {
  const before = route();
  const after = replanOptions(before, { start: '2026-12-05', end: '2026-12-11' }).fit.stops;
  const rows = diffStops(before, after);
  assert.deepEqual(rows.map((r) => [r.id, r.changed]), [['a', false], ['flex', true], ['z', true]]);
  assert.deepEqual(rows[1].from, { startDate: '2026-12-08', endDate: '2026-12-09', nights: 1 });
  assert.deepEqual(rows[1].to, { startDate: '2026-12-08', endDate: '2026-12-10', nights: 2 });
});

// ---------- S3-1 + S3-7: saved under tisa:v1, survives reload, backup round trip ----------
test('S3-1: a stop added to the state is saved under the tisa: key and is there after reload', () => {
  const backend = memoryBackend();
  const storage = createStorage({ backend, key: 'tisa:v1', ...opts });
  const { state } = storage.load();
  state.trips[state.activeTripId].destinations.push(stop('s1', '2026-12-05', '2026-12-08'));
  assert.deepEqual(storage.save(state), { ok: true });
  assert.ok([...backend.map.keys()].every((k) => k.startsWith('tisa:')));
  const again = createStorage({ backend, key: 'tisa:v1', ...opts }).load();
  assert.equal(again.status, 'ok');
  assert.deepEqual(again.state.trips[again.state.activeTripId].destinations, [stop('s1', '2026-12-05', '2026-12-08')]);
});

test('S3-1: a broken stop makes the data invalid, so it is set aside, not trusted', () => {
  const state = createDefaultState(opts);
  const trip = state.trips[state.activeTripId];
  trip.destinations.push(stop('ok', '2026-12-05', '2026-12-08'));
  assert.deepEqual(validateState(state), []);
  trip.destinations.push({ id: 'bad', name: 'x', startDate: '2026-12-09', endDate: '2026-12-01' });
  assert.ok(validateState(state).some((e) => e.includes('destinations')));
});

test('S3-7: the route goes out in the backup and comes back the same', () => {
  const state = createDefaultState(opts);
  const trip = state.trips[state.activeTripId];
  seedIfNeeded(trip, TH.destinations, 'he', makeId);
  trip.destinations[2].note = 'שוק לילה';
  const text = JSON.stringify(exportBackup(state, new Date('2026-11-19T12:00:00Z')));
  const back = parseBackup(text, opts);
  assert.equal(back.ok, true);
  assert.deepEqual(back.state.trips[back.state.activeTripId].destinations, trip.destinations);
  assert.equal(back.state.trips[back.state.activeTripId].itinerarySeeded, true);
});

test('S3-7: a Stage 2 backup (no route yet) still imports', () => {
  const state = createDefaultState(opts);
  const back = parseBackup(JSON.stringify(exportBackup(state, new Date())), opts);
  assert.equal(back.ok, true);
  assert.deepEqual(back.state.trips[back.state.activeTripId].destinations, []);
});
