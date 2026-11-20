// Stage 6.0c: the journal, one note per day (docs/GOALS_STAGE6.md S6-5). Written before src/js/core/journal.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOTE_MAX, validateNote, noteOf, setNote, removeNote, cleanJournal } from '../src/js/core/journal.js';
import { buildCalendar } from '../src/js/core/calendar.js';

const AT = '2026-12-06T15:00:00.000Z';

test('S6-5: a note is checked for length only; an empty note is not an error here', () => {
  assert.equal(NOTE_MAX, 1000);
  assert.deepEqual(validateNote('שוק צף, אוכל טוב'), []);
  assert.deepEqual(validateNote('x'.repeat(NOTE_MAX)), []);
  assert.deepEqual(validateNote('x'.repeat(NOTE_MAX + 1)), ['note.tooLong']);
  assert.deepEqual(validateNote(`  ${'x'.repeat(NOTE_MAX)}  `), [], 'spaces around do not count');
});

test('S6-5: writing a note keeps the text (trimmed, line breaks kept) and when it was saved', () => {
  const j = setNote({}, '2026-12-06', '  שוק צף\nאוכל טוב  ', AT);
  assert.deepEqual(j, { '2026-12-06': { note: 'שוק צף\nאוכל טוב', updatedAt: AT } });
  assert.equal(noteOf(j, '2026-12-06'), 'שוק צף\nאוכל טוב');
  assert.equal(noteOf(j, '2026-12-07'), '');
  assert.equal(noteOf(undefined, '2026-12-07'), '');
});

test('S6-5: editing changes only that day; the journal given is never changed', () => {
  const before = { '2026-12-05': { note: 'נחתנו', updatedAt: AT }, '2026-12-06': { note: 'ישן', updatedAt: AT } };
  const copy = structuredClone(before);
  const after = setNote(before, '2026-12-06', 'חדש', '2026-12-07T08:00:00.000Z');
  assert.deepEqual(before, copy);
  assert.deepEqual(after['2026-12-05'], before['2026-12-05']);
  assert.deepEqual(after['2026-12-06'], { note: 'חדש', updatedAt: '2026-12-07T08:00:00.000Z' });
});

test('S6-5: an empty note is never saved as an empty string', () => {
  assert.deepEqual(setNote({}, '2026-12-06', '   \n  ', AT), {});
  const j = { '2026-12-06': { note: 'ישן', updatedAt: AT } };
  assert.deepEqual(setNote(j, '2026-12-06', '', AT), j, 'an empty save does not delete: deleting asks first');
});

test('S6-5: a bad date or a too long note changes nothing', () => {
  const j = { '2026-12-06': { note: 'ישן', updatedAt: AT } };
  assert.deepEqual(setNote(j, '2026-13-01', 'x', AT), j);
  assert.deepEqual(setNote(j, 'today', 'x', AT), j);
  assert.deepEqual(setNote(j, '2026-12-06', 'x'.repeat(NOTE_MAX + 1), AT), j);
});

test('S6-10: removing a note removes that day only', () => {
  const j = { '2026-12-05': { note: 'נחתנו', updatedAt: AT }, '2026-12-06': { note: 'ישן', updatedAt: AT } };
  assert.deepEqual(removeNote(j, '2026-12-06'), { '2026-12-05': { note: 'נחתנו', updatedAt: AT } });
  assert.deepEqual(removeNote(j, '2026-12-09'), j);
  assert.equal(Object.keys(j).length, 2, 'the journal given is not changed');
});

test('broken entries are skipped on screen and left in the data', () => {
  const raw = { '2026-12-05': { note: 'נחתנו', updatedAt: AT }, '2026-12-06': 'text', bad: { note: 'x' }, '2026-12-07': { note: '' }, '2026-12-08': null };
  assert.deepEqual(Object.keys(cleanJournal(raw)), ['2026-12-05']);
  assert.deepEqual(cleanJournal(null), {});
  assert.equal(Object.keys(raw).length, 5);
});

test('S6-5: each calendar day carries its note; the destination comes from the itinerary, so moving a stop moves it', () => {
  const trip = {
    startDate: '2026-12-05', endDate: '2026-12-08',
    destinations: [{ id: 'd1', name: 'בנגקוק', startDate: '2026-12-05', endDate: '2026-12-07' }],
    journal: { '2026-12-06': { note: 'שוק צף', updatedAt: AT } },
  };
  const day = buildCalendar(trip, '2026-12-06').days[1];
  assert.equal(day.note, 'שוק צף');
  assert.deepEqual(day.stops.map((s) => s.name), ['בנגקוק']);
  assert.equal(buildCalendar(trip, '2026-12-06').days[0].note, '');
  const moved = { ...trip, destinations: [{ id: 'd1', name: 'פאי', startDate: '2026-12-05', endDate: '2026-12-07' }] };
  assert.deepEqual(buildCalendar(moved, '2026-12-06').days[1].stops.map((s) => s.name), ['פאי']);
  assert.equal(buildCalendar(moved, '2026-12-06').days[1].note, 'שוק צף', 'the note stays with its date');
});
