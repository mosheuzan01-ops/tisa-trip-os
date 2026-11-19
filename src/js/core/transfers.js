// 0.5.3 flights and transfers, entered by hand. Pure functions, no DOM. Tested in tests/transfers.test.js.
// A priced transfer keeps one linked expense in sync (flight -> "flight", anything else -> "transport"), so the
// budget counts it exactly once. Nothing is fetched or guessed: no live prices, times or availability.
import { isIsoDate } from './trip.js';
import { parseMoney, makeExpense, editExpense } from './money.js';

export const KINDS = ['flight', 'bus', 'train', 'boat', 'car', 'other'];
/** Transfer status -> budget status of the linked expense. */
export const TRANSFER_STATUSES = { planned: 'planned', booked: 'committed', paid: 'paid' };
const MAX = { from: 60, to: 60, company: 60, booking: 40, note: 140, link: 300 };

const txt = (v) => String(v ?? '').trim();

export function validateTransfer(input = {}, currencies = []) {
  const errors = [];
  if (!KINDS.includes(input.kind)) errors.push('kind.invalid');
  for (const k of ['from', 'to']) {
    if (!txt(input[k])) errors.push(`${k}.missing`);
    else if (txt(input[k]).length > MAX[k]) errors.push(`${k}.tooLong`);
  }
  if (!input.date) errors.push('date.missing');
  else if (!isIsoDate(input.date)) errors.push('date.invalid');
  if (input.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) errors.push('time.invalid');
  for (const k of ['company', 'booking', 'note']) if (txt(input[k]).length > MAX[k]) errors.push(`${k}.tooLong`);
  if (txt(input.price) !== '') {
    if (Number.isNaN(parseMoney(input.price))) errors.push('price.invalid');
    else if (!currencies.includes(input.currency)) errors.push('currency.invalid');
  }
  const link = txt(input.link);
  if (link && (!/^https?:\/\/\S+$/i.test(link) || link.length > MAX.link)) errors.push('link.invalid');
  if (!Object.hasOwn(TRANSFER_STATUSES, input.status)) errors.push('status.invalid');
  return errors;
}

export function makeTransfer(input, makeId, existing = null) {
  return {
    ...(existing ?? {}),
    id: existing?.id ?? makeId(),
    kind: input.kind,
    from: txt(input.from),
    to: txt(input.to),
    date: input.date,
    time: input.time || '',
    company: txt(input.company),
    booking: txt(input.booking),
    priceMinor: txt(input.price) === '' ? null : parseMoney(input.price),
    currency: input.currency,
    link: txt(input.link),
    status: input.status,
    note: txt(input.note),
    expenseId: existing?.expenseId ?? null,
  };
}

/** The expense a priced transfer stands for, or null without a price. Editing keeps the original rate (S4-3). */
export function expenseFor(t, rates, makeId, existing) {
  if (!Number.isInteger(t.priceMinor)) return null;
  const input = {
    amount: (t.priceMinor / 100).toFixed(2),
    currency: t.currency,
    category: t.kind === 'flight' ? 'flight' : 'transport',
    date: t.date,
    status: TRANSFER_STATUSES[t.status],
    method: existing?.method ?? 'card',
    description: `${t.from} – ${t.to}`,
    note: existing?.note ?? '',
    destinationId: existing?.destinationId ?? '',
  };
  const e = existing ? editExpense(existing, input, rates) : makeExpense(input, rates, makeId);
  return { ...e, transferId: t.id };
}

const unlink = (e) => { const { transferId, ...rest } = e; return rest; };

/** Add or edit a transfer and keep its linked expense in step. Returns a new { ...trip, transfers, expenses }. */
export function saveTransfer(trip, input, existing, rates, makeId) {
  const t = makeTransfer(input, makeId, existing);
  let expenses = [...(trip.expenses ?? [])];
  const linked = t.expenseId ? expenses.find((e) => e?.id === t.expenseId) ?? null : null;
  if (Number.isInteger(t.priceMinor)) {
    const e = expenseFor(t, rates, makeId, linked);
    t.expenseId = e.id;
    expenses = linked ? expenses.map((x) => (x?.id === e.id ? e : x)) : [...expenses, e];
  } else {
    t.expenseId = null;
    if (linked) expenses = expenses.map((x) => (x?.id === linked.id ? unlink(x) : x)); // never deleted silently
  }
  const others = (trip.transfers ?? []).filter((x) => x?.id !== t.id);
  return { ...trip, transfers: [...others, t], expenses };
}

/** Remove a transfer. Its linked expense goes too only when the user said so; otherwise it stays, unlinked. */
export function removeTransfer(trip, id, withExpense) {
  const t = (trip.transfers ?? []).find((x) => x?.id === id);
  const expenses = (trip.expenses ?? [])
    .filter((e) => !(withExpense && t?.expenseId && e?.id === t.expenseId))
    .map((e) => (e?.transferId === id ? unlink(e) : e));
  return { ...trip, transfers: (trip.transfers ?? []).filter((x) => x?.id !== id), expenses };
}

const key = (t) => `${t.date} ${t.time || '00:00'}`;
export const sortTransfers = (list = []) => [...list].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

/** Transfers on any day of a stop, arrival and departure days included. */
export const transfersForStop = (list = [], stop) => sortTransfers(list.filter((t) => t.date >= stop.startDate && t.date <= stop.endDate));
