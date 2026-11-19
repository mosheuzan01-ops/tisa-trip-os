// Stage 6.0b: the calendar as a list of days (docs/GOALS_STAGE6.md S6-3, S6-4). Written before src/js/core/calendar.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tripDays, stopsOnDay, transfersOnDay, tasksOnDay, plannedForDay, buildCalendar } from '../src/js/core/calendar.js';
import { summarize } from '../src/js/core/money.js';

const stops = [
  { id: 'd2', name: "צ'יאנג מאי", startDate: '2026-12-08', endDate: '2026-12-12', note: '' },
  { id: 'd1', name: 'בנגקוק', startDate: '2026-12-05', endDate: '2026-12-08', note: '' },
];

test('S6-3: trip days run from the first date to the last, both included', () => {
  assert.deepEqual(tripDays('2026-12-05', '2026-12-08'), ['2026-12-05', '2026-12-06', '2026-12-07', '2026-12-08']);
  assert.deepEqual(tripDays('2026-12-05', '2026-12-05'), ['2026-12-05'], 'a one-day trip has one day');
  assert.equal(tripDays('2026-12-05', '2027-01-03').length, 30);
});

test('S6-3: across a month and a year (31.12 to 1.1), no day missing or twice', () => {
  const days = tripDays('2026-12-30', '2027-01-02');
  assert.deepEqual(days, ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  assert.equal(new Set(tripDays('2026-02-27', '2026-03-02')).size, 4, 'end of February, not a leap year');
});

test('S6-3: no trip dates, or broken dates, give no days (nothing guessed)', () => {
  assert.deepEqual(tripDays(null, null), []);
  assert.deepEqual(tripDays('2026-12-05', null), []);
  assert.deepEqual(tripDays('2026-12-08', '2026-12-05'), [], 'end before start');
  assert.deepEqual(tripDays('2026-13-01', '2026-13-05'), []);
});

test('S6-3: the stop of a day; on a travel day both, the one left first, then the one arrived at', () => {
  assert.deepEqual(stopsOnDay(stops, '2026-12-06'), [{ id: 'd1', name: 'בנגקוק', role: 'stay' }]);
  assert.deepEqual(stopsOnDay(stops, '2026-12-05'), [{ id: 'd1', name: 'בנגקוק', role: 'arrive' }]);
  assert.deepEqual(stopsOnDay(stops, '2026-12-08'), [
    { id: 'd1', name: 'בנגקוק', role: 'leave' },
    { id: 'd2', name: "צ'יאנג מאי", role: 'arrive' },
  ]);
  assert.deepEqual(stopsOnDay(stops, '2026-12-12'), [{ id: 'd2', name: "צ'יאנג מאי", role: 'leave' }]);
  assert.deepEqual(stopsOnDay(stops, '2026-12-20'), [], 'a day with no stop');
  assert.deepEqual(stopsOnDay([{ id: 'x', name: 'יום', startDate: '2026-12-20', endDate: '2026-12-20' }], '2026-12-20'), [{ id: 'x', name: 'יום', role: 'day' }], 'a day visit');
  assert.deepEqual(stopsOnDay([null, { id: 'b' }, ...stops], '2026-12-06').length, 1, 'broken stops are skipped');
});

test('S6-4: transfers of a day, sorted by time; ones without a time come first, as on the transfers screen', () => {
  const list = [
    { id: 't2', kind: 'bus', from: 'א', to: 'ב', date: '2026-12-08', time: '13:30' },
    { id: 't1', kind: 'flight', from: 'ג', to: 'ד', date: '2026-12-08', time: '' },
    { id: 't3', kind: 'train', from: 'ה', to: 'ו', date: '2026-12-09', time: '08:00' },
    null,
  ];
  assert.deepEqual(transfersOnDay(list, '2026-12-08').map((x) => x.id), ['t1', 't2']);
  assert.deepEqual(transfersOnDay(list, '2026-12-10'), []);
});

test('S6-4: tasks of a day are the ones due that day, with their state by the Bangkok date', () => {
  const tasks = [
    { id: 'k1', title: 'ביטוח', status: 'open', due: '2026-12-06', note: '' },
    { id: 'k2', title: 'מוזיאון', status: 'done', due: '2026-12-06', note: '' },
    { id: 'k3', title: 'בלי תאריך', status: 'open', due: null, note: '' },
    { id: 'k4', title: 'אחר', status: 'doing', due: '2026-12-07', note: '' },
    { id: 'bad' },
  ];
  assert.deepEqual(tasksOnDay(tasks, '2026-12-06', '2026-12-06').map((x) => [x.id, x.state]), [['k1', 'today'], ['k2', 'done']]);
  assert.deepEqual(tasksOnDay(tasks, '2026-12-06', '2026-12-07').map((x) => x.state), ['overdue', 'done']);
  assert.deepEqual(tasksOnDay(tasks, '2026-12-07', '2026-12-05').map((x) => [x.id, x.state]), [['k4', 'upcoming']]);
});

const exp = (o) => ({ id: o.id, amountMinor: o.baseMinor, currency: 'ILS', rate: 1, category: 'food', method: 'card', description: '', note: '', destinationId: null, ...o });
const expenses = [
  exp({ id: 'e1', baseMinor: 3000, date: '2026-12-06', status: 'paid' }),
  exp({ id: 'e2', baseMinor: 12000, date: '2026-12-06', status: 'planned' }),
  exp({ id: 'e3', baseMinor: 250000, date: '2026-12-06', status: 'committed', category: 'flight' }),
  exp({ id: 'e4', baseMinor: 50000, date: '2026-12-06', status: 'planned', category: 'emergency' }),
  exp({ id: 'e5', baseMinor: 4500, date: '2026-12-07', status: 'planned' }),
  { id: 'broken', date: '2026-12-06', status: 'planned' },
];

test('S6-4: planned for a day = planned + future commitment of that day; paid is never in it', () => {
  assert.deepEqual(plannedForDay(expenses, '2026-12-06'), { minor: 262000, count: 2 });
  assert.deepEqual(plannedForDay(expenses, '2026-12-07'), { minor: 4500, count: 1 });
  assert.deepEqual(plannedForDay(expenses, '2026-12-08'), { minor: 0, count: 0 }, 'no plan: zero and no expenses');
  assert.deepEqual(plannedForDay([exp({ id: 'p', baseMinor: 9900, date: '2026-12-09', status: 'paid' })], '2026-12-09'), { minor: 0, count: 0 }, 'only paid: no plan');
});

test('S6-4: the days add up to the planned and committed totals of the money screen (same rule, no double count)', () => {
  const s = summarize({ currency: 'ILS', totalMinor: 1527000, categoriesMinor: {} }, expenses.filter((e) => Number.isInteger(e.baseMinor)), null);
  const days = tripDays('2026-12-05', '2026-12-08');
  const sum = days.reduce((n, d) => n + plannedForDay(expenses, d).minor, 0);
  assert.equal(sum, s.plannedMinor + s.committedMinor);
});

test('S6-3/S6-4: buildCalendar puts it together, marks today, and says when there are no dates', () => {
  const trip = {
    startDate: '2026-12-05', endDate: '2026-12-09', destinations: stops, expenses,
    transfers: [{ id: 't1', kind: 'bus', from: 'בנגקוק', to: "צ'יאנג מאי", date: '2026-12-08', time: '' }],
    tasks: [{ id: 'k1', title: 'ביטוח', status: 'open', due: '2026-12-06', note: '' }],
  };
  const cal = buildCalendar(trip, '2026-12-06');
  assert.equal(cal.hasDates, true);
  assert.equal(cal.days.length, 5);
  assert.equal(cal.todayIndex, 1);
  const d = cal.days[1];
  assert.equal(d.date, '2026-12-06');
  assert.equal(d.n, 2, 'day number in the trip, from 1');
  assert.equal(d.isToday, true);
  assert.deepEqual(d.stops.map((x) => x.name), ['בנגקוק']);
  assert.deepEqual(d.tasks.map((x) => x.state), ['today']);
  assert.deepEqual(d.planned, { minor: 262000, count: 2 });
  assert.equal(cal.days[3].transfers[0].id, 't1');
  assert.equal(cal.days[3].stops.length, 2);
  assert.deepEqual(buildCalendar(trip, '2026-11-20').todayIndex, -1, 'before the trip: no day is today');
  const none = buildCalendar({ ...trip, startDate: null, endDate: null }, '2026-12-06');
  assert.equal(none.hasDates, false);
  assert.deepEqual(none.days, []);
  const empty = buildCalendar({ startDate: '2026-12-05', endDate: '2026-12-05' }, '2026-12-05');
  assert.deepEqual(empty.days[0].stops, []);
  assert.deepEqual(empty.days[0].planned, { minor: 0, count: 0 });
});

// Found in the 6.0b regression run: calendar days reused the itinerary's .stop classes, so every
// document-wide ".stop" count (stage 3, transfers TB-3, qa-live) also counted the 30 hidden days.
import { readText } from './helpers.js';
test('6.0b: the calendar screen uses its own class names, never the itinerary .stop / .stop-* ones', () => {
  const view = readText('src/js/calendar-view.js');
  const classes = [...view.matchAll(/el\('[a-z0-9]+', `?([^'`]*)[`']/g)].map((m) => m[1]);
  assert.ok(classes.length > 5);
  assert.deepEqual(classes.filter((c) => /(^|\s)stops?(-|\s|$)/.test(c)), []);
  const html = readText('index.html');
  const panel = html.slice(html.indexOf('id="panel-calendar"'), html.indexOf('</section>', html.indexOf('data-slot="cal-days"')));
  assert.doesNotMatch(panel, /class="[^"]*\bstops?\b/);
});
