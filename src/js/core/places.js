// Stage 10 saved places (trip.places). Pure functions, no DOM; tested in tests/stage10-places.test.js.
// A place is { id, name, category, status, lat, lng, address, note, stopId, plannedDate, visitedDate, photoIds,
// createdAt, updatedAt }. Everything is typed by the user and saved exactly as typed: coordinates stay as the text
// that was entered (no rounding), and nothing is filled in on the user's behalf. "Planned day" and "actual visit
// date" are two separate fields; marking a place "visited" never sets the visit date (owner, 2026-11-21).
import { isIsoDate, daysBetween } from './trip.js';
import { whereToday, cleanStops } from './itinerary.js';
import { searchList } from './search.js';

export const PLACE_STATUSES = ['want', 'visited', 'loved'];
export const PLACE_CATEGORIES = ['food', 'sight', 'temple', 'beach', 'nature', 'market', 'stay', 'other'];
export const NAME_MAX = 60;
export const ADDRESS_MAX = 120;
export const NOTE_MAX = 280;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const NUM = /^-?\d{1,3}(\.\d+)?$/;

/** "lat, lng" (comma or space between) as the exact text typed. Empty = no coordinates. */
export function parseCoords(text) {
  const s = String(text ?? '').trim();
  if (!s) return { ok: true, lat: null, lng: null };
  const parts = s.split(/\s*,\s*|\s+/);
  if (parts.length !== 2 || !parts.every((x) => NUM.test(x))) return { ok: false };
  const [lat, lng] = parts;
  if (Math.abs(Number(lat)) > 90 || Math.abs(Number(lng)) > 180) return { ok: false };
  return { ok: true, lat, lng };
}

/** The coordinates of a place as one "lat, lng" text for the form, or ''. */
export const coordsText = (p) => (p?.lat && p?.lng ? `${p.lat}, ${p.lng}` : '');

/** Problems with the form, as message keys. `trip` (optional) limits the planned day to the trip dates. */
export function validatePlace(input, { stopIds, trip } = {}) {
  const errors = [];
  const name = String(input?.name ?? '').trim();
  if (!name) errors.push('name.required');
  else if (name.length > NAME_MAX) errors.push('name.tooLong');
  if (!PLACE_CATEGORIES.includes(input?.category)) errors.push('category.invalid');
  if (!PLACE_STATUSES.includes(input?.status)) errors.push('status.invalid');
  if (!parseCoords(input?.coords).ok) errors.push('coords.invalid');
  if (String(input?.address ?? '').trim().length > ADDRESS_MAX) errors.push('address.tooLong');
  if (String(input?.note ?? '').trim().length > NOTE_MAX) errors.push('note.tooLong');
  if (input?.stopId && Array.isArray(stopIds) && !stopIds.includes(input.stopId)) errors.push('stopId.invalid');
  if (input?.plannedDate) {
    if (!isIsoDate(input.plannedDate)) errors.push('plannedDate.invalid');
    else if (isIsoDate(trip?.startDate) && isIsoDate(trip?.endDate) && (input.plannedDate < trip.startDate || input.plannedDate > trip.endDate)) {
      errors.push('plannedDate.outside');
    }
  }
  if (input?.visitedDate && !isIsoDate(input.visitedDate)) errors.push('visitedDate.invalid');
  return errors;
}

/** A place from the form. Editing keeps the id, created time, linked photos and any field this version does not know. */
export function makePlace(input, makeId, nowIso, existing = null) {
  const c = parseCoords(input.coords);
  return {
    ...(existing ?? {}),
    id: existing?.id ?? makeId(),
    name: String(input.name).trim(),
    category: input.category,
    status: input.status,
    lat: c.ok ? c.lat : null,
    lng: c.ok ? c.lng : null,
    address: String(input.address ?? '').trim(),
    note: String(input.note ?? '').trim(),
    stopId: input.stopId || null,
    plannedDate: isIsoDate(input.plannedDate) ? input.plannedDate : null,
    visitedDate: isIsoDate(input.visitedDate) ? input.visitedDate : null,
    // PR 2: links to existing photos by id (never a copy). The form sends them; without them the links stay.
    photoIds: Array.isArray(input.photoIds) ? [...new Set(input.photoIds.filter((x) => typeof x === 'string' && x))]
      : Array.isArray(existing?.photoIds) ? existing.photoIds : [],
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
  };
}

export function savePlace(list, place) {
  const arr = Array.isArray(list) ? list : [];
  return arr.some((x) => x?.id === place.id) ? arr.map((x) => (x?.id === place.id ? place : x)) : [...arr, place];
}

export const removePlace = (list, id) => (Array.isArray(list) ? list : []).filter((x) => x?.id !== id);

/** Places that can be shown. Broken entries stay in the saved data; they are only skipped. */
export const cleanPlaces = (list) => (Array.isArray(list) ? list.filter((x) => isObj(x) && typeof x.id === 'string' && x.id && typeof x.name === 'string') : []);

const isVisited = (p) => p.status === 'visited' || p.status === 'loved';

/** Search (name, address, note) and filters. view: 'all' | 'want' | 'visited' ("loved" counts as visited). */
export function filterPlaces(list, { q = '', category = '', stopId = '', status = '', view = 'all' } = {}) {
  const shown = cleanPlaces(list).filter((p) => (!category || p.category === category)
    && (!stopId || p.stopId === stopId)
    && (!status || p.status === status)
    && (view === 'want' ? p.status === 'want' : view === 'visited' ? isVisited(p) : true));
  return searchList(shown, q, (p) => [p.name, p.address, p.note]);
}

export function placeCounts(list) {
  const all = cleanPlaces(list);
  return { all: all.length, want: all.filter((p) => p.status === 'want').length, visited: all.filter(isVisited).length };
}

/** The Google Maps search link for the place's coordinates, or null. Opened only when the user taps (rule 5). */
export function mapsUrl(place, base) {
  if (!place?.lat || !place?.lng || typeof base !== 'string' || !base) return null;
  return `${base}${encodeURIComponent(`${place.lat},${place.lng}`)}`;
}

/** The planned day as "day N" of the trip and the stop on that date. N only when the trip has a start date. */
export function planDay(date, trip) {
  if (!isIsoDate(date)) return null;
  const n = isIsoDate(trip?.startDate) ? daysBetween(trip.startDate, date) + 1 : null;
  const stops = cleanStops(trip?.destinations);
  const w = whereToday(stops, date);
  const stop = w.phase === 'during' ? stops.find((x) => x.id === w.currentId) : null;
  return { n: n !== null && n >= 1 ? n : null, stopName: stop?.name ?? null };
}
