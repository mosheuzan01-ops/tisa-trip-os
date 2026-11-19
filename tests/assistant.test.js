// 0.5.4 rule-based assistant (docs/GOALS_STAGE5.md A-1..A-5). Only real data; every number shows how it was made.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moneyAdvice, todayAdvice, dueTasks, DUE_WINDOW_DAYS } from '../src/js/core/assistant.js';

const summary = { hasBudget: true, totalMinor: 1527000, paidMinor: 300000, plannedMinor: 200000, committedMinor: 100000, freeMinor: 927000, freeBeforePlanMinor: 1227000,
  categories: [{ id: 'food', planMinor: 210000, usedMinor: 250000, over: true }, { id: 'lodging', planMinor: 300000, usedMinor: 100000, over: false }],
  emergency: { planMinor: 250000, usedMinor: 0, leftMinor: 250000, over: false } };

test('A-1: money advice repeats the real figures and the arithmetic behind them', () => {
  const a = moneyAdvice(summary, { kind: 'ok', minor: 61800 }, 15);
  assert.deepEqual([a.freeBeforeMinor, a.freeAfterMinor, a.dailyMinor, a.days], [1227000, 927000, 61800, 15]);
  assert.deepEqual(a.overCategories, ['food']);
  assert.equal(a.level, 'warn', 'a category is over');
  assert.deepEqual(a.assumptions, { totalMinor: 1527000, paidMinor: 300000, plannedMinor: 200000, committedMinor: 100000, days: 15 });
});

test('A-1: over budget, no budget, and no dates are said plainly; nothing is guessed', () => {
  assert.equal(moneyAdvice({ ...summary, freeMinor: -5000, categories: [] }, { kind: 'over', minor: -5000 }, 10).level, 'over');
  const none = moneyAdvice({ hasBudget: false, totalMinor: 0, paidMinor: 0, plannedMinor: 0, committedMinor: 0, freeMinor: 0, freeBeforePlanMinor: 0, categories: [] }, { kind: 'ok', minor: 0 }, 10);
  assert.equal(none.level, 'noBudget');
  assert.equal(none.dailyMinor, null);
  const noDates = moneyAdvice({ ...summary, categories: [] }, { kind: 'noDates' }, null);
  assert.deepEqual([noDates.level, noDates.dailyMinor, noDates.days], ['ok', null, null]);
});

const tasks = [
  { id: 'a', title: 'ביטוח', status: 'open', due: '2026-12-01' },
  { id: 'b', title: 'לינה', status: 'doing', due: '2026-12-03' },
  { id: 'c', title: 'מעברים', status: 'open', due: '2026-12-09' },
  { id: 'd', title: 'מסמכים', status: 'done', due: '2026-11-30' },
  { id: 'e', title: 'בלי תאריך', status: 'open', due: null },
];

test('A-2: tasks due: overdue, today, and the next days in a stated window; done and undated are left out', () => {
  assert.equal(DUE_WINDOW_DAYS, 7);
  const d = dueTasks(tasks, '2026-12-03');
  assert.deepEqual(d.overdue.map((x) => x.id), ['a']);
  assert.deepEqual(d.today.map((x) => x.id), ['b']);
  assert.deepEqual(d.soon.map((x) => x.id), ['c'], 'within 7 days');
  assert.deepEqual(dueTasks(tasks, '2026-11-20').soon.map((x) => x.id), [], '9 days away is outside the window');
});

test('A-3: what to do today: the stop, the transfers and the tasks of that day, from real data only', () => {
  const stops = [{ id: 's1', name: 'בנגקוק', startDate: '2026-12-01', endDate: '2026-12-04' }, { id: 's2', name: 'פאי', startDate: '2026-12-04', endDate: '2026-12-06' }];
  const transfers = [{ id: 't1', from: 'בנגקוק', to: 'פאי', date: '2026-12-04', time: '09:00', kind: 'bus' }, { id: 't2', from: 'x', to: 'y', date: '2026-12-10', kind: 'bus' }];
  const t = todayAdvice({ stops, transfers, tasks, today: '2026-12-04' });
  assert.equal(t.stop.name, 'פאי', 'arrival day: the new stop');
  assert.deepEqual(t.transfers.map((x) => x.id), ['t1']);
  assert.deepEqual(t.due.overdue.map((x) => x.id), ['a', 'b']);
  const empty = todayAdvice({ stops: [], transfers: [], tasks: [], today: '2026-12-04' });
  assert.deepEqual([empty.stop, empty.transfers, empty.due.overdue, empty.nothing], [null, [], [], true]);
});
