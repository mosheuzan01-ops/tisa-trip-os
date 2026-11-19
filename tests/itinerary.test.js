// Stage 3: itinerary logic (docs/GOALS_STAGE3.md S3-1..S3-8, S3-11). Written before src/js/core/itinerary.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, stopNights, sortStops, totalNights, validateStop, findOverlaps, stopsOutsideTrip,
  whereToday, moveStop, replan, seedFromPack, formatDate, formatRange, cleanStops, NAME_MAX, NOTE_MAX,
} from '../src/js/core/itinerary.js';
import { TH } from '../data/packs/th.js';
import { createStorage } from '../src/js/core/storage.js';
import { exportBackup, parseBackup } from '../src/js/core/backup.js';

const s = (id, startDate, endDate, extra = {}) => ({ id, name: id, startDate, endDate, ...extra });

test('S3-2: addDays and nights cross months, years and leap days', () => {
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2027-03-01', -1), '2027-02-28');
  assert.equal(stopNights(s('a', '2026-12-28', '2027-01-01')), 4);
  assert.equal(stopNights(s('a', '2027-01-30', '2027-02-02')), 3);
  assert.equal(stopNights(s('a', '2027-01-30', '2027-01-30')), 0, 'a day visit has no night');
  assert.equal(stopNights(s('a', 'bad', '2027-01-30')), 0);
});

test('S3-2: stops are sorted by arrival date, then by departure, and the total is the sum', () => {
  const list = [s('c', '2027-01-05', '2027-01-07'), s('a', '2026-12-30', '2027-01-02'), s('b', '2027-01-02', '2027-01-05')];
  assert.deepEqual(sortStops(list).map((x) => x.id), ['a', 'b', 'c']);
  assert.deepEqual(list.map((x) => x.id), ['c', 'a', 'b'], 'sortStops does not change its input');
  assert.deepEqual(sortStops([s('y', '2027-01-01', '2027-01-03'), s('x', '2027-01-01', '2027-01-02')]).map((x) => x.id), ['x', 'y']);
  assert.equal(totalNights(list), 8);
  assert.equal(totalNights([]), 0);
});

test('S3-2: the Thailand pack adds up to 29 nights through the month change', () => {
  const stops = seedFromPack(TH, 'he', (() => { let n = 0; return () => `id${++n}`; })());
  assert.equal(stops.length, 11);
  assert.equal(totalNights(stops), 29);
  assert.equal(stops[0].name, 'בנגקוק');
  assert.equal(stops[8].name, 'קופנגן');
  assert.equal(stopNights(stops[8]), 4, 'Koh Phangan, 28.12 to 1.1');
  assert.deepEqual(stops[9].nightsRange, [1, 2]);
  assert.equal(stops[9].flexible, true);
  assert.ok(stops.every((x) => /^id\d+$/.test(x.id) && x.note === ''));
  assert.equal(seedFromPack(TH, 'en', () => 'x')[0].name, 'Bangkok');
});

test('S3-3: validateStop requires a name and real dates, and departure not before arrival', () => {
  assert.deepEqual(validateStop(s('Pai', '2027-01-01', '2027-01-03')), []);
  assert.deepEqual(validateStop(s('Pai', '2027-01-01', '2027-01-01')), [], 'same day is allowed');
  assert.deepEqual(validateStop({ name: '  ', startDate: '2027-01-01', endDate: '2027-01-02' }), ['name.missing']);
  assert.deepEqual(validateStop({ name: 'x'.repeat(NAME_MAX + 1), startDate: '2027-01-01', endDate: '2027-01-02' }), ['name.tooLong']);
  assert.deepEqual(validateStop({ name: 'Pai', startDate: '', endDate: '2027-01-02' }), ['start.missing']);
  assert.deepEqual(validateStop({ name: 'Pai', startDate: '2027-02-30', endDate: '2027-03-02' }), ['start.invalid']);
  assert.deepEqual(validateStop({ name: 'Pai', startDate: '2027-01-02' }), ['end.missing']);
  assert.deepEqual(validateStop({ name: 'Pai', startDate: '2027-01-05', endDate: '2027-01-02' }), ['end.beforeStart']);
  assert.deepEqual(validateStop({ name: 'Pai', startDate: '2027-01-01', endDate: '2027-01-02', note: 'x'.repeat(NOTE_MAX + 1) }), ['note.tooLong']);
});

test('S3-3: overlaps are found; a same-day handover is not an overlap', () => {
  const ok = [s('a', '2027-01-01', '2027-01-03'), s('b', '2027-01-03', '2027-01-05')];
  assert.deepEqual(findOverlaps(ok), []);
  const bad = [s('a', '2027-01-01', '2027-01-04'), s('b', '2027-01-03', '2027-01-05'), s('c', '2027-01-10', '2027-01-11')];
  assert.deepEqual(findOverlaps(bad), [['a', 'b']]);
  const inside = [s('a', '2027-01-01', '2027-01-10'), s('c', '2027-01-08', '2027-01-09'), s('b', '2027-01-03', '2027-01-04')];
  assert.deepEqual(findOverlaps(inside), [['a', 'b'], ['a', 'c']]);
});

test('S3-3: stops outside the trip dates are listed', () => {
  const list = [s('a', '2027-01-01', '2027-01-03'), s('b', '2027-01-03', '2027-01-06')];
  assert.deepEqual(stopsOutsideTrip(list, { start: '2027-01-01', end: '2027-01-05' }), ['b']);
  assert.deepEqual(stopsOutsideTrip(list, { start: '2027-01-02', end: '2027-01-06' }), ['a']);
  assert.deepEqual(stopsOutsideTrip(list, null), []);
});

test('S3-5: where am I today: before, during (incl. handover day), between, after, empty', () => {
  const list = [s('a', '2027-01-01', '2027-01-03'), s('b', '2027-01-03', '2027-01-05'), s('c', '2027-01-08', '2027-01-10')];
  assert.deepEqual(whereToday([], '2027-01-01'), { phase: 'empty' });
  assert.deepEqual(whereToday(list, '2026-12-29'), { phase: 'before', nextId: 'a', daysToGo: 3 });
  assert.deepEqual(whereToday(list, '2027-01-01'), { phase: 'during', currentId: 'a' });
  assert.deepEqual(whereToday(list, '2027-01-02'), { phase: 'during', currentId: 'a' });
  assert.deepEqual(whereToday(list, '2027-01-03'), { phase: 'during', currentId: 'b' }, 'arrival day wins');
  assert.deepEqual(whereToday(list, '2027-01-06'), { phase: 'between', nextId: 'c', daysToGo: 2 });
  assert.deepEqual(whereToday(list, '2027-01-10'), { phase: 'during', currentId: 'c' }, 'last day is still the trip');
  assert.deepEqual(whereToday(list, '2027-01-11'), { phase: 'after' });
});

test('S3-4: moving a stop swaps it with its neighbour and keeps each stop\'s nights', () => {
  const list = [s('a', '2027-01-01', '2027-01-03'), s('b', '2027-01-03', '2027-01-07'), s('c', '2027-01-07', '2027-01-08')];
  const down = moveStop(list, 'a', 1);
  assert.deepEqual(down.map((x) => [x.id, x.startDate, x.endDate]), [
    ['b', '2027-01-01', '2027-01-05'], ['a', '2027-01-05', '2027-01-07'], ['c', '2027-01-07', '2027-01-08'],
  ]);
  const up = moveStop(list, 'c', -1);
  assert.deepEqual(up.map((x) => [x.id, x.startDate, x.endDate]), [
    ['a', '2027-01-01', '2027-01-03'], ['c', '2027-01-03', '2027-01-04'], ['b', '2027-01-04', '2027-01-08'],
  ]);
  assert.equal(moveStop(list, 'a', -1), null, 'first stop cannot go up');
  assert.equal(moveStop(list, 'c', 1), null, 'last stop cannot go down');
  assert.equal(moveStop(list, 'zzz', 1), null);
  assert.equal(list[0].startDate, '2027-01-01', 'input unchanged');
  // A gap between the two stops stays where it was.
  const gap = moveStop([s('a', '2027-01-01', '2027-01-03'), s('b', '2027-01-05', '2027-01-06')], 'b', -1);
  assert.deepEqual(gap.map((x) => [x.id, x.startDate, x.endDate]), [['b', '2027-01-01', '2027-01-02'], ['a', '2027-01-04', '2027-01-06']]);
});

test('S3-11: replan "shift" moves every stop by the start-date change', () => {
  const list = [s('a', '2027-01-01', '2027-01-03'), s('b', '2027-01-03', '2027-01-05')];
  const r = replan(list, { start: '2027-01-01', end: '2027-01-05' }, { start: '2027-01-30', end: '2027-02-03' }, 'shift');
  assert.equal(r.ok, true);
  assert.deepEqual(r.stops.map((x) => [x.startDate, x.endDate]), [['2027-01-30', '2027-02-01'], ['2027-02-01', '2027-02-03']]);
  assert.deepEqual(r.changes.map((c) => [c.id, c.before.startDate, c.after.startDate]), [['a', '2027-01-01', '2027-01-30'], ['b', '2027-01-03', '2027-02-01']]);
  assert.deepEqual(r.warnings, []);
  assert.equal(list[0].startDate, '2027-01-01', 'nothing changes until saved');
  const longer = replan(list, { start: '2027-01-01', end: '2027-01-05' }, { start: '2027-01-02', end: '2027-01-09' }, 'shift');
  assert.deepEqual(longer.warnings, ['length.differs']);
});

test('S3-11: replan "flex" takes the length change from the flexible stop, within its range', () => {
  const list = [s('a', '2027-01-01', '2027-01-03'), s('t', '2027-01-03', '2027-01-04', { flexible: true, nightsRange: [1, 2] }), s('z', '2027-01-04', '2027-01-05')];
  const trip = { start: '2027-01-01', end: '2027-01-05' };
  const plus = replan(list, trip, { start: '2027-01-01', end: '2027-01-06' }, 'flex');
  assert.equal(plus.ok, true);
  assert.deepEqual(plus.stops.map((x) => [x.id, x.startDate, x.endDate]), [
    ['a', '2027-01-01', '2027-01-03'], ['t', '2027-01-03', '2027-01-05'], ['z', '2027-01-05', '2027-01-06'],
  ]);
  assert.deepEqual(plus.changes.map((c) => c.id), ['t', 'z'], 'only changed stops are listed');
  const moved = replan(list, trip, { start: '2027-01-10', end: '2027-01-15' }, 'flex');
  assert.equal(moved.stops[2].endDate, '2027-01-15');
  assert.deepEqual(replan(list, trip, { start: '2027-01-01', end: '2027-01-07' }, 'flex'), { ok: false, error: 'flex.outOfRange' });
  assert.deepEqual(replan(list, trip, { start: '2027-01-01', end: '2027-01-04' }, 'flex'), { ok: false, error: 'flex.outOfRange' });
  assert.deepEqual(replan([s('a', '2027-01-01', '2027-01-03')], trip, { start: '2027-01-01', end: '2027-01-06' }, 'flex'), { ok: false, error: 'flex.none' });
});

test('S3-11: replan "datesOnly" keeps the stops and warns about the ones outside', () => {
  const list = [s('a', '2027-01-01', '2027-01-03'), s('b', '2027-01-03', '2027-01-05')];
  const r = replan(list, { start: '2027-01-01', end: '2027-01-05' }, { start: '2027-01-02', end: '2027-01-05' }, 'datesOnly');
  assert.equal(r.ok, true);
  assert.deepEqual(r.changes, []);
  assert.deepEqual(r.warnings, ['outside']);
  assert.deepEqual(r.outside, ['a']);
  assert.deepEqual(replan(list, null, { start: '2027-01-05', end: '2027-01-01' }, 'shift'), { ok: false, error: 'end.beforeStart' });
  assert.deepEqual(replan(list, null, { start: '2027-01-02', end: '2027-01-05' }, 'shift').stops[0].startDate, '2027-01-02', 'no old dates: the first stop is the anchor');
});

test('S3-8: dates use Intl with he-IL, one format everywhere', () => {
  const fmt = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  assert.equal(formatDate('2026-12-05', 'he-IL'), fmt.format(new Date(Date.UTC(2026, 11, 5))));
  assert.match(formatDate('2026-12-05', 'he-IL'), /5.*דצמ/);
  assert.equal(formatRange(s('a', '2026-12-28', '2027-01-01'), 'he-IL'), `${formatDate('2026-12-28', 'he-IL')} – ${formatDate('2027-01-01', 'he-IL')}`);
  assert.equal(formatDate('nope', 'he-IL'), '');
});

test('cleanStops keeps only usable stops for display and never mutates the data', () => {
  const raw = [s('a', '2027-01-01', '2027-01-02'), null, { id: 'b' }, s('c', '2027-01-05', '2027-01-03'), 'x'];
  assert.deepEqual(cleanStops(raw).map((x) => x.id), ['a']);
  assert.equal(raw.length, 5);
  assert.deepEqual(cleanStops(undefined), []);
});

function memoryBackend() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k), map };
}
const opts = { now: () => new Date('2026-11-19T10:00:00Z'), appVersion: '0.3.0', makeId: () => 'trip-1', countryCode: 'TH', tripName: 'תאילנד' };
const storageOn = (backend) => createStorage({ backend, key: 'tisa:v1', legacy: { trip: 'tisa:trip', theme: 'tisa:theme' }, corruptPrefix: 'tisa:corrupt:', ...opts });

test('S3-1: stops are saved under the tisa: key and survive a reload', () => {
  const backend = memoryBackend();
  const first = storageOn(backend);
  const { state } = first.load();
  state.trips[state.activeTripId].destinations.push(s('a', '2027-01-01', '2027-01-03', { note: 'שוק לילה' }));
  assert.equal(first.save(state).ok, true);
  assert.ok([...backend.map.keys()].every((k) => k.startsWith('tisa:')));
  const again = storageOn(backend).load().state;
  assert.deepEqual(again.trips[again.activeTripId].destinations, [s('a', '2027-01-01', '2027-01-03', { note: 'שוק לילה' })]);
});

test('S3-7: the itinerary goes out in a backup and comes back unchanged', () => {
  const { state } = storageOn(memoryBackend()).load();
  const stops = seedFromPack(TH, 'he', (() => { let n = 0; return () => `s${++n}`; })());
  state.trips[state.activeTripId].destinations = stops;
  const text = JSON.stringify(exportBackup(state, new Date('2026-11-19T12:00:00Z')));
  const back = parseBackup(text, opts);
  assert.equal(back.ok, true);
  assert.deepEqual(back.state.trips[back.state.activeTripId].destinations, stops);
  assert.equal(totalNights(back.state.trips[back.state.activeTripId].destinations), 29);
});
