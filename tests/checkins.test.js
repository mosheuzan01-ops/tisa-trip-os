// Stage 6.0d: check-in for flights and hotels, and time differences (docs/GOALS_STAGE6.md S6-6, S6-7, S6-8, S6-10, S6-11).
// Written before src/js/core/checkins.js and src/js/core/timezones.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHECKIN_KINDS, validateCheckin, makeCheckin, checkinState, dueCheckins, checkinsOnDay, cleanCheckins, sortCheckins,
} from '../src/js/core/checkins.js';
import { zoneOffsetMinutes, zoneDiffMinutes, convertLocal } from '../src/js/core/timezones.js';
import { removeTransfer } from '../src/js/core/transfers.js';
import { buildCalendar } from '../src/js/core/calendar.js';
import { readText, readJson } from './helpers.js';
import fs from 'node:fs';
import path from 'node:path';

const BKK = 'Asia/Bangkok';
const TLV = 'Asia/Jerusalem';
const input = (o) => ({ kind: 'flight', title: 'טיסה לבנגקוק', date: '2026-12-04', time: '', zone: TLV, booking: '', link: '', note: '', transferId: '', stopId: '', ...o });
let n = 0;
const id = () => `c${++n}`;

// The zones come from data (G11): the country file and the home zone in the config.
const ZONES = [readJson('data/countries/th.json').timeZone, readJson('config/app.config.json').homeTimeZone];
const check = (i) => validateCheckin(i, ZONES);

test('S6-6: kinds are flight or hotel; the two zones come from the data, Thailand and Israel', () => {
  assert.deepEqual(CHECKIN_KINDS, ['flight', 'hotel']);
  assert.deepEqual(ZONES, [BKK, TLV]);
});

test('S6-6: every field is checked; date is required, time is not', () => {
  assert.deepEqual(check(input({})), []);
  assert.deepEqual(check(input({ time: '06:45' })), []);
  assert.deepEqual(check(input({ kind: 'train' })), ['kind.invalid']);
  assert.deepEqual(check(input({ title: '  ' })), ['title.missing']);
  assert.deepEqual(check(input({ title: 'x'.repeat(61) })), ['title.tooLong']);
  assert.deepEqual(check(input({ date: '' })), ['date.missing']);
  assert.deepEqual(check(input({ date: '2026-02-30' })), ['date.invalid']);
  for (const bad of ['24:00', '7:5', 'בוקר']) assert.deepEqual(check(input({ time: bad })), ['time.invalid'], bad);
  assert.deepEqual(check(input({ zone: 'Europe/London' })), ['zone.invalid']);
  assert.deepEqual(check(input({ booking: 'x'.repeat(41) })), ['booking.tooLong']);
  assert.deepEqual(check(input({ note: 'x'.repeat(141) })), ['note.tooLong']);
});

test('S6-6: a link is kept only if it starts with http:// or https://', () => {
  assert.deepEqual(check(input({ link: 'https://airline.example/checkin' })), []);
  assert.deepEqual(check(input({ link: 'http://hotel.example' })), []);
  for (const bad of ['javascript:alert(1)', 'www.example.com', 'ftp://x', 'https://a b']) {
    assert.deepEqual(check(input({ link: bad })), ['link.invalid'], bad);
  }
});

test('S6-6: a flight keeps only a flight link, a hotel only a stop; nothing is worked out (no opening time)', () => {
  const f = makeCheckin(input({ transferId: 't1', stopId: 'd1', time: '' }), id);
  assert.equal(f.transferId, 't1');
  assert.equal(f.stopId, null);
  assert.equal(f.time, '', 'no time stays empty: the screen says "not entered yet"');
  assert.equal(f.done, false);
  const h = makeCheckin(input({ kind: 'hotel', title: 'מלון', transferId: 't1', stopId: 'd1', zone: BKK }), id);
  assert.equal(h.transferId, null);
  assert.equal(h.stopId, 'd1');
  assert.deepEqual(Object.keys(f).sort(), ['booking', 'date', 'done', 'id', 'kind', 'link', 'note', 'stopId', 'time', 'title', 'transferId', 'zone']);
  const edited = makeCheckin(input({ title: 'שונה' }), id, { ...f, done: true });
  assert.equal(edited.id, f.id);
  assert.equal(edited.done, true, 'editing keeps "done"');
});

test('S6-7: the reminder follows the calendar of the zone that was entered', () => {
  const c = makeCheckin(input({ date: '2026-12-04', zone: TLV }), id);
  assert.equal(checkinState(c, new Date('2026-12-03T10:00:00Z')), 'upcoming');
  assert.equal(checkinState(c, new Date('2026-12-04T10:00:00Z')), 'today');
  assert.equal(checkinState(c, new Date('2026-12-05T10:00:00Z')), 'overdue');
  assert.equal(checkinState({ ...c, done: true }, new Date('2026-12-05T10:00:00Z')), 'done');
  // 23:30 in Israel on 3.12 is already 4.12 in Bangkok: an Israel-zone check-in is not due yet, a Bangkok one is.
  const late = new Date('2026-12-03T21:30:00Z');
  assert.equal(checkinState(c, late), 'upcoming');
  assert.equal(checkinState({ ...c, zone: BKK }, late), 'today');
});

test('S6-7: due check-ins are the open ones, today or past; done ones and later ones are left out', () => {
  const list = [
    makeCheckin(input({ title: 'א', date: '2026-12-04' }), id),
    makeCheckin(input({ title: 'ב', date: '2026-12-02' }), id),
    { ...makeCheckin(input({ title: 'ג', date: '2026-12-01' }), id), done: true },
    makeCheckin(input({ title: 'ד', date: '2026-12-09' }), id),
  ];
  const due = dueCheckins(list, new Date('2026-12-04T10:00:00Z'));
  assert.deepEqual(due.today.map((x) => x.title), ['א']);
  assert.deepEqual(due.overdue.map((x) => x.title), ['ב']);
});

test('S6-7: no push or system notifications anywhere in the code', () => {
  const files = [];
  const walk = (dir) => { for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.js$/.test(f)) files.push(p); } };
  walk('src/js');
  files.push('sw.js');
  for (const f of files) assert.doesNotMatch(readText(f), /\bNotification\b|PushManager|showNotification|pushManager/, f);
});

test('order, the calendar day, and broken entries', () => {
  const a = makeCheckin(input({ title: 'א', date: '2026-12-05', time: '14:00', kind: 'hotel', zone: BKK }), id);
  const b = makeCheckin(input({ title: 'ב', date: '2026-12-05', time: '' }), id);
  const c = makeCheckin(input({ title: 'ג', date: '2026-12-04', time: '09:00' }), id);
  assert.deepEqual(sortCheckins([a, b, c]).map((x) => x.title), ['ג', 'ב', 'א']);
  assert.deepEqual(checkinsOnDay([a, b, c, null, { id: 'x' }], '2026-12-05').map((x) => x.title), ['ב', 'א']);
  assert.equal(cleanCheckins([a, null, { id: 'x', kind: 'boat' }, 'y']).length, 1);
  const cal = buildCalendar({ startDate: '2026-12-04', endDate: '2026-12-05', checkins: [a, b, c] }, '2026-12-04');
  assert.deepEqual(cal.days[1].checkins.map((x) => x.title), ['ב', 'א']);
  assert.deepEqual(buildCalendar({ startDate: '2026-12-04', endDate: '2026-12-04' }, '2026-12-04').days[0].checkins, []);
});

test('S6-10: deleting a flight unlinks its check-in and never deletes it', () => {
  const trip = {
    transfers: [{ id: 't1', kind: 'flight', date: '2026-12-05', expenseId: null }, { id: 't2', kind: 'bus', date: '2026-12-08', expenseId: null }],
    expenses: [],
    checkins: [makeCheckin(input({ transferId: 't1' }), id), makeCheckin(input({ transferId: 't2', title: 'אחר' }), id)],
  };
  const out = removeTransfer(trip, 't1', false);
  assert.equal(out.checkins.length, 2);
  assert.equal(out.checkins[0].transferId, null);
  assert.equal(out.checkins[0].title, 'טיסה לבנגקוק');
  assert.equal(out.checkins[1].transferId, 't2');
  assert.equal(trip.checkins[0].transferId, 't1', 'the trip given is not changed');
});

// ---------- S6-8: time differences, from the device's time-zone data ----------
test('S6-8: the offset of a zone comes from Intl, for a given moment', () => {
  assert.equal(zoneOffsetMinutes(BKK, new Date('2026-12-15T12:00:00Z')), 7 * 60);
  assert.equal(zoneOffsetMinutes(TLV, new Date('2026-12-15T12:00:00Z')), 2 * 60, 'Israel winter time');
  assert.equal(zoneOffsetMinutes(TLV, new Date('2026-07-15T12:00:00Z')), 3 * 60, 'Israel summer time');
  assert.equal(zoneOffsetMinutes('Not/AZone', new Date()), null, 'unknown zone: no number');
});

test('S6-8: the difference depends on the date: winter and summer in Israel give different answers', () => {
  const winter = zoneDiffMinutes('2026-12-15', BKK, TLV);
  const summer = zoneDiffMinutes('2026-07-15', BKK, TLV);
  assert.equal(winter, 5 * 60);
  assert.equal(summer, 4 * 60);
  assert.notEqual(winter, summer);
  assert.equal(zoneDiffMinutes('2026-12-15', BKK, 'Not/AZone'), null);
  assert.equal(zoneDiffMinutes('bad', BKK, TLV), null);
});

test('S6-8: a time entered in one zone is shown in the other, across midnight too', () => {
  assert.deepEqual(convertLocal('2026-12-04', '06:45', TLV, BKK), { date: '2026-12-04', time: '11:45' });
  assert.deepEqual(convertLocal('2026-12-04', '21:30', TLV, BKK), { date: '2026-12-05', time: '02:30' });
  assert.deepEqual(convertLocal('2026-12-05', '02:30', BKK, TLV), { date: '2026-12-04', time: '21:30' });
  assert.deepEqual(convertLocal('2026-07-04', '06:45', TLV, BKK), { date: '2026-07-04', time: '10:45' }, 'summer: one hour less');
  assert.equal(convertLocal('2026-12-04', '', TLV, BKK), null, 'no time: nothing to convert');
  assert.equal(convertLocal('2026-12-04', '06:45', TLV, 'Not/AZone'), null);
});

test('S6-8 / S6-11: no fixed time difference in the app code, data or texts', () => {
  const sources = ['src/js/core/timezones.js', 'src/js/core/checkins.js', 'src/js/transfers-view.js', 'src/js/checkins-view.js', 'src/js/calendar-view.js', 'src/js/assistant-view.js', 'locales/he.json', 'locales/en.json', 'data/packs/th.js'];
  for (const f of sources) {
    const s = readText(f);
    assert.doesNotMatch(s, /UTC\s*[+-]\s*\d|GMT\s*[+-]\s*\d|[+-]0?[2-7]:00\b/, `${f}: a fixed offset`);
    assert.doesNotMatch(s, /\b[45]\s*(שעות|hours)\b/, `${f}: a fixed difference in hours`);
  }
});
