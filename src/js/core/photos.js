// Stage 7 photos: metadata only (the image files live in IndexedDB, see src/js/photo-store.js). Pure functions, no DOM.
// A photo is { id, date, dateSource, stopId, caption, featured, width, height, bytes, addedAt }.
// Its place is worked out from the itinerary by date, unless the user picked a stop by hand. Nothing is guessed:
// no date means "no date", and a date with no stop means "not assigned". Tested in tests/stage7-core.test.js.
import { isIsoDate } from './trip.js';
import { whereToday, cleanStops, sortStops } from './itinerary.js';

export const MAX_SIDE = 1280; // long side after compression (owner, Stage 7 prompt)
export const THUMB_SIDE = 320;
export const TARGET_BYTES = 600 * 1024;
export const FEATURE_MAX = 12;
export const CAPTION_MAX = 140;
const MB = 1024 * 1024;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The size to draw at: the long side becomes `max`, the ratio is kept, and a small image is never enlarged. */
export function fitSize(width, height, max = MAX_SIDE) {
  const long = Math.max(width, height);
  if (long <= max) return { width, height };
  const k = max / long;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** "YYYY-MM-DD" from a JPEG's EXIF (DateTimeOriginal, else DateTime). null when there is none or it is unreadable. */
export function exifDate(input) {
  try {
    const b = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (b[0] !== 0xff || b[1] !== 0xd8) return null;
    let i = 2;
    while (i + 4 <= b.length && b[i] === 0xff) {
      const marker = b[i + 1];
      const len = (b[i + 2] << 8) | b[i + 3];
      if (marker === 0xda || marker === 0xd9) return null; // image data starts: no EXIF before it
      if (marker === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) {
        return readTiffDate(b, i + 10, Math.min(b.length, i + 2 + len));
      }
      i += 2 + len;
    }
    return null;
  } catch {
    return null;
  }
}

function readTiffDate(b, start, end) {
  const le = b[start] === 0x49;
  const u16 = (o) => (le ? b[start + o] | (b[start + o + 1] << 8) : (b[start + o] << 8) | b[start + o + 1]);
  const u32 = (o) => (le ? (b[start + o] | (b[start + o + 1] << 8) | (b[start + o + 2] << 16) | (b[start + o + 3] << 24)) >>> 0
    : ((b[start + o] << 24) | (b[start + o + 1] << 16) | (b[start + o + 2] << 8) | b[start + o + 3]) >>> 0);
  if (u16(2) !== 42) return null;
  const tags = (ifd) => {
    const out = new Map();
    if (start + ifd + 2 > end) return out;
    const n = u16(ifd);
    for (let k = 0; k < n; k += 1) {
      const e = ifd + 2 + k * 12;
      if (start + e + 12 > end) break;
      out.set(u16(e), { type: u16(e + 2), count: u32(e + 4), value: u32(e + 8) });
    }
    return out;
  };
  const text = (tag) => {
    if (!tag || tag.type !== 2 || tag.count < 10 || start + tag.value + 10 > end) return null;
    const s = String.fromCharCode(...b.subarray(start + tag.value, start + tag.value + 10));
    const m = /^(\d{4}):(\d{2}):(\d{2})$/.exec(s);
    const iso = m ? `${m[1]}-${m[2]}-${m[3]}` : null;
    return iso && isIsoDate(iso) ? iso : null;
  };
  const ifd0 = tags(u32(4));
  const exifPtr = ifd0.get(0x8769);
  const sub = exifPtr ? tags(exifPtr.value) : new Map();
  return text(sub.get(0x9003)) ?? text(ifd0.get(0x0132));
}

/** The photo's date: when it was taken (EXIF), else the file's date on the destination's calendar, else none. */
export function dateFromFile({ exif, lastModified, timeZone }) {
  if (isIsoDate(exif)) return { date: exif, dateSource: 'exif' };
  if (Number.isFinite(lastModified) && lastModified > 0) {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(lastModified));
    if (isIsoDate(date)) return { date, dateSource: 'file' };
  }
  return { date: null, dateSource: null };
}

/** A new photo record. No image data, ever: only what is needed to list and place it. */
export function makePhoto({ id, date = null, dateSource = null, width, height, bytes, addedAt, featured = false, caption = '', stopId = null }) {
  return { id, date: isIsoDate(date) ? date : null, dateSource: isIsoDate(date) ? dateSource : null, stopId, caption, featured: featured === true, width, height, bytes, addedAt };
}

/** Photos that can be shown. Broken entries stay in the saved data; they are only skipped. */
export const cleanPhotos = (list) => (Array.isArray(list) ? list.filter((x) => isObj(x) && typeof x.id === 'string' && x.id) : []);

/** Where a photo belongs: a stop picked by hand, the stop of its date, or not assigned (outside the route, or no date). */
export function placeOf(photo, trip) {
  const stops = cleanStops(trip?.destinations);
  const manual = photo?.stopId ? stops.find((x) => x.id === photo.stopId) : null;
  if (manual) return { kind: 'manual', stopId: manual.id, name: manual.name };
  if (!isIsoDate(photo?.date)) return { kind: 'noDate', stopId: null, name: null };
  const w = whereToday(stops, photo.date);
  if (w.phase === 'during') {
    const stop = stops.find((x) => x.id === w.currentId);
    return { kind: 'auto', stopId: stop.id, name: stop.name };
  }
  return { kind: 'outside', stopId: null, name: null };
}

const byDateThenAdded = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.addedAt) < String(b.addedAt) ? -1 : String(a.addedAt) > String(b.addedAt) ? 1 : 0);

/** Photos by day (trip order) and the ones not assigned to any stop. */
export function groupPhotos(trip) {
  const all = cleanPhotos(trip?.photos);
  const days = new Map();
  const unassigned = [];
  for (const p of [...all].sort((a, b) => byDateThenAdded({ ...a, date: a.date ?? '~' }, { ...b, date: b.date ?? '~' }))) { // no date last
    const place = placeOf(p, trip);
    if (!isIsoDate(p.date) || place.kind === 'outside') { unassigned.push(p); continue; } // a day needs a date
    if (!days.has(p.date)) days.set(p.date, []);
    days.get(p.date).push(p);
  }
  return { days: [...days.entries()].map(([date, photos]) => ({ date, photos })), unassigned, count: all.length };
}

/** Problems with a photo edit, as message keys. An empty date is allowed (it means "no date"). */
export function validatePhotoEdit({ date, caption } = {}) {
  const errors = [];
  if (date && !isIsoDate(date)) errors.push('date.invalid');
  if (String(caption ?? '').trim().length > CAPTION_MAX) errors.push('caption.tooLong');
  return errors;
}

/** A new list with the photo's date, stop and caption changed. A changed date becomes "manual". Bad input changes nothing. */
export function updatePhoto(photos, id, { date, stopId, caption } = {}) {
  if (validatePhotoEdit({ date, caption }).length) return photos;
  return photos.map((p) => {
    if (p.id !== id) return p;
    const nextDate = date === undefined ? p.date : (date || null);
    const changed = nextDate !== p.date;
    return {
      ...p,
      date: nextDate,
      dateSource: changed ? (nextDate ? 'manual' : null) : p.dateSource,
      stopId: stopId === undefined ? p.stopId : (stopId || null),
      caption: caption === undefined ? p.caption : String(caption).trim(),
    };
  });
}

export const removePhoto = (photos, id) => photos.filter((p) => p.id !== id);

/** Star or unstar a photo for the slideshow. Up to FEATURE_MAX; a full list returns an error and stays as it was. */
export function toggleFeatured(photos, id) {
  const target = photos.find((p) => p.id === id);
  if (!target) return { photos };
  if (!target.featured && photos.filter((p) => p.featured).length >= FEATURE_MAX) return { photos, error: 'featured.max' };
  return { photos: photos.map((p) => (p.id === id ? { ...p, featured: !p.featured } : p)) };
}

/**
 * The slideshow: the starred photos and (Stage 10) the photos linked to a saved place, at most 12 in all: starred
 * first, then place photos by date; shown in trip order. Stars are never changed here. With neither, up to 12 spread
 * evenly over the trip (auto), as before.
 */
export function slideshow(trip, max = FEATURE_MAX) {
  const dated = cleanPhotos(trip?.photos).map((p) => ({ ...p, date: p.date ?? '' })).sort(byDateThenAdded);
  const pick = (list) => list.map((p) => cleanPhotos(trip.photos).find((x) => x.id === p.id));
  const starred = dated.filter((p) => p.featured);
  const linked = new Set((Array.isArray(trip?.places) ? trip.places : []).flatMap((x) => (isObj(x) && Array.isArray(x.photoIds) ? x.photoIds : [])));
  const fromPlaces = dated.filter((p) => !p.featured && linked.has(p.id));
  if (starred.length || fromPlaces.length) return { auto: false, list: pick([...starred, ...fromPlaces].slice(0, max).sort(byDateThenAdded)) };
  if (dated.length <= max) return { auto: true, list: pick(dated) };
  // One per day first (spread over the days), then fill evenly from the rest, kept in trip order.
  const firstOfDay = dated.filter((p, i) => i === 0 || dated[i - 1].date !== p.date);
  const spread = (list, n) => Array.from({ length: n }, (_, k) => list[Math.floor((k * list.length) / n)]);
  let chosen = firstOfDay.length >= max ? spread(firstOfDay, max) : firstOfDay;
  if (chosen.length < max) {
    const rest = dated.filter((p) => !chosen.includes(p));
    chosen = [...chosen, ...spread(rest, max - chosen.length)];
  }
  return { auto: true, list: pick(chosen.sort(byDateThenAdded)) };
}

/** A warning when the device's storage is nearly full: over 80% used, or under 50 MB free. null when fine or unknown. */
export function storageWarning(estimate) {
  const usage = Number(estimate?.usage);
  const quota = Number(estimate?.quota);
  if (!(quota > 0) || !(usage >= 0)) return null;
  const freeBytes = Math.max(0, quota - usage);
  const pct = Math.round((usage / quota) * 100);
  return pct > 80 || freeBytes < 50 * MB ? { pct, freeBytes } : null;
}

/** Stops for the photo dialog's picker, in trip order. */
export const stopChoices = (trip) => sortStops(cleanStops(trip?.destinations)).map((x) => ({ id: x.id, name: x.name }));
