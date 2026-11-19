// Route and dates (Stage 3, feature 1). Pure functions, no DOM; tested in tests/itinerary.test.js.
// A stop is { id, name, startDate, endDate, note, flexible?, nightsRange? }. Dates are "YYYY-MM-DD" strings.
// Nights are always derived from the dates and never stored, so they cannot disagree.
import { isIsoDate, daysBetween } from './trip.js';

export const MAX_NAME = 60;
export const MAX_NOTE = 140;

/** "YYYY-MM-DD" plus n calendar days (n may be negative). */
export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export const nightsOf = (s) => daysBetween(s.startDate, s.endDate);

/** A copy sorted by arrival, then departure; equal stops keep their saved order. */
export function sortStops(stops) {
  return stops
    .map((s, i) => [s, i])
    .sort(([a, i], [b, j]) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate) || i - j)
    .map(([s]) => s);
}

export const totalNights = (stops) => stops.reduce((sum, s) => sum + nightsOf(s), 0);

/** Problems with a stop, as message keys. Empty array = valid. */
export function validateStop({ name, startDate, endDate, note } = {}) {
  const errors = [];
  const n = String(name ?? '').trim();
  if (!n) errors.push('name.missing');
  else if (n.length > MAX_NAME) errors.push('name.tooLong');
  if (!startDate) errors.push('start.missing');
  else if (!isIsoDate(startDate)) errors.push('start.invalid');
  if (!endDate) errors.push('end.missing');
  else if (!isIsoDate(endDate)) errors.push('end.invalid');
  if (String(note ?? '').trim().length > MAX_NOTE) errors.push('note.tooLong');
  if (errors.length) return errors;
  if (daysBetween(startDate, endDate) < 0) return ['end.beforeStart'];
  return [];
}

/** Only the known fields, trimmed. */
export function cleanStop(s) {
  const out = { id: s.id, name: String(s.name).trim(), startDate: s.startDate, endDate: s.endDate, note: String(s.note ?? '').trim() };
  if (s.flexible) {
    out.flexible = true;
    if (Array.isArray(s.nightsRange) && s.nightsRange.length === 2) out.nightsRange = [...s.nightsRange];
  }
  return out;
}

/** Two stays overlap when they share a night. Leaving and arriving on the same day is a normal travel day. */
const overlap = (a, b) => a.startDate < b.endDate && b.startDate < a.endDate;

/** Ids of stops that share a night with another stop. */
export function findOverlaps(stops) {
  const ids = new Set();
  for (let i = 0; i < stops.length; i++) {
    for (let j = i + 1; j < stops.length; j++) {
      if (overlap(stops[i], stops[j])) { ids.add(stops[i].id); ids.add(stops[j].id); }
    }
  }
  return ids;
}

/** The other stops that a (new or edited) stop would overlap. */
export function overlapsFor(candidate, stops) {
  return sortStops(stops.filter((s) => s.id !== candidate.id && overlap(candidate, s)));
}

/** Ids of stops that start before or end after the trip dates. Nothing to compare when the trip has no dates. */
export function outsideTrip(stops, { startDate, endDate } = {}) {
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) return [];
  return sortStops(stops).filter((s) => s.startDate < startDate || s.endDate > endDate).map((s) => s.id);
}

/**
 * Where the traveler is on a calendar date (the destination's "today").
 * A travel day belongs to the stop that starts that day; the last day of a stop is "leaving".
 */
export function whereToday(stops, today) {
  if (!stops.length) return { phase: 'empty' };
  const list = sortStops(stops);
  const first = list[0];
  const lastEnd = list.reduce((m, s) => (s.endDate > m ? s.endDate : m), first.endDate);
  if (today < first.startDate) return { phase: 'before', daysToGo: daysBetween(today, first.startDate), nextId: first.id };
  if (today > lastEnd) return { phase: 'after' };
  const here = list.filter((s) => s.startDate <= today && today <= s.endDate);
  const staying = here.filter((s) => today < s.endDate);
  const s = (staying.length ? staying : here).at(-1);
  if (!s) return { phase: 'between', nextId: list.find((x) => x.startDate > today).id };
  const nights = nightsOf(s);
  return { phase: 'during', stopId: s.id, night: Math.min(daysBetween(s.startDate, today) + 1, nights), nights, leaving: today === s.endDate };
}

/**
 * First open: put the country pack's stops into an empty route, once.
 * If the traveler later empties the route, it stays empty (itinerarySeeded is remembered).
 */
export function seedIfNeeded(trip, packStops, locale, makeId) {
  if (trip.itinerarySeeded || (trip.destinations?.length ?? 0) > 0 || !Array.isArray(packStops)) return false;
  trip.destinations = packStops.map((p) => cleanStop({
    id: makeId(),
    name: p.name?.[locale] ?? p.name?.en ?? p.id,
    startDate: p.startDate,
    endDate: p.endDate,
    note: '',
    flexible: p.flexible,
    nightsRange: p.nightsRange,
  }));
  trip.itinerarySeeded = true;
  return true;
}

/** Lay stops out back to back from a first day, each keeping its nights. */
function chain(stops, from) {
  let cursor = from;
  return stops.map((s) => {
    const end = addDays(cursor, nightsOf(s));
    const out = { ...s, startDate: cursor, endDate: end };
    cursor = end;
    return out;
  });
}

/**
 * Move a stop one place earlier (-1) or later (+1). Every stop keeps its nights and the route
 * is laid out again from the same first day. Returns null when the move is not possible.
 */
export function moveStop(stops, id, dir) {
  const list = sortStops(stops);
  const i = list.findIndex((s) => s.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return null;
  const from = list[0].startDate;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return chain(next, from);
}

const shiftBy = (stops, days) => stops.map((s) => ({ ...s, startDate: addDays(s.startDate, days), endDate: addDays(s.endDate, days) }));

/**
 * The three ways to follow a change of the trip dates. Nothing is applied here; the screen shows a preview.
 * - shift: the whole route moves so it starts on the new first day.
 * - fit: like shift, and the flexible stop gains or loses nights so the route ends on the new last day.
 * - datesOnly: only the trip dates change; stops outside them are listed as warnings.
 */
export function replanOptions(stops, { start, end }) {
  const list = sortStops(stops);
  const range = { startDate: start, endDate: end };
  if (!list.length) return { needed: false };
  const firstStart = list[0].startDate;
  const lastEnd = list.reduce((m, s) => (s.endDate > m ? s.endDate : m), list[0].endDate);
  const needed = firstStart !== start || lastEnd !== end;

  const shifted = shiftBy(list, daysBetween(firstStart, start));
  const shift = { stops: shifted, outside: outsideTrip(shifted, range) };

  let fit;
  const flexIndex = shifted.findIndex((s) => s.flexible);
  const diff = daysBetween(start, end) - daysBetween(firstStart, lastEnd);
  if (flexIndex < 0) fit = { ok: false, reason: 'noFlexible' };
  else {
    const flex = shifted[flexIndex];
    const [min, max] = Array.isArray(flex.nightsRange) ? flex.nightsRange : [0, Infinity];
    const nights = nightsOf(flex) + diff;
    if (nights < min || nights > max) fit = { ok: false, reason: 'flexRange', min, max, name: flex.name };
    else {
      const out = shifted.map((s, k) => {
        if (k < flexIndex || s.startDate < flex.startDate) return s;
        if (k === flexIndex) return { ...s, endDate: addDays(s.endDate, diff) };
        return { ...s, startDate: addDays(s.startDate, diff), endDate: addDays(s.endDate, diff) };
      });
      fit = { ok: true, stops: out, outside: outsideTrip(out, range) };
    }
  }

  const datesOnly = { stops: list, outside: outsideTrip(list, range) };
  return { needed, shift, fit, datesOnly };
}

/** Rows for the "was / will be" preview, in the new order. */
export function diffStops(before, after) {
  const old = new Map(before.map((s) => [s.id, s]));
  const pick = (s) => ({ startDate: s.startDate, endDate: s.endDate, nights: nightsOf(s) });
  return sortStops(after).map((s) => {
    const was = old.get(s.id) ?? s;
    return { id: s.id, name: s.name, from: pick(was), to: pick(s), changed: was.startDate !== s.startDate || was.endDate !== s.endDate };
  });
}

/** True when a stored stop has the right shape (used by the schema check). */
export function isStop(s) {
  return s !== null && typeof s === 'object' && typeof s.id === 'string' && s.id !== '' && typeof s.name === 'string'
    && isIsoDate(s.startDate) && isIsoDate(s.endDate) && daysBetween(s.startDate, s.endDate) >= 0
    && (s.note === undefined || typeof s.note === 'string');
}
