// Stage 5 checklist and tasks. Pure functions, no DOM. Tested in tests/checklist.test.js.
// No rule, number or date is ever stated as fact: rule-dependent items carry `verify` and stay "to check"
// until the user writes where and when they checked.
import { isIsoDate } from './trip.js';

// Stage 9 PR 2 added offline (downloads before the flight), flightFood and flightComfort. Pre-stage-10 PR A
// (owner, 2026-11-21) added flightDay, carryOn, hygiene, checkedBag and afterLanding, and four sections:
// preparation, carry-on, checked bag, after landing. GROUPS is in display order (section by section).
const SECTION_OF = {
  documents: 'prep', money: 'prep', comms: 'prep', offline: 'prep', flightDay: 'prep',
  carryOn: 'carry', flightComfort: 'carry', flightFood: 'carry', hygiene: 'carry',
  checkedBag: 'bag', health: 'bag', clothing: 'bag', chargers: 'bag',
  afterLanding: 'arrival',
};
export const GROUPS = Object.keys(SECTION_OF);
export const SECTIONS = ['prep', 'carry', 'bag', 'arrival'];
export const groupSection = (g) => SECTION_OF[g] ?? null;
/** The home card's two bars: preparation and packing (carry-on + checked bag). After landing is its own. */
export const groupKind = (g) => {
  const s = groupSection(g);
  return s === 'carry' || s === 'bag' ? 'pack' : s;
};
export const TASK_STATUSES = ['open', 'doing', 'done'];
export const NAME_MAX = 60;
export const NOTE_MAX = 140;
export const TITLE_MAX = 80;
export const SOURCE_MAX = 200;
const QTY_MAX = 999;

const parseQty = (v) => {
  const s = String(v ?? '').trim();
  if (s === '') return 1;
  return /^\d+$/.test(s) && Number(s) >= 1 && Number(s) <= QTY_MAX ? Number(s) : NaN;
};

export function validateItem({ group, name, qty, note } = {}) {
  const errors = [];
  if (!GROUPS.includes(group)) errors.push('group.invalid');
  const n = String(name ?? '').trim();
  if (!n) errors.push('name.missing');
  else if (n.length > NAME_MAX) errors.push('name.tooLong');
  if (Number.isNaN(parseQty(qty))) errors.push('qty.invalid');
  if (String(note ?? '').trim().length > NOTE_MAX) errors.push('note.tooLong');
  return errors;
}

/** A saved item. `verify: true` in the input starts an unchecked "to check" record. */
export function makeItem(input, makeId, existing = null) {
  const out = {
    ...(existing ?? {}),
    id: existing?.id ?? makeId(),
    group: input.group,
    name: String(input.name ?? '').trim(),
    qty: parseQty(input.qty),
    note: String(input.note ?? '').trim(),
    done: existing?.done ?? false,
  };
  if (input.verify === true && !existing?.verify) out.verify = { source: '', checkedAt: null };
  return out;
}

export const needsCheck = (item) => Boolean(item?.verify) && !item.verify.checkedAt;

export function validateVerify({ source, checkedAt } = {}) {
  const errors = [];
  if (String(source ?? '').trim().length > SOURCE_MAX) errors.push('source.tooLong');
  if (checkedAt && !isIsoDate(checkedAt)) errors.push('checkedAt.invalid');
  return errors;
}

/** Done / total per section, and `pack` (carry-on + checked bag) for the home card. pct is rounded down
 *  (100 only when all are done), null when there is nothing. */
export function progress(items = []) {
  const bar = (test) => {
    const list = items.filter((x) => test(x.group));
    const done = list.filter((x) => x.done).length;
    return { done, total: list.length, pct: list.length ? Math.floor((done / list.length) * 100) : null };
  };
  const out = Object.fromEntries(SECTIONS.map((s) => [s, bar((g) => groupSection(g) === s)]));
  out.pack = bar((g) => groupKind(g) === 'pack');
  return out;
}

const pick = (obj, locale) => obj?.[locale] ?? obj?.en ?? '';

/** The country pack's starter list as fresh items. Used only after the user says yes, into an empty list. */
export const seedChecklist = (pack, locale, makeId) => (pack?.checklistSeed ?? [])
  .map((x) => makeItem({ group: x.group, name: pick(x.name, locale), qty: '', note: '', verify: Boolean(x.verify) }, makeId));

export const seedTasks = (pack, locale, makeId) => (pack?.taskSeed ?? [])
  .map((x) => makeTask({ title: pick(x.title, locale), status: 'open', due: '', note: '' }, makeId));

export function validateTask({ title, status, due, note } = {}) {
  const errors = [];
  const t = String(title ?? '').trim();
  if (!t) errors.push('title.missing');
  else if (t.length > TITLE_MAX) errors.push('title.tooLong');
  if (!TASK_STATUSES.includes(status)) errors.push('status.invalid');
  if (due && !isIsoDate(due)) errors.push('due.invalid');
  if (String(note ?? '').trim().length > NOTE_MAX) errors.push('note.tooLong');
  return errors;
}

export function makeTask(input, makeId, existing = null) {
  return {
    ...(existing ?? {}),
    id: existing?.id ?? makeId(),
    title: String(input.title ?? '').trim(),
    status: input.status,
    due: input.due || null,
    note: String(input.note ?? '').trim(),
  };
}

/** done | overdue | today | upcoming | none, by the destination's calendar date. */
export function taskState(task, today) {
  if (task.status === 'done') return 'done';
  if (!task.due) return 'none';
  if (task.due < today) return 'overdue';
  return task.due === today ? 'today' : 'upcoming';
}

export const openTasks = (tasks = []) => tasks.filter((x) => x.status !== 'done');

/** The open task with the earliest due date; without dates, the first open one. */
export function nextTask(tasks = []) {
  const open = openTasks(tasks);
  const dated = open.filter((x) => x.due).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  return dated[0] ?? open[0] ?? null;
}

export const cleanItems = (list) => (Array.isArray(list)
  ? list.filter((x) => x && typeof x === 'object' && typeof x.id === 'string' && typeof x.name === 'string' && GROUPS.includes(x.group)) : []);
export const cleanTasks = (list) => (Array.isArray(list)
  ? list.filter((x) => x && typeof x === 'object' && typeof x.id === 'string' && typeof x.title === 'string' && TASK_STATUSES.includes(x.status)) : []);

/** The status filter: when on, ticked items and done tasks are hidden (the data is not touched). */
export const hideDone = (list = [], on = false) => (on ? list.filter((x) => !(x.done === true || x.status === 'done')) : list);

const sameName = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();

/** Stage 9 PR 2: add the pack's flight items that are not on the list yet (by name, any group). Nothing else changes. */
export function addFlightItems(items = [], pack, locale, makeId) {
  const have = new Set(items.map((x) => sameName(x?.name)));
  const fresh = [];
  for (const x of pack?.flightChecklistSeed ?? []) {
    const name = pick(x.name, locale);
    if (have.has(sameName(name))) continue;
    have.add(sameName(name));
    fresh.push(makeItem({ group: x.group, name, qty: '', note: '', verify: Boolean(x.verify) }, makeId));
  }
  return { items: [...items, ...fresh], added: fresh.length };
}


// ---------- Pre-stage-10 PR A: the built-in list (data/packs/th.js checklistBuiltin) ----------
// A new trip gets all of it. Old data keeps every item and tick and is only offered what is missing.
// An entry counts as present when an item has its key, or an item's name equals its name or an alias in any
// language (old starter items have no key). Nothing is ever ticked here.

const entryNames = (x) => Object.values(x.name ?? {}).concat(...Object.values(x.aliases ?? {})).map(sameName);

/** All built-in entries as fresh items, each with its `builtin` key. */
export function builtinItems(pack, locale, makeId) {
  return (pack?.checklistBuiltin ?? []).map((x) => ({
    ...makeItem({ group: x.group, name: pick(x.name, locale), qty: '', note: pick(x.note, locale), verify: Boolean(x.verify) }, makeId),
    builtin: x.key,
  }));
}

/** The built-in entries the list does not have yet. */
export function missingBuiltins(items, pack) {
  const list = Array.isArray(items) ? items : [];
  const keys = new Set(list.map((x) => x?.builtin).filter(Boolean));
  const names = new Set(list.map((x) => sameName(x?.name)));
  return (pack?.checklistBuiltin ?? []).filter((x) => !keys.has(x.key) && !entryNames(x).some((n) => names.has(n)));
}

/** Add the missing built-in items after the existing ones. Existing items are returned as they are. */
export function addBuiltins(items, pack, locale, makeId) {
  const list = Array.isArray(items) ? items : [];
  const want = new Set(missingBuiltins(list, pack).map((x) => x.key));
  const fresh = builtinItems(pack, locale, makeId).filter((x) => want.has(x.builtin));
  return { items: [...list, ...fresh], added: fresh.length };
}

/** A new (or reset) trip: fill an empty list with the built-in one. A list with any item is left alone. */
export function readyChecklist(trip, pack, locale, makeId) {
  if (cleanItems(trip.checklist).length) return;
  trip.checklist = [...(Array.isArray(trip.checklist) ? trip.checklist : []), ...builtinItems(pack, locale, makeId)];
}

/** The one-time card: something is missing and the user did not say "not now" to this version of the list. */
export function needsBuiltinOffer(trip, pack) {
  if (trip?.builtinOffer?.declined === pack?.checklistBuiltinVersion) return false;
  return missingBuiltins(trip?.checklist, pack).length > 0;
}

/** "Not now": only the answer is saved. */
export function declineBuiltinOffer(trip, pack) {
  trip.builtinOffer = { declined: pack.checklistBuiltinVersion };
}
