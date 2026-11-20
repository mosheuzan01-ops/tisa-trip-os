// Stage 6.0c journal: one note per trip day, keyed by "YYYY-MM-DD". Pure functions, no DOM; tested in tests/journal.test.js.
// The destination is not stored with the note: the calendar takes it from the itinerary by date.
// An empty note is never stored, and an empty save never deletes: deleting is its own step, with a yes.
import { isIsoDate } from './trip.js';

export const NOTE_MAX = 1000;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => String(v ?? '').trim();

/** Problems with a note, as message keys. Empty is not an error here; the screen decides what an empty save means. */
export const validateNote = (note) => (text(note).length > NOTE_MAX ? ['note.tooLong'] : []);

/** Entries that can be shown. Broken ones stay in the saved data; they are only skipped. */
export function cleanJournal(journal) {
  if (!isObj(journal)) return {};
  return Object.fromEntries(Object.entries(journal)
    .filter(([date, e]) => isIsoDate(date) && isObj(e) && typeof e.note === 'string' && e.note.trim() !== ''));
}

/** The note of a day, or '' when there is none. */
export const noteOf = (journal, date) => cleanJournal(journal)[date]?.note ?? '';

/** A new journal with the day's note written. A bad date, a too long note or an empty note change nothing. */
export function setNote(journal, date, note, nowIso) {
  const base = isObj(journal) ? journal : {};
  const value = text(note);
  if (!isIsoDate(date) || value === '' || validateNote(value).length) return { ...base };
  return { ...base, [date]: { note: value, updatedAt: nowIso } };
}

/** A new journal without that day's note. */
export function removeNote(journal, date) {
  const { [date]: _gone, ...rest } = isObj(journal) ? journal : {};
  return rest;
}
