// 0.5.3 flights and transfers, manual entry (docs/GOALS_STAGE5.md T-1..T-6). Written before src/js/core/transfers.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KINDS, TRANSFER_STATUSES, validateTransfer, makeTransfer, expenseFor, saveTransfer, removeTransfer, sortTransfers, transfersForStop,
} from '../src/js/core/transfers.js';
import { effectiveRates, summarize } from '../src/js/core/money.js';
import { TH } from '../data/packs/th.js';

const RATES = effectiveRates({}, TH.planningRates);
const CUR = ['ILS', 'THB', 'USD'];
let n = 0;
const id = () => `t${++n}`;
const base = { kind: 'flight', from: 'תל אביב', to: 'בנגקוק', date: '2026-12-05', time: '', company: '', booking: '', price: '', currency: 'ILS', link: '', status: 'planned', note: '' };

test('T-1: kinds and statuses; statuses map onto the budget statuses', () => {
  assert.deepEqual(KINDS, ['flight', 'bus', 'train', 'boat', 'car', 'other']);
  assert.deepEqual(TRANSFER_STATUSES, { planned: 'planned', booked: 'committed', paid: 'paid' });
});

test('T-1: validateTransfer checks every field the user can type', () => {
  assert.deepEqual(validateTransfer(base, CUR), []);
  assert.deepEqual(validateTransfer({ ...base, from: ' ' }, CUR), ['from.missing']);
  assert.deepEqual(validateTransfer({ ...base, to: '' }, CUR), ['to.missing']);
  assert.deepEqual(validateTransfer({ ...base, date: '' }, CUR), ['date.missing']);
  assert.deepEqual(validateTransfer({ ...base, date: '2026-02-30' }, CUR), ['date.invalid']);
  assert.deepEqual(validateTransfer({ ...base, time: '25:00' }, CUR), ['time.invalid']);
  assert.deepEqual(validateTransfer({ ...base, time: '07:45' }, CUR), []);
  assert.deepEqual(validateTransfer({ ...base, price: '1.999' }, CUR), ['price.invalid']);
  assert.deepEqual(validateTransfer({ ...base, price: '2600', currency: 'EUR' }, CUR), ['currency.invalid']);
  assert.deepEqual(validateTransfer({ ...base, link: 'javascript:alert(1)' }, CUR), ['link.invalid']);
  assert.deepEqual(validateTransfer({ ...base, link: 'https://example.org/booking' }, CUR), []);
  assert.deepEqual(validateTransfer({ ...base, kind: 'rocket' }, CUR), ['kind.invalid']);
  assert.deepEqual(validateTransfer({ ...base, status: 'maybe' }, CUR), ['status.invalid']);
  assert.deepEqual(validateTransfer({ ...base, booking: 'x'.repeat(41) }, CUR), ['booking.tooLong']);
});

test('T-2: a priced transfer makes a linked expense: flight -> flight, others -> transport; status maps', () => {
  const t = makeTransfer({ ...base, price: '2600', status: 'booked' }, id);
  const e = expenseFor(t, RATES, () => 'e1', null);
  assert.deepEqual([e.id, e.category, e.status, e.amountMinor, e.baseMinor, e.date, e.transferId], ['e1', 'flight', 'committed', 260000, 260000, '2026-12-05', t.id]);
  const bus = makeTransfer({ ...base, kind: 'bus', price: '600', currency: 'THB', status: 'paid' }, id);
  const eb = expenseFor(bus, RATES, () => 'e2', null);
  assert.deepEqual([eb.category, eb.status, eb.amountMinor, eb.baseMinor], ['transport', 'paid', 60000, 6000]);
  assert.equal(expenseFor(makeTransfer(base, id), RATES, () => 'x', null), null, 'no price: no expense');
});

test('T-3: saving keeps transfer and expense in sync; the budget sees it exactly once', () => {
  let trip = { transfers: [], expenses: [] };
  trip = saveTransfer(trip, { ...base, price: '2600', status: 'booked' }, null, RATES, id);
  assert.equal(trip.transfers.length, 1);
  assert.equal(trip.expenses.length, 1);
  const t = trip.transfers[0];
  assert.equal(t.expenseId, trip.expenses[0].id);
  const budget = { categoriesMinor: { flight: 390000 } };
  assert.equal(summarize(budget, trip.expenses).committedMinor, 260000);
  // edit: paid now, new price -> same expense updated, not a second one
  trip = saveTransfer(trip, { ...base, price: '2500', status: 'paid' }, t, RATES, id);
  assert.equal(trip.expenses.length, 1);
  assert.deepEqual([trip.expenses[0].status, trip.expenses[0].amountMinor], ['paid', 250000]);
  assert.equal(summarize(budget, trip.expenses).paidMinor, 250000);
  // edit without changing the money keeps the expense's original rate (S4-3)
  const thb = saveTransfer({ transfers: [], expenses: [] }, { ...base, kind: 'boat', price: '1000', currency: 'THB' }, null, RATES, id);
  const newRates = effectiveRates({ ILS_THB: 12 }, TH.planningRates);
  const again = saveTransfer(thb, { ...base, kind: 'boat', price: '1000', currency: 'THB', note: 'מעבורת בוקר' }, thb.transfers[0], newRates, id);
  assert.equal(again.expenses[0].baseMinor, 10000);
});

test('T-3: clearing the price unlinks but never deletes the expense silently; a deleted expense is re-created on save', () => {
  let trip = saveTransfer({ transfers: [], expenses: [] }, { ...base, price: '2600' }, null, RATES, id);
  const t = trip.transfers[0];
  trip = saveTransfer(trip, { ...base, price: '' }, t, RATES, id);
  assert.equal(trip.expenses.length, 1, 'the expense stays on the money screen');
  assert.equal(trip.transfers[0].expenseId, null);
  assert.equal(trip.expenses[0].transferId, undefined);
  let t2 = saveTransfer({ transfers: [], expenses: [] }, { ...base, price: '100' }, null, RATES, id);
  t2 = { ...t2, expenses: [] }; // the user deleted it on the money screen
  t2 = saveTransfer(t2, { ...base, price: '100' }, t2.transfers[0], RATES, id);
  assert.equal(t2.expenses.length, 1);
  assert.equal(t2.transfers[0].expenseId, t2.expenses[0].id);
});

test('T-4: removing a transfer removes its expense only when asked', () => {
  const trip = saveTransfer({ transfers: [], expenses: [{ id: 'other', baseMinor: 5 }] }, { ...base, price: '2600' }, null, RATES, id);
  const t = trip.transfers[0];
  const keep = removeTransfer(trip, t.id, false);
  assert.deepEqual([keep.transfers.length, keep.expenses.length], [0, 2]);
  assert.equal(keep.expenses.find((e) => e.id !== 'other').transferId, undefined, 'kept expense is unlinked');
  const both = removeTransfer(trip, t.id, true);
  assert.deepEqual([both.transfers.length, both.expenses.map((e) => e.id)], [0, ['other']]);
});

test('T-5: transfers sort by date then time; each stop shows the transfers on its days', () => {
  const list = [
    makeTransfer({ ...base, date: '2026-12-08', time: '14:00' }, id),
    makeTransfer({ ...base, date: '2026-12-08', time: '07:00' }, id),
    makeTransfer({ ...base, date: '2026-12-05', time: '' }, id),
  ];
  assert.deepEqual(sortTransfers(list).map((x) => `${x.date} ${x.time}`), ['2026-12-05 ', '2026-12-08 07:00', '2026-12-08 14:00']);
  const stop = { startDate: '2026-12-05', endDate: '2026-12-08' };
  assert.equal(transfersForStop(list, stop).length, 3, 'arrival day and departure day both count');
  assert.equal(transfersForStop(list, { startDate: '2026-12-06', endDate: '2026-12-07' }).length, 0);
});
