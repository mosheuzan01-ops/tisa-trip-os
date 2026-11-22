// Stage 10 PR 2: sharing a place (only the fields the user chose), places files (export / import with no overwrite
// and no duplicates), and the place of a photo for the slideshow. Pure functions, no DOM; tests/stage10-share.test.js.
// Sharing goes through the phone's own share sheet (WhatsApp is one of its targets) or the clipboard. No server.
import { isIsoDate } from './trip.js';
import { normalize } from './search.js';
import { validatePlace, makePlace, cleanPlaces, mapsUrl } from './places.js';

export const SHARE_FIELDS = ['name', 'category', 'address', 'coords', 'map', 'planned', 'visited', 'note'];
/** What is ticked when the share window opens. The note and the dates are personal: off until the user ticks them. */
export const DEFAULT_SHARE_FIELDS = ['name', 'address', 'map'];

/** The share text: one line per chosen field that has a value, in SHARE_FIELDS order. Empty fields add nothing. */
export function shareText(place, fields, { t, mapsBase, fmtDate }) {
  const on = new Set(fields);
  const lines = [];
  for (const f of SHARE_FIELDS) {
    if (!on.has(f)) continue;
    if (f === 'name' && place.name) lines.push(place.name);
    if (f === 'category' && place.category) lines.push(t(`place.cat.${place.category}`));
    if (f === 'address' && place.address) lines.push(place.address);
    if (f === 'coords' && place.lat && place.lng) lines.push(`${place.lat}, ${place.lng}`);
    if (f === 'map') { const url = mapsUrl(place, mapsBase); if (url) lines.push(url); }
    if (f === 'planned' && isIsoDate(place.plannedDate)) lines.push(`${t('place.share.planned')} ${fmtDate(place.plannedDate)}`);
    if (f === 'visited' && isIsoDate(place.visitedDate)) lines.push(`${t('place.share.visited')} ${fmtDate(place.visitedDate)}`);
    if (f === 'note' && place.note) lines.push(place.note);
  }
  return lines.join('\n');
}

// ---------- Places file ----------
export const PLACES_FORMAT = 'tisa-places';
const PLACES_VERSION = 1;
/** Only what describes the place itself. Status, dates, the stop and photos are this phone's own and stay here. */
const FILE_FIELDS = ['id', 'name', 'category', 'lat', 'lng', 'address', 'note'];

export function exportPlaces(places, now) {
  return {
    format: PLACES_FORMAT,
    version: PLACES_VERSION,
    exportedAt: now.toISOString(),
    places: cleanPlaces(places).map((p) => Object.fromEntries(FILE_FIELDS.map((k) => [k, p[k] ?? (k === 'lat' || k === 'lng' ? null : '')]))),
  };
}

export const placesFileName = (now) => `${PLACES_FORMAT}-${now.toISOString().slice(0, 10)}.json`;

const str = (v) => (typeof v === 'string' ? v : '');
const toInput = (x) => ({
  name: str(x.name), category: x.category, status: 'want', coords: x.lat && x.lng ? `${x.lat}, ${x.lng}` : '', address: str(x.address), note: str(x.note),
});

/**
 * Read a places file. Never throws. Entries that do not pass the same checks as the form are skipped and counted.
 * @returns {{ ok: true, places, invalid } | { ok: false, error: 'empty'|'notJson'|'format'|'future'|'structure' }}
 */
export function parsePlaces(text) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'empty' };
  let file;
  try { file = JSON.parse(text); } catch { return { ok: false, error: 'notJson' }; }
  if (!file || typeof file !== 'object' || Array.isArray(file) || file.format !== PLACES_FORMAT) return { ok: false, error: 'format' };
  if (Number.isInteger(file.version) && file.version > PLACES_VERSION) return { ok: false, error: 'future' };
  if (!Array.isArray(file.places)) return { ok: false, error: 'structure' };
  const places = [];
  let invalid = 0;
  for (const x of file.places) {
    if (!x || typeof x !== 'object' || Array.isArray(x) || validatePlace(toInput(x)).length) { invalid += 1; continue; }
    const input = toInput(x);
    places.push({ id: str(x.id), name: input.name.trim(), category: x.category, lat: x.lat && x.lng ? String(x.lat) : null, lng: x.lat && x.lng ? String(x.lng) : null, address: input.address.trim(), note: input.note.trim() });
  }
  return { ok: true, places, invalid };
}

/** Same place: same name (case and spaces aside) at the same coordinates, or, without coordinates, the same address. */
const keyOf = (p) => `${normalize(p.name)}|${p.lat && p.lng ? `${Number(p.lat)},${Number(p.lng)}` : `@${normalize(p.address)}`}`;

/**
 * Add the incoming places that are new. A place counts as already here when its id is here, or its name and place
 * match (keyOf). Nothing that is already here is changed. New ones come in as "want to visit", with no dates,
 * no stop and no photos.
 */
export function mergePlaces(existing, incoming, makeId, nowIso) {
  const places = Array.isArray(existing) ? [...existing] : [];
  const ids = new Set(cleanPlaces(places).map((p) => p.id));
  const keys = new Set(cleanPlaces(places).map(keyOf));
  let added = 0;
  let duplicates = 0;
  for (const x of incoming ?? []) {
    if ((x.id && ids.has(x.id)) || keys.has(keyOf(x))) { duplicates += 1; continue; }
    const p = makePlace(toInput(x), () => x.id || makeId(), nowIso);
    places.push(p);
    ids.add(p.id);
    keys.add(keyOf(p));
    added += 1;
  }
  return { places, added, duplicates };
}

/** The first saved place that links this photo, or null. */
export function placeOfPhoto(photoId, places) {
  return cleanPlaces(places).find((p) => Array.isArray(p.photoIds) && p.photoIds.includes(photoId)) ?? null;
}
