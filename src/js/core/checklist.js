// Stage 5 checklist and tasks. Pure functions, no DOM. Tested in tests/checklist.test.js.
// No rule, number or date is ever stated as fact: rule-dependent items carry `verify` and stay "to check"
// until the user writes where and when they checked.
import { isIsoDate } from './trip.js';

// Stage 9 PR 2 added offline (downloads before the flight), flightFood and flightComfort.
export const GROUPS = ['documents', 'money', 'comms', 'offline', 'health', 'clothing', 'chargers', 'flightFood', 'flightComfort'];
const PREP = new Set(['documents', 'money', 'comms', 'offline']);
export const groupKind = (g) => (PREP.has(g) ? 'prep' : 'pack');
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

/** Done / total per kind. pct is rounded down (100 only when all are done), null when there is nothing. */
export function progress(items = []) {
  const bar = (kind) => {
    const list = items.filter((x) => groupKind(x.group) === kind);
    const done = list.filter((x) => x.done).length;
    return { done, total: list.length, pct: list.length ? Math.floor((done / list.length) * 100) : null };
  };
  return { prep: bar('prep'), pack: bar('pack') };
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
