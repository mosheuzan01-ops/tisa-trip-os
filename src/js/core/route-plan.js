// Stage 9: a route SUGGESTION built from the trip dates the user enters (owner decisions, 2026-11-21).
// - The first night (departure day) is on the plane; the first stop starts the next day.
// - Bangkok first: 3 nights (2 when the trip has fewer than `shortBelow` lodging nights).
// - The last 3 dates in Bangkok: 2 nights, ending on the return date.
// - Southern islands in between, at least `minNights` each; the flexible stop is dropped first when short.
// - Koh Samui holds the night of 31.12 when the trip has it. When that cannot be done (31.12 on the plane or in
//   Bangkok), the route is still built and a warning says so: nothing is moved silently, nothing is invented.
// No prices, no ferry or flight times. Pure functions; tested in tests/stage9-data.test.js.
import { isIsoDate, daysBetween } from './trip.js';
import { addDays, totalNights } from './itinerary.js';

const label = (x, locale) => x.name?.[locale] ?? x.name?.en ?? x.id;

/** Split `total` nights over `weights`, at least `min` each, by largest remainder. Sums exactly to total. */
function allocate(weights, total, min) {
  const free = total - min * weights.length;
  const all = weights.reduce((s, w) => s + w, 0);
  const raw = weights.map((w) => (free * w) / all);
  const out = raw.map((r) => min + Math.floor(r));
  let left = total - out.reduce((s, v) => s + v, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left -= 1) out[order[k][1]] += 1;
  return out;
}

/** The offset (in nights from `from`) of the night of 31.12 if it falls in [from, to), else null. */
function newYearOffset(from, to) {
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y += 1) {
    const ny = `${y}-12-31`;
    if (from <= ny && ny < to) return daysBetween(from, ny);
  }
  return null;
}

/**
 * Nights for islands in a given order so that the 31.12 stop holds offset `d` (if given); null if impossible.
 * The 31.12 stop gets a start P and a length K closest to the plain split; the stops before and after it share
 * the rest by weight. Every stop keeps at least `min` nights.
 */
function fit(order, total, min, d) {
  const base = allocate(order.map((x) => x.weight), total, min);
  const k = order.findIndex((x) => x.newYear);
  if (d === null || k < 0) return base;
  const before = order.slice(0, k);
  const after = order.slice(k + 1);
  let best = null;
  for (let K = min; K <= total; K += 1) {
    for (let P = Math.max(0, d - K + 1); P <= d; P += 1) {
      const rest = total - P - K;
      const okBefore = before.length ? P >= min * before.length : P === 0;
      const okAfter = after.length ? rest >= min * after.length : rest === 0;
      if (!okBefore || !okAfter) continue;
      const nights = [
        ...(before.length ? allocate(before.map((x) => x.weight), P, min) : []),
        K,
        ...(after.length ? allocate(after.map((x) => x.weight), rest, min) : []),
      ];
      // Cost: how far every stop is from its planned share, so no single stop soaks up the change.
      const cost = nights.reduce((s, v, i) => s + (v - base[i]) ** 2, 0); // squared: spreads a change over several stops
      if (!best || cost < best.cost) best = { cost, nights };
    }
  }
  return best ? best.nights : null;
}

/**
 * The route for a trip. Returns { stops, warnings }. Stops are marked `suggested` (not booked).
 * Warnings: 'route.tooShort' (no stops made), 'newYear.notOnIsland' (31.12 falls on the plane or in Bangkok),
 * 'newYear.notPossible' (31.12 is on the islands but the nights cannot be arranged).
 */
export function planRoute(start, end, tpl, locale, makeId) {
  const warnings = [];
  if (!isIsoDate(start) || !isIsoDate(end) || !tpl?.start || !tpl?.end) return { stops: [], warnings: ['route.noDates'] };
  const nights = daysBetween(start, end);
  const plane = tpl.firstNightOnPlane ? 1 : 0;
  const lodging = nights - plane;
  const min = tpl.minNights ?? 2;
  const startNights = lodging < (tpl.start.shortBelow ?? 0) ? tpl.start.shortNights : tpl.start.nights;
  const endNights = tpl.end.nights;
  const islandsTotal = lodging - startNights - endNights;
  if (islandsTotal < min) return { stops: [], warnings: ['route.tooShort'] };

  // Islands that fit: drop flexible ones first, then the lightest, until everyone has the minimum.
  let pool = tpl.clusters.flat();
  while (pool.length * min > islandsTotal) {
    const flex = pool.filter((x) => x.flexible);
    const drop = flex.length ? flex[flex.length - 1] : [...pool].filter((x) => !x.newYear).sort((a, b) => a.weight - b.weight)[0];
    pool = pool.filter((x) => x !== drop);
  }
  const clusters = tpl.clusters.map((c) => c.filter((x) => pool.includes(x))).filter((c) => c.length);

  const tripStart = addDays(start, plane);
  const islandsFrom = addDays(tripStart, startNights);
  const islandsTo = addDays(end, -endNights);
  const nyTrip = newYearOffset(start, end);
  const nyIslands = newYearOffset(islandsFrom, islandsTo);
  if (nyTrip !== null && nyIslands === null) warnings.push('newYear.notOnIsland');

  // Try cluster orders (and the 31.12 stop first or later in its cluster); keep the first that works.
  const orders = [];
  for (const cs of [clusters, [...clusters].reverse()]) {
    orders.push(cs.flat());
    orders.push(cs.map((c) => (c.some((x) => x.newYear) ? [...c].reverse() : c)).flat());
  }
  // Of the orders that work, keep the one closest to the planned weights (least nights moved).
  let chosen = null;
  for (const order of orders) {
    const n = fit(order, islandsTotal, min, nyIslands);
    if (!n) continue;
    const base = allocate(order.map((x) => x.weight), islandsTotal, min);
    const moved = n.reduce((s, v, i) => s + (v - base[i]) ** 2, 0);
    if (!chosen || moved < chosen.moved) chosen = { order, nights: n, moved };
  }
  if (!chosen) {
    warnings.push('newYear.notPossible');
    const order = orders[0];
    chosen = { order, nights: allocate(order.map((x) => x.weight), islandsTotal, min) };
  }

  const stops = [];
  let cursor = tripStart;
  const push = (x, n, extra = {}) => {
    const stop = { id: makeId(), name: label(x, locale), startDate: cursor, endDate: addDays(cursor, n), note: '', suggested: true, ...extra };
    cursor = stop.endDate;
    stops.push(stop);
  };
  push(tpl.start, startNights);
  chosen.order.forEach((x, i) => {
    const extra = {};
    if (x.flexible) { extra.flexible = true; extra.nightsRange = [min, chosen.nights[i]]; }
    const coversNy = x.newYear && nyIslands !== null && !warnings.includes('newYear.notPossible');
    if (coversNy) extra.note = x.newYearNote?.[locale] ?? x.newYearNote?.en ?? '';
    push(x, chosen.nights[i], extra);
  });
  push(tpl.end, endNights, { note: tpl.end.note?.[locale] ?? tpl.end.note?.en ?? '' });
  return { stops, warnings };
}

/** Dates in the trip, nights, and nights with a stop (lodging). */
export function tripCounts(start, end, stops = []) {
  if (!isIsoDate(start) || !isIsoDate(end)) return null;
  const nights = daysBetween(start, end);
  return { dates: nights + 1, nights, lodgingNights: totalNights(stops) };
}
