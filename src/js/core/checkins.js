// Stage 6.0d check-in for flights and hotels, entered by hand. Pure functions, no DOM; tested in tests/checkins.test.js.
// Nothing is worked out: no opening time "24 hours before", no airline rule. A missing time stays empty
// and the screen says "not entered yet". Reminders are in the app only (no push, no system notification).
import { isIsoDate, todayIn } from './trip.js';

export const CHECKIN_KINDS = ['flight', 'hotel'];
// The zones a time can be entered in come from data (G11): the destination's zone (data/countries) and the
// home zone (config/app.config.json). They are passed in; none is written here.
const MAX = { title: 60, booking: 40, note: 140, link: 300 };

const txt = (v) => String(v ?? '').trim();

export function validateCheckin(input = {}, zones = []) {
  const errors = [];
  if (!CHECKIN_KINDS.includes(input.kind)) errors.push('kind.invalid');
  if (!txt(input.title)) errors.push('title.missing');
  else if (txt(input.title).length > MAX.title) errors.push('title.tooLong');
  if (!input.date) errors.push('date.missing');
  else if (!isIsoDate(input.date)) errors.push('date.invalid');
  if (input.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) errors.push('time.invalid');
  if (!zones.includes(input.zone)) errors.push('zone.invalid');
  for (const k of ['booking', 'note']) if (txt(input[k]).length > MAX[k]) errors.push(`${k}.tooLong`);
  const link = txt(input.link);
  if (link && (!/^https?:\/\/\S+$/i.test(link) || link.length > MAX.link)) errors.push('link.invalid');
  return errors;
}

export function makeCheckin(input, makeId, existing = null) {
  return {
    id: existing?.id ?? makeId(),
    kind: input.kind,
    title: txt(input.title),
    transferId: input.kind === 'flight' && input.transferId ? input.transferId : null,
    stopId: input.kind === 'hotel' && input.stopId ? input.stopId : null,
    date: input.date,
    time: input.time || '',
    zone: input.zone,
    booking: txt(input.booking),
    link: txt(input.link),
    note: txt(input.note),
    done: existing?.done === true,
  };
}

export const cleanCheckins = (list) => (Array.isArray(list)
  ? list.filter((x) => x && typeof x === 'object' && typeof x.id === 'string' && CHECKIN_KINDS.includes(x.kind) && isIsoDate(x.date) && typeof x.zone === 'string' && x.zone !== '')
  : []);

const key = (c) => `${c.date} ${c.time || '00:00'}`;
export const sortCheckins = (list = []) => [...list].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

/** done | overdue | today | upcoming, by the calendar of the zone the check-in was entered in. */
export function checkinState(c, now = new Date()) {
  if (c.done === true) return 'done';
  const today = todayIn(c.zone, now);
  if (c.date < today) return 'overdue';
  return c.date === today ? 'today' : 'upcoming';
}

/** Open check-ins that are due: today, or already past. */
export function dueCheckins(list, now = new Date()) {
  const out = { overdue: [], today: [] };
  for (const c of sortCheckins(cleanCheckins(list))) {
    const st = checkinState(c, now);
    if (st === 'overdue' || st === 'today') out[st].push(c);
  }
  return out;
}

export const checkinsOnDay = (list, day) => sortCheckins(cleanCheckins(list).filter((c) => c.date === day));
