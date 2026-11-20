// Stage 6.0b calendar: one entry per trip day, built only from the user's own data. Pure functions, no DOM.
// Tested in tests/calendar.test.js. Nothing is guessed: no dates means no days; no plan means zero, not a figure.
import { isIsoDate, daysBetween } from './trip.js';
import { addDays, sortStops, cleanStops } from './itinerary.js';
import { sortTransfers } from './transfers.js';
import { taskState, cleanTasks } from './checklist.js';
import { EMERGENCY } from './money.js';
import { noteOf } from './journal.js';

/** Every calendar day from start to end, both included. Missing or reversed dates give no days. */
export function tripDays(start, end) {
  if (!isIsoDate(start) || !isIsoDate(end)) return [];
  const n = daysBetween(start, end);
  if (!(n >= 0)) return [];
  return Array.from({ length: n + 1 }, (_, i) => addDays(start, i));
}

/** The stops of a day. A travel day lists the stop left first, then the stop arrived at. */
export function stopsOnDay(stops, day) {
  return sortStops(cleanStops(stops))
    .filter((x) => x.startDate <= day && day <= x.endDate)
    .map((x) => ({
      id: x.id,
      name: x.name,
      role: x.startDate === x.endDate ? 'day' : x.startDate === day ? 'arrive' : x.endDate === day ? 'leave' : 'stay',
    }))
    .sort((a, b) => (a.role === 'leave' ? -1 : b.role === 'leave' ? 1 : 0));
}

/** Transfers on a day, in the same order as the transfers screen (no time first, then by time). */
export const transfersOnDay = (transfers, day) => sortTransfers((Array.isArray(transfers) ? transfers : [])
  .filter((x) => x && typeof x.id === 'string' && x.date === day));

/** Tasks due on a day, each with its state by `today` (the Bangkok calendar date). */
export const tasksOnDay = (tasks, day, today) => cleanTasks(tasks)
  .filter((x) => x.due === day)
  .map((x) => ({ ...x, state: taskState(x, today) }));

/**
 * Planned for a day: expenses of that day that are "planned" or "future commitment", in shekel agorot.
 * Paid is never included (owner decision 2026-11-19). Same rule as the money screen's planned and committed
 * totals, emergency fund left out, so the days add up to those totals and nothing is counted twice.
 */
export function plannedForDay(expenses, day) {
  const list = (Array.isArray(expenses) ? expenses : []).filter((e) => e && Number.isInteger(e.baseMinor)
    && e.date === day && (e.status === 'planned' || e.status === 'committed') && e.category !== EMERGENCY);
  return { minor: list.reduce((n, e) => n + e.baseMinor, 0), count: list.length };
}

/** The whole calendar for a trip. `today` is the Bangkok calendar date. */
export function buildCalendar(trip, today) {
  const dates = tripDays(trip?.startDate, trip?.endDate);
  const days = dates.map((date, i) => ({
    date,
    n: i + 1,
    isToday: date === today,
    stops: stopsOnDay(trip.destinations, date),
    transfers: transfersOnDay(trip.transfers, date),
    tasks: tasksOnDay(trip.tasks, date, today),
    planned: plannedForDay(trip.expenses, date),
    note: noteOf(trip.journal, date),
  }));
  return { hasDates: dates.length > 0, days, todayIndex: dates.indexOf(today) };
}
