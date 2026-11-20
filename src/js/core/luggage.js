// Stage 6.0e luggage weight. Pure functions, no DOM; tested in tests/luggage.test.js.
// The user sets each bag's limit (none until they do); the app only adds up and warns when the total is over.
// No airline limit lives anywhere in the app. Weights are typed in kg and kept in whole grams, like money in agorot.
const NAME_MAX = { bag: 40, item: 60 };
const MAX_GRAMS = 999999; // a typing guard (under 1,000 kg), not a rule about luggage

const txt = (v) => String(v ?? '').trim();
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** "12.4" or "12,4" kg -> 12400 grams. Up to 3 decimals, more than 0. Anything else: NaN. */
export function parseKg(text) {
  const s = txt(text).replace(',', '.');
  const m = /^(\d{1,3})(?:\.(\d{1,3}))?$/.exec(s);
  if (!m) return NaN;
  const grams = Number(m[1]) * 1000 + Number((m[2] ?? '').padEnd(3, '0'));
  return grams > 0 && grams <= MAX_GRAMS ? grams : NaN;
}

export function validateBag({ name, limit } = {}) {
  const errors = [];
  if (!txt(name)) errors.push('name.missing');
  else if (txt(name).length > NAME_MAX.bag) errors.push('name.tooLong');
  if (txt(limit) !== '' && Number.isNaN(parseKg(limit))) errors.push('limit.invalid');
  return errors;
}

export function validateLuggageItem({ name, weight, bagId } = {}, bagIds = []) {
  const errors = [];
  if (!txt(name)) errors.push('name.missing');
  else if (txt(name).length > NAME_MAX.item) errors.push('name.tooLong');
  if (txt(weight) === '') errors.push('weight.missing');
  else if (Number.isNaN(parseKg(weight))) errors.push('weight.invalid');
  if (!bagIds.includes(bagId)) errors.push('bag.invalid');
  return errors;
}

/** A bag; editing keeps its items. An empty limit means "not set yet". */
export const makeBag = (input, makeId, existing = null) => ({
  id: existing?.id ?? makeId(),
  name: txt(input.name),
  limitGrams: txt(input.limit) === '' ? null : parseKg(input.limit),
  items: Array.isArray(existing?.items) ? existing.items : [],
});

export const makeLuggageItem = (input, makeId, existing = null) => ({ id: existing?.id ?? makeId(), name: txt(input.name), grams: parseKg(input.weight) });

const cleanItems = (items) => (Array.isArray(items)
  ? items.filter((x) => isObj(x) && typeof x.id === 'string' && typeof x.name === 'string' && Number.isInteger(x.grams) && x.grams > 0) : []);

/** Bags that can be shown, each with the items that can be shown. Broken ones stay in the saved data. */
export const cleanBags = (luggage) => (isObj(luggage) && Array.isArray(luggage.bags)
  ? luggage.bags.filter((b) => isObj(b) && typeof b.id === 'string' && typeof b.name === 'string')
    .map((b) => ({ ...b, limitGrams: Number.isInteger(b.limitGrams) && b.limitGrams > 0 ? b.limitGrams : null, items: cleanItems(b.items) }))
  : []);

/** Total and limit. Over only when the total is more than the limit; equal is fine. No limit: no warning. */
export function bagStatus(bag) {
  const totalGrams = cleanItems(bag?.items).reduce((s, x) => s + x.grams, 0);
  const limitGrams = Number.isInteger(bag?.limitGrams) && bag.limitGrams > 0 ? bag.limitGrams : null;
  if (limitGrams === null) return { totalGrams, limitGrams, state: 'noLimit', overGrams: 0, leftGrams: null };
  const over = totalGrams > limitGrams;
  return { totalGrams, limitGrams, state: over ? 'over' : 'ok', overGrams: over ? totalGrams - limitGrams : 0, leftGrams: over ? 0 : limitGrams - totalGrams };
}

const bagsOf = (luggage) => (isObj(luggage) && Array.isArray(luggage.bags) ? luggage.bags : []);

/** Add or replace a bag. Returns new luggage; nothing given is changed. */
export function saveBag(luggage, bag) {
  const bags = bagsOf(luggage);
  return { ...luggage, bags: bags.some((b) => b?.id === bag.id) ? bags.map((b) => (b?.id === bag.id ? bag : b)) : [...bags, bag] };
}

export const removeBag = (luggage, bagId) => ({ ...luggage, bags: bagsOf(luggage).filter((b) => b?.id !== bagId) });

/** Put an item in a bag: added, edited in place, or moved from another bag. */
export function saveItem(luggage, item, bagId) {
  return {
    ...luggage,
    bags: bagsOf(luggage).map((b) => {
      if (!isObj(b)) return b;
      const items = Array.isArray(b.items) ? b.items : [];
      const here = items.some((x) => x?.id === item.id);
      if (b.id === bagId) return { ...b, items: here ? items.map((x) => (x?.id === item.id ? item : x)) : [...items, item] };
      return here ? { ...b, items: items.filter((x) => x?.id !== item.id) } : b;
    }),
  };
}

export const removeItem = (luggage, itemId) => ({
  ...luggage,
  bags: bagsOf(luggage).map((b) => (isObj(b) && Array.isArray(b.items) && b.items.some((x) => x?.id === itemId)
    ? { ...b, items: b.items.filter((x) => x?.id !== itemId) } : b)),
});
