// 0.5.4 rule-based assistant. Pure functions over the user's own data: no model, no network, no guesses.
// Every figure comes with the numbers it was made from, so the screen can show its assumptions.
// Tested in tests/assistant.test.js.
import { daysBetween } from './trip.js';
import { taskState } from './checklist.js';
import { sortStops, cleanStops } from './itinerary.js';
import { sortTransfers } from './transfers.js';

/** "Due soon" means due within this many days after today (shown to the user as an assumption). */
export const DUE_WINDOW_DAYS = 7;

/** Money: free before and after planning, per day, and what is over. level: ok | warn | over | noBudget. */
export function moneyAdvice(summary, daily, days) {
  if (!summary.hasBudget) {
    return { level: 'noBudget', freeBeforeMinor: null, freeAfterMinor: null, dailyMinor: null, days: days ?? null, overCategories: [], assumptions: null };
  }
  const overCategories = summary.categories.filter((c) => c.over).map((c) => c.id);
  const over = summary.freeMinor < 0;
  return {
    level: over ? 'over' : overCategories.length || summary.emergency?.over ? 'warn' : 'ok',
    freeBeforeMinor: summary.freeBeforePlanMinor,
    freeAfterMinor: summary.freeMinor,
    dailyMinor: daily.kind === 'ok' ? daily.minor : null,
    days: days ?? null,
    overCategories,
    assumptions: {
      totalMinor: summary.totalMinor, paidMinor: summary.paidMinor, plannedMinor: summary.plannedMinor, committedMinor: summary.committedMinor, days: days ?? null,
    },
  };
}

/** Open tasks with a due date: overdue, due today, and due within DUE_WINDOW_DAYS. Done and undated tasks are left out. */
export function dueTasks(tasks = [], today) {
  const out = { overdue: [], today: [], soon: [] };
  for (const t of tasks) {
    const st = taskState(t, today);
    if (st === 'overdue') out.overdue.push(t);
    else if (st === 'today') out.today.push(t);
    else if (st === 'upcoming' && daysBetween(today, t.due) <= DUE_WINDOW_DAYS) out.soon.push(t);
  }
  const byDue = (a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0);
  return { overdue: out.overdue.sort(byDue), today: out.today.sort(byDue), soon: out.soon.sort(byDue) };
}

/** Today: the stop (the arrival stop on a travel day), today's transfers, and the tasks that are due. */
export function todayAdvice({ stops = [], transfers = [], tasks = [], today }) {
  const stop = sortStops(cleanStops(stops)).filter((x) => x.startDate <= today && today <= x.endDate).pop() ?? null;
  const todays = sortTransfers(transfers.filter((x) => x && x.date === today));
  const due = dueTasks(tasks, today);
  return { stop, transfers: todays, due, nothing: !stop && !todays.length && !due.overdue.length && !due.today.length };
}
