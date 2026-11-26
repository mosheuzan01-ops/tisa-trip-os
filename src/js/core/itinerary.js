// Stage 3 itinerary logic: stops, nights, "where am I today", reorder and replanning. Pure functions, no DOM.
// A stop is { id, name, startDate, endDate, note, flexible?, nightsRange? }. Dates are "YYYY-MM-DD" calendar strings.
// Every function returns new objects; nothing here changes the data it is given. Tested in tests/itinerary.test.js.
import { isIsoDate, daysBetween, validateDates } from './trip.js';

export const NAME_MAX = 60;
export const NOTE_MAX = 140;

/** "YYYY-MM-DD" plus n calendar days. */
export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const validRange = (x) => isIsoDate(x?.startDate) && isIsoDate(x?.endDate) && daysBetween(x.startDate, x.endDate) >= 0;

/** Nights at a stop: one per calendar day from arrival to departure. A day visit has none. */
export const stopNights = (stop) => (validRange(stop) ? daysBetween(stop.startDate, stop.endDate) : 0);

export const totalNights = (stops = []) => stops.reduce((sum, x) => sum + stopNights(x), 0);

const byDate = (a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : a.endDate < b.endDate ? -1 : a.endDate > b.endDate ? 1 : 0);

/** Stops in trip order: by arrival, then by departure. Stable, returns a new array. */
export const sortStops = (stops = []) => [...stops].sort(byDate);

/** Stops that can be shown and counted. Broken entries stay in the saved data; they are only skipped on screen. */
export const cleanStops = (stops) => (Array.isArray(stops)
  ? stops.filter((x) => x && typeof x === 'object' && typeof x.id === 'string' && typeof x.name === 'string' && validRange(x))
  : []);

/** Problems with a stop, as message keys. Empty array = valid. */
export function validateStop({ name, startDate, endDate, note } = {}) {
  const errors = [];
  const n = String(name ?? '').trim();
  if (!n) errors.push('name.missing');
  else if (n.length > NAME_MAX) errors.push('name.tooLong');
  const dates = validateDates({ start: startDate, end: endDate }).filter((e) => e !== 'range.tooLong');
  errors.push(...dates);
  if (String(note ?? '').trim().length > NOTE_MAX) errors.push('note.tooLong');
  return errors;
}

/** Pairs of stop ids whose stays overlap. Leaving and arriving on the same day is not an overlap. */
export function findOverlaps(stops = []) {
  const list = sortStops(stops);
  const pairs = [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length && list[j].startDate < list[i].endDate; j += 1) {
      pairs.push([list[i].id, list[j].id]);
    }
  }
  return pairs;
}

/** Ids of stops that start before or end after the trip dates. */
export function stopsOutsideTrip(stops = [], trip) {
  if (!trip || !isIsoDate(trip.start) || !isIsoDate(trip.end)) return [];
  return sortStops(stops).filter((x) => x.startDate < trip.start || x.endDate > trip.end).map((x) => x.id);
}

/** Where the traveller is on a given day. On a travel day the arrival stop wins; the last day is still the trip. */
export function whereToday(stops, today) {
  const list = sortStops(cleanStops(stops));
  if (!list.length) return { phase: 'empty' };
  const here = list.filter((x) => x.startDate <= today && today <= x.endDate).pop();
  if (here) return { phase: 'during', currentId: here.id };
  const next = list.find((x) => x.startDate > today);
  if (!next) return { phase: 'after' };
  const phase = today < list[0].startDate ? 'before' : 'between';
  return { phase, nextId: next.id, daysToGo: daysBetween(today, next.startDate) };
}

/**
 * 1.2.0 departures board: each stop's status for today, by id: 'now' (the stop whereToday names), 'done' (every
 * stop before it in date order), 'ahead' (every stop after it). With no stop today: before the trip all 'ahead',
 * after it all 'done', between stops 'done' up to the next stop. Only dates; there is no booking status in the data.
 */
export function stopStatuses(stops, today) {
  const list = sortStops(cleanStops(stops));
  const where = whereToday(list, today);
  const out = {};
  if (where.phase === 'empty') return out;
  const pivotId = where.currentId ?? where.nextId;
  const k = pivotId == null ? list.length : list.findIndex((x) => x.id === pivotId);
  list.forEach((x, i) => { out[x.id] = i < k ? 'done' : (i === k && where.currentId ? 'now' : 'ahead'); });
  return out;
}

/**
 * Swap a stop with the one before (dir -1) or after (dir 1). Each keeps its nights; the pair starts where
 * the earlier one started, and any gap between them stays. Returns the new sorted list, or null if it cannot move.
 */
export function moveStop(stops, id, dir) {
  const list = sortStops(stops).map((x) => ({ ...x }));
  const i = list.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return null;
  const [first, second] = i < j ? [list[i], list[j]] : [list[j], list[i]];
  const gap = daysBetween(first.endDate, second.startDate);
  const start = first.startDate;
  const nightsFirst = stopNights(first);
  const nightsSecond = stopNights(second);
  second.startDate = start;
  second.endDate = addDays(start, nightsSecond);
  first.startDate = addDays(second.endDate, gap);
  first.endDate = addDays(first.startDate, nightsFirst);
  return sortStops(list);
}

const shiftStop = (x, days) => ({ ...x, startDate: addDays(x.startDate, days), endDate: addDays(x.endDate, days) });

function diff(before, after) {
  const old = new Map(before.map((x) => [x.id, x]));
  return after
    .filter((x) => old.get(x.id)?.startDate !== x.startDate || old.get(x.id)?.endDate !== x.endDate)
    .map((x) => ({
      id: x.id, name: x.name,
      before: { startDate: old.get(x.id).startDate, endDate: old.get(x.id).endDate },
      after: { startDate: x.startDate, endDate: x.endDate },
    }));
}

/**
 * Plan the stops for new trip dates. Nothing is saved here: the screen shows `changes` and saves only after a yes.
 * mode 'shift': every stop moves by the change in the start date.
 * mode 'flex': as 'shift', and the flexible stop absorbs the change in length (within its nightsRange).
 * mode 'datesOnly': stops stay; stops outside the new dates are reported.
 * @returns {{ ok: true, stops, changes, warnings, outside } | { ok: false, error }}
 */
export function replan(stops, oldDates, newDates, mode) {
  const bad = validateDates(newDates ?? {});
  if (bad.length) return { ok: false, error: bad[0] };
  const list = sortStops(cleanStops(stops));
  const anchor = oldDates && isIsoDate(oldDates.start) ? oldDates.start : list[0]?.startDate ?? newDates.start;
  const shift = daysBetween(anchor, newDates.start);
  let next = list;
  if (mode === 'shift' || mode === 'flex') next = list.map((x) => shiftStop(x, shift));
  if (mode === 'flex') {
    const i = next.findIndex((x) => x.flexible);
    if (i < 0) return { ok: false, error: 'flex.none' };
    const lastEnd = next.length ? next[next.length - 1].endDate : newDates.end;
    const delta = daysBetween(lastEnd, newDates.end);
    const flex = next[i];
    const nights = stopNights(flex) + delta;
    const [min, max] = Array.isArray(flex.nightsRange) ? flex.nightsRange : [stopNights(flex), stopNights(flex)];
    if (nights < min || nights > max) return { ok: false, error: 'flex.outOfRange' };
    next = next.map((x, k) => (k < i ? x : k === i ? { ...x, endDate: addDays(x.endDate, delta) } : shiftStop(x, delta)));
  }
  const outside = stopsOutsideTrip(next, newDates);
  const warnings = [];
  if (mode === 'shift' && oldDates && isIsoDate(oldDates.start) && isIsoDate(oldDates.end)
    && daysBetween(oldDates.start, oldDates.end) !== daysBetween(newDates.start, newDates.end)) warnings.push('length.differs');
  if (outside.length) warnings.push('outside');
  return { ok: true, stops: next, changes: diff(list, next), warnings, outside };
}

/** The country pack's suggested route as editable stops. Used only when the user asks for it. */
export function seedFromPack(pack, locale, makeId) {
  return (pack?.destinations ?? []).map((d) => {
    const stop = { id: makeId(), name: d.name?.[locale] ?? d.name?.en ?? d.id, startDate: d.startDate, endDate: d.endDate, note: '' };
    if (d.flexible) { stop.flexible = true; stop.nightsRange = [...d.nightsRange]; }
    return stop;
  });
}

/** One display format for dates on every screen (Intl, no library). */
export function formatDate(iso, locale, opts = { day: 'numeric', month: 'short' }) {
  if (!isIsoDate(iso)) return '';
  return new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
}

export const formatRange = (stop, locale) => `${formatDate(stop.startDate, locale)} – ${formatDate(stop.endDate, locale)}`;
