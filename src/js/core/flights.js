// Stage 9 PR 2: import flights from a latisa-flights file. Pure functions, no DOM. Tested in tests/stage9-flights.test.js.
// Safe to run again and again: a flight whose number and date are already in the trip (or earlier in the same file)
// is skipped and never overwritten or updated. Bad entries are skipped with a reason. Nothing else in the trip changes.
// File: { "format": "latisa-flights", "version": 1, "flights": [ { flightNo, from, to, date, time?, company?, booking?,
//   status?, ticket?, price?, currency?, seat?, seatPrice?, link?, note? } ] }  (docs/FLIGHTS_FORMAT.md)
import { validateTransfer, saveTransfer, flightKey } from './transfers.js';

export const FLIGHTS_FORMAT = 'latisa-flights';
export const FLIGHTS_VERSION = 1;
const FIELDS = ['flightNo', 'from', 'to', 'date', 'time', 'company', 'booking', 'status', 'ticket', 'price', 'currency', 'seat', 'seatPrice', 'link', 'note'];

/** Check the file text. Never throws. */
export function parseFlightsFile(text) {
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, error: 'empty' };
  let file;
  try { file = JSON.parse(text); } catch { return { ok: false, error: 'notJson' }; }
  if (!file || typeof file !== 'object' || Array.isArray(file) || file.format !== FLIGHTS_FORMAT) return { ok: false, error: 'format' };
  if (Number.isInteger(file.version) && file.version > FLIGHTS_VERSION) return { ok: false, error: 'future' };
  if (file.version !== FLIGHTS_VERSION || !Array.isArray(file.flights)) return { ok: false, error: 'structure' };
  return { ok: true, flights: file.flights };
}

/** One file entry -> the input the flight form would send. Numbers are accepted as text. */
function toInput(x, defaultCurrency) {
  const str = (v) => (v === undefined || v === null ? '' : String(v));
  const input = Object.fromEntries(FIELDS.map((k) => [k, str(x[k])]));
  return { ...input, kind: 'flight', status: input.status || 'planned', ticket: input.ticket || 'oneway', currency: input.currency || defaultCurrency };
}

/**
 * Add the new flights of a file to a trip. Returns a new trip; the given one is not changed.
 * @returns {{ trip, added: number, duplicates: {index, flightNo, date}[], invalid: {index, errors}[] }}
 */
export function importFlights(trip, flights, { rates, currencies, makeId }) {
  let next = { ...trip, transfers: [...(trip.transfers ?? [])], expenses: [...(trip.expenses ?? [])] };
  const seen = new Set(next.transfers.map(flightKey).filter(Boolean));
  const duplicates = [];
  const invalid = [];
  let added = 0;
  (Array.isArray(flights) ? flights : []).forEach((x, index) => {
    if (!x || typeof x !== 'object' || Array.isArray(x)) { invalid.push({ index, errors: ['entry.invalid'] }); return; }
    const input = toInput(x, currencies[0]);
    const errors = validateTransfer(input, currencies);
    if (!input.flightNo.trim()) errors.unshift('flightNo.missing');
    if (errors.length) { invalid.push({ index, errors }); return; }
    const key = flightKey(input);
    if (seen.has(key)) { duplicates.push({ index, flightNo: input.flightNo, date: input.date }); return; }
    seen.add(key);
    next = saveTransfer(next, input, null, rates, makeId);
    added += 1;
  });
  return { trip: next, added, duplicates, invalid };
}
