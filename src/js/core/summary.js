// Stage 7 trip summary and budget table. Every money figure comes from summarize() in core/money.js, the same
// function the money screen uses: nothing here adds expenses up again. Pure functions; tests/stage7-core.test.js.
import { isIsoDate, daysBetween } from './trip.js';
import { sortStops, cleanStops, stopNights } from './itinerary.js';
import { cleanPhotos } from './photos.js';

/** Days, places reached by `today` (trip order), money by category, and the photo count. */
export function tripSummary(trip, money, today) {
  const hasDates = isIsoDate(trip?.startDate) && isIsoDate(trip?.endDate);
  const places = sortStops(cleanStops(trip?.destinations))
    .filter((x) => x.startDate <= today)
    .map((x) => ({ id: x.id, name: x.name, startDate: x.startDate, endDate: x.endDate, nights: stopNights(x) }));
  return {
    days: hasDates ? daysBetween(trip.startDate, trip.endDate) + 1 : null,
    places,
    spentMinor: money.paidMinor + money.plannedMinor + money.committedMinor + money.emergency.usedMinor,
    categories: money.categories.filter((c) => c.usedMinor > 0).sort((a, b) => b.usedMinor - a.usedMinor),
    emergency: money.emergency,
    photos: cleanPhotos(trip?.photos).length,
  };
}

/** Planned against actual for each category, split paid / planned / future / free. The total row is the money summary. */
export function budgetTable(money) {
  const rows = money.categories.map((c) => ({
    id: c.id,
    planMinor: c.planMinor,
    paidMinor: c.paidMinor,
    plannedMinor: c.plannedMinor,
    committedMinor: c.committedMinor,
    freeMinor: c.leftMinor,
    over: c.over,
  }));
  return {
    rows,
    total: {
      planMinor: money.totalMinor,
      paidMinor: money.paidMinor,
      plannedMinor: money.plannedMinor,
      committedMinor: money.committedMinor,
      freeMinor: money.freeMinor,
      over: money.freeMinor < 0,
    },
    emergency: money.emergency,
  };
}
