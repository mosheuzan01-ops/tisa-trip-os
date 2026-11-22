// Stage 12 PR 2 (0.11.1): smart suitcase. Pure functions, no DOM; tested in tests/stage12-smart-bag.test.js.
// Owner decisions (2026-11-22): suggestions only, from local rules (data/packing/th.json). A suggestion becomes a
// normal checklist item (carry-on or checked-bag section) only after a tap; "packed" is the checklist's own tick.
// Nothing here adds, edits or removes an item on its own. Destination kinds come from a table of names only.
import { makeItem, cleanItems, GROUPS } from './checklist.js';
import { cleanStops } from './itinerary.js';
import { daysBetween, isIsoDate } from './trip.js';

const RANK = { must: 2, nice: 1 };
export const norm = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
const pick = (obj, locale) => obj?.[locale] ?? obj?.en ?? '';
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** city | island | beach | null, by the stop's name (the table in the rules file). */
export function destinationKind(name, data) {
  const n = norm(name);
  for (const [kind, names] of Object.entries(data?.destinationKinds ?? {})) if (names.some((x) => norm(x) === n)) return kind;
  return null;
}

/** Trip days = the trip's dates, first and last included. Null without valid dates. */
export function tripDays(trip) {
  if (!isIsoDate(trip?.startDate) || !isIsoDate(trip?.endDate)) return null;
  const d = daysBetween(trip.startDate, trip.endDate);
  return d >= 0 ? d + 1 : null;
}

/** The kinds on the route (in the file's order) and the stop names that are not in the table (once each). */
export function routeKinds(trip, data) {
  const found = new Set();
  const unclassified = [];
  for (const s of cleanStops(trip?.destinations)) {
    const k = destinationKind(s.name, data);
    if (k) found.add(k);
    else if (!unclassified.includes(s.name.trim())) unclassified.push(s.name.trim());
  }
  return { kinds: Object.keys(data?.kinds ?? {}).filter((k) => found.has(k)), unclassified };
}

export const cleanActivities = (list, data) => {
  const want = new Set(Array.isArray(list) ? list : []);
  return (data?.activities ?? []).map((a) => a.id).filter((id) => want.has(id));
};

/** The activities the user chose for this trip. */
export const smartActivities = (trip, data) => cleanActivities(trip?.smartBag?.activities, data);

/** Save the chosen activities. Only trip.smartBag changes. */
export function setActivities(trip, ids, data) {
  trip.smartBag = { ...(isObj(trip.smartBag) ? trip.smartBag : {}), activities: cleanActivities(ids, data) };
}

function qtyOf(spec, days, cap) {
  const span = days === null ? cap : Math.min(days, cap);
  if (spec === 'cap') return span;
  if (spec === 'halfCap') return Math.ceil(span / 2);
  return Number.isInteger(spec) ? spec : 1;
}

function applies(when, { days, cap, kinds, activities }) {
  if (!when) return false;
  if (when.always) return true;
  if (when.minDays !== undefined) return days !== null && days >= when.minDays;
  if (when.overCap) return days !== null && days > cap;
  return (when.kinds ?? []).some((k) => kinds.includes(k)) || (when.activities ?? []).some((a) => activities.includes(a));
}

/** Names and keys already in the lists or in a bag; a suggestion that matches any of them is not shown. */
function present(trip) {
  const items = cleanItems(trip?.checklist);
  const names = new Set(items.map((x) => norm(x.name)));
  for (const b of trip?.luggage?.bags ?? []) for (const x of b?.items ?? []) if (typeof x?.name === 'string') names.add(norm(x.name));
  return {
    names,
    builtin: new Set(items.map((x) => x.builtin).filter(Boolean)),
    smart: new Set(items.map((x) => x.smart).filter(Boolean)),
  };
}

const isPresent = (s, have) => have.smart.has(s.key) || (s.sameAs && have.builtin.has(s.sameAs)) || s.names.some((n) => have.names.has(n));

/**
 * The suggestions for this trip, in three groups. Reads the trip, never changes it.
 * @returns {{ must: object[], nice: object[], avoid: object[], days: number|null, cap: number, kinds: string[], unclassified: string[] }}
 */
export function suggestions(trip, data, locale, { forecast = null } = {}) {
  const cap = Number.isInteger(data?.clothesCapDays) && data.clothesCapDays > 0 ? data.clothesCapDays : 7;
  const days = tripDays(trip);
  const { kinds, unclassified } = routeKinds(trip, data);
  const activities = smartActivities(trip, data);
  const ctx = { days, cap, kinds, activities };
  const merged = new Map();
  for (const r of data?.rules ?? []) {
    if (!applies(r.when, ctx)) continue;
    const s = {
      key: r.key,
      category: r.category,
      name: pick(r.name, locale),
      names: Object.values(r.name ?? {}).map(norm),
      sameAs: r.sameAs ?? null,
    };
    if (r.category === 'avoid') s.reason = pick(r.reason, locale).replace('{cap}', String(cap));
    else Object.assign(s, { group: r.group, qty: qtyOf(r.qty, days, cap), verify: r.verify === true, note: pick(r.note, locale) });
    const old = merged.get(r.key);
    if (!old || (RANK[s.category] ?? 0) > (RANK[old.category] ?? 0)) merged.set(r.key, old ? { ...s, qty: Math.max(s.qty ?? 0, old.qty ?? 0) } : s);
    else if (old.qty !== undefined) old.qty = Math.max(old.qty, s.qty ?? 0);
  }
  const have = present(trip);
  const list = [...merged.values()].filter((s) => s.category === 'avoid' || (GROUPS.includes(s.group) && !isPresent(s, have)));
  const out = {
    must: list.filter((s) => s.category === 'must'),
    nice: list.filter((s) => s.category === 'nice'),
    avoid: list.filter((s) => s.category === 'avoid'),
    days, cap, kinds, unclassified,
  };
  return applyForecast(out, forecast);
}

/** Weather, later: a forecast may change the suggestions. Today the app passes null and nothing changes. */
export function applyForecast(result, forecast) {
  if (forecast == null) return result;
  return result;
}

/** Add one suggestion as a normal checklist item, after the existing ones. Already there (a second tap): nothing. */
export function acceptSuggestion(items, s, makeId) {
  const list = Array.isArray(items) ? items : [];
  if (!s || s.category === 'avoid' || !GROUPS.includes(s.group) || isPresent(s, present({ checklist: list }))) return { items: list, added: 0 };
  const item = { ...makeItem({ group: s.group, name: s.name, qty: String(s.qty ?? 1), note: s.note ?? '', verify: s.verify === true }, makeId), smart: s.key };
  return { items: [...list, item], added: 1 };
}

/** "Add all the musts": each missing one once. */
export function acceptAll(items, list, makeId) {
  let out = Array.isArray(items) ? items : [];
  let added = 0;
  for (const s of list ?? []) {
    const r = acceptSuggestion(out, s, makeId);
    out = r.items;
    added += r.added;
  }
  return { items: out, added };
}
