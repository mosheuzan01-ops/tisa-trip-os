// Stage 6.0d time differences. Every offset comes from the device's time-zone data (Intl), for a given moment,
// so Israel's summer time is handled and no fixed difference lives in the code. Unknown zone: null, never a guess.
import { isIsoDate } from './trip.js';

const pad = (n) => String(n).padStart(2, '0');

/** Minutes the zone is ahead of UTC at that moment, or null if this device does not know the zone. */
export function zoneOffsetMinutes(zone, instant) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    }).formatToParts(instant);
  } catch { return null; }
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  const at = Math.floor(instant.getTime() / 1000) * 1000;
  return Math.round((local - at) / 60000);
}

/** How many minutes zone a is ahead of zone b on that calendar date (at noon UTC), or null. */
export function zoneDiffMinutes(date, a, b) {
  if (!isIsoDate(date)) return null;
  const noon = new Date(`${date}T12:00:00Z`);
  const oa = zoneOffsetMinutes(a, noon);
  const ob = zoneOffsetMinutes(b, noon);
  return oa === null || ob === null ? null : oa - ob;
}

/** A local date and time in one zone, as the local date and time in another. No time, or an unknown zone: null. */
export function convertLocal(date, time, fromZone, toZone) {
  if (!isIsoDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time ?? '')) return null;
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  // The offset at the guessed moment, then once more at the corrected one (right across a change of clocks).
  let off = zoneOffsetMinutes(fromZone, new Date(wall));
  if (off === null) return null;
  off = zoneOffsetMinutes(fromZone, new Date(wall - off * 60000));
  const instant = new Date(wall - off * 60000);
  const to = zoneOffsetMinutes(toZone, instant);
  if (to === null) return null;
  const there = new Date(instant.getTime() + to * 60000);
  return {
    date: `${there.getUTCFullYear()}-${pad(there.getUTCMonth() + 1)}-${pad(there.getUTCDate())}`,
    time: `${pad(there.getUTCHours())}:${pad(there.getUTCMinutes())}`,
  };
}
