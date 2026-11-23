// Stage 14: a local trip <-> cloud records. Pure functions; tests/stage14-sync.test.js.
// Owner decisions (2026-11-23), field by field:
//   shared (every member of the trip): route stops, places (without their photo links), flight and transfer details
//     (without price, currency, seat price, linked expense, seat, booking, status, note), participants, expenses that
//     are split (paidBy / sharedBy / split) and repayments.
//   trip header (name, country, dates): shared, changed only by the trip owner (the trips table, not records).
//   personal (only this user): budget, rates, checklist, tasks, luggage, smart suitcase, journal, check-ins, events,
//     info notes, assistant, archive, expenses that are not split, own flight price/status/note/booking/seat,
//     photo links of places, and any field this version does not know (kept, never dropped).
//   on this phone only: photos (and their files in IndexedDB), the one-time offers.
// Nothing is ever lost on the way: entries without a usable id travel as one personal "loose" record per list.

export const META_FIELDS = ['name', 'countryCode', 'startDate', 'endDate'];
export const LOCAL_ONLY = ['id', 'photos', 'templateOffer', 'builtinOffer'];
export const TRANSFER_PERSONAL = ['priceMinor', 'currency', 'seatPriceMinor', 'expenseId', 'seat', 'booking', 'status', 'note'];
export const PLACE_PERSONAL = ['photoIds'];
const SHARED_LISTS = { destinations: 'stop', places: 'place', transfers: 'transfer', people: 'person', repayments: 'repayment' };
const PERSONAL_LISTS = { checklist: 'item', tasks: 'task', checkins: 'checkin', events: 'event' };
const PERSONAL_OBJECTS = ['budget', 'rates', 'luggage', 'smartBag', 'journal', 'info', 'assistant', 'archive'];
const LIST_OF_KIND = Object.fromEntries([...Object.entries(SHARED_LISTS), ...Object.entries(PERSONAL_LISTS), ['expenses', 'expense']].map(([f, k]) => [k, f]));

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const goodId = (x) => isObj(x) && typeof x.id === 'string' && x.id.length > 0 && x.id.length <= 64;

export const recKey = (scope, kind, recId) => `${scope}|${kind}|${recId}`;
export function parseKey(key) {
  const [scope, kind, ...rest] = key.split('|');
  return { scope, kind, rec_id: rest.join('|') };
}

/** JSON with sorted keys, so the same value always gives the same text. */
export function stableJson(v) {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

/** A short fingerprint of a value (cyrb53 over its stable JSON). Same value, same fingerprint. */
export function hashValue(v) {
  const str = stableJson(v);
  let h1 = 0xdeadbeef; let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i += 1) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}:${str.length}`;
}

/** A split expense is shared; any other expense is personal (owner decision). */
export function isSharedExpense(e) {
  if (!isObj(e)) return false;
  return (typeof e.paidBy === 'string' && e.paidBy !== '')
    || (Array.isArray(e.sharedBy) && e.sharedBy.length > 0)
    || isObj(e.split);
}

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
const omit = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

/** { meta, records }: records is a Map key -> { scope: 'shared'|'personal', kind, rec_id, data }. */
export function tripToRecords(trip) {
  const records = new Map();
  const put = (scope, kind, recId, data) => records.set(recKey(scope, kind, recId), { scope, kind, rec_id: recId, data });
  const meta = {};
  for (const f of META_FIELDS) meta[f] = trip?.[f] ?? null;

  for (const [field, value] of Object.entries(trip ?? {})) {
    if (META_FIELDS.includes(field) || LOCAL_ONLY.includes(field)) continue;
    const listKind = SHARED_LISTS[field] ?? PERSONAL_LISTS[field] ?? (field === 'expenses' ? 'expense' : null);
    if (listKind && Array.isArray(value)) {
      const loose = [];
      const seen = new Set();
      value.forEach((item, o) => {
        if (!goodId(item) || seen.has(item.id)) { loose.push({ o, v: item }); return; }
        seen.add(item.id);
        if (field === 'transfers') {
          put('shared', 'transfer', item.id, { o, v: omit(item, TRANSFER_PERSONAL) });
          const mine = pick(item, TRANSFER_PERSONAL);
          if (Object.keys(mine).length) put('personal', 'transfer-mine', item.id, { v: mine });
        } else if (field === 'places') {
          put('shared', 'place', item.id, { o, v: omit(item, PLACE_PERSONAL) });
          const mine = pick(item, PLACE_PERSONAL);
          if (Object.keys(mine).length) put('personal', 'place-mine', item.id, { v: mine });
        } else if (field === 'expenses') {
          put(isSharedExpense(item) ? 'shared' : 'personal', 'expense', item.id, { o, v: item });
        } else {
          put(SHARED_LISTS[field] ? 'shared' : 'personal', listKind, item.id, { o, v: item });
        }
      });
      if (loose.length) put('personal', 'loose', field, { items: loose });
    } else if (PERSONAL_OBJECTS.includes(field)) {
      put('personal', 'obj', field, { v: value });
    } else {
      put('personal', 'extra', field, { v: value });
    }
  }
  return { meta, records };
}

/** Build the trip back from records. `base` gives what never leaves the phone (id, photos, one-time offers) and the
 *  default shape for anything the records do not carry. Order inside each list follows the stored order. */
export function recordsToTrip(base, meta, records) {
  const trip = {};
  for (const f of LOCAL_ONLY) if (base && f in base) trip[f] = base[f];
  for (const f of META_FIELDS) trip[f] = meta?.[f] ?? null;
  const lists = {};
  const mineOf = { transfer: new Map(), place: new Map() };
  const loose = {};
  for (const r of records.values()) {
    if (r.kind === 'transfer-mine') { mineOf.transfer.set(r.rec_id, r.data?.v ?? {}); continue; }
    if (r.kind === 'place-mine') { mineOf.place.set(r.rec_id, r.data?.v ?? {}); continue; }
    if (r.kind === 'obj' || r.kind === 'extra') { trip[r.rec_id] = r.data?.v; continue; }
    if (r.kind === 'loose') { loose[r.rec_id] = Array.isArray(r.data?.items) ? r.data.items : []; continue; }
    const field = LIST_OF_KIND[r.kind];
    if (!field) continue;
    (lists[field] ??= []).push({ o: Number.isFinite(r.data?.o) ? r.data.o : Infinity, id: r.rec_id, v: r.data?.v });
  }
  for (const field of [...Object.keys(SHARED_LISTS), ...Object.keys(PERSONAL_LISTS), 'expenses']) {
    const items = [...(lists[field] ?? []), ...(loose[field] ?? []).map((x) => ({ o: x.o, id: '', v: x.v }))]
      .sort((a, b) => a.o - b.o || a.id.localeCompare(b.id));
    if (!items.length && !(base && field in base) && !lists[field] && !loose[field]) continue;
    trip[field] = items.map(({ v }) => {
      if (field === 'transfers' && goodId(v)) return { ...v, ...(mineOf.transfer.get(v.id) ?? {}) };
      if (field === 'places' && goodId(v) && mineOf.place.has(v.id)) return { ...v, ...mineOf.place.get(v.id) };
      return v;
    });
  }
  for (const [field, items] of Object.entries(loose)) if (!(field in trip)) trip[field] = items.map((x) => x.v);
  // Anything the base has that no record carried (a list or object a new phone starts with) keeps its default shape.
  for (const [k, v] of Object.entries(base ?? {})) if (!(k in trip)) trip[k] = v;
  return trip;
}
