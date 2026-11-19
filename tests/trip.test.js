// Trip setup logic (docs/GOALS_TRIP_SETUP.md T1-T6). Written before src/js/core/trip.js and store.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  todayIn, daysBetween, tripStatus, validateDates, validateBudget, budgetSummary, setupProgress, MAX_TRIP_DAYS,
} from '../src/js/core/trip.js';
import { createStore } from '../src/js/core/store.js';

test('todayIn returns the calendar date in the destination time zone', () => {
  // 20:30 UTC on 1 March = 03:30 on 2 March in Bangkok (UTC+7), still 1 March in UTC.
  const now = new Date(Date.UTC(2027, 2, 1, 20, 30));
  assert.equal(todayIn('Asia/Bangkok', now), '2027-03-02');
  assert.equal(todayIn('UTC', now), '2027-03-01');
});

test('daysBetween counts calendar days, across months, years and leap days', () => {
  assert.equal(daysBetween('2027-03-01', '2027-03-01'), 0);
  assert.equal(daysBetween('2027-03-01', '2027-03-11'), 10);
  assert.equal(daysBetween('2027-03-11', '2027-03-01'), -10);
  assert.equal(daysBetween('2027-12-30', '2028-01-02'), 3);
  assert.equal(daysBetween('2028-02-28', '2028-03-01'), 2); // 2028 is a leap year
  assert.equal(daysBetween('2027-02-28', '2027-03-01'), 1);
});

test('tripStatus: before, first day, middle, last day, after, and no dates', () => {
  const trip = { start: '2027-03-10', end: '2027-03-19' }; // 10 days
  assert.deepEqual(tripStatus(trip, '2027-03-01'), { phase: 'before', daysToGo: 9, length: 10 });
  assert.deepEqual(tripStatus(trip, '2027-03-09'), { phase: 'before', daysToGo: 1, length: 10 });
  assert.deepEqual(tripStatus(trip, '2027-03-10'), { phase: 'during', day: 1, length: 10 });
  assert.deepEqual(tripStatus(trip, '2027-03-14'), { phase: 'during', day: 5, length: 10 });
  assert.deepEqual(tripStatus(trip, '2027-03-19'), { phase: 'during', day: 10, length: 10 });
  assert.deepEqual(tripStatus(trip, '2027-03-20'), { phase: 'after', length: 10 });
  assert.deepEqual(tripStatus({ start: '2027-03-10', end: '2027-03-10' }, '2027-03-10'), { phase: 'during', day: 1, length: 1 });
  assert.deepEqual(tripStatus(null, '2027-03-01'), { phase: 'unset' });
  assert.deepEqual(tripStatus({}, '2027-03-01'), { phase: 'unset' });
});

test('validateDates blocks missing, impossible, reversed and overlong ranges', () => {
  assert.deepEqual(validateDates({ start: '2027-03-10', end: '2027-03-19' }), []);
  assert.deepEqual(validateDates({ start: '2027-03-10', end: '2027-03-10' }), []);
  assert.deepEqual(validateDates({ start: '', end: '2027-03-19' }), ['start.missing']);
  assert.deepEqual(validateDates({ start: '2027-03-10' }), ['end.missing']);
  assert.deepEqual(validateDates({ start: '2027-02-30', end: '2027-03-19' }), ['start.invalid']);
  assert.deepEqual(validateDates({ start: '10/03/2027', end: '2027-03-19' }), ['start.invalid']);
  assert.deepEqual(validateDates({ start: '2027-03-19', end: '2027-03-10' }), ['end.beforeStart']);
  assert.equal(MAX_TRIP_DAYS, 365);
  assert.deepEqual(validateDates({ start: '2027-01-01', end: '2027-12-31' }), []); // 365 days
  assert.deepEqual(validateDates({ start: '2027-01-01', end: '2028-01-01' }), ['range.tooLong']);
});

test('validateBudget accepts positive amounts in an allowed currency only', () => {
  const allowed = ['ILS', 'THB', 'USD'];
  assert.deepEqual(validateBudget({ amount: '12000', currency: 'ILS' }, allowed), []);
  assert.deepEqual(validateBudget({ amount: '12,500.50', currency: 'THB' }, allowed), []);
  assert.deepEqual(validateBudget({ amount: '', currency: 'ILS' }, allowed), ['amount.missing']);
  assert.deepEqual(validateBudget({ amount: 'abc', currency: 'ILS' }, allowed), ['amount.invalid']);
  assert.deepEqual(validateBudget({ amount: '-5', currency: 'ILS' }, allowed), ['amount.invalid']);
  assert.deepEqual(validateBudget({ amount: '0', currency: 'ILS' }, allowed), ['amount.invalid']);
  assert.deepEqual(validateBudget({ amount: '1e9999', currency: 'ILS' }, allowed), ['amount.invalid']);
  assert.deepEqual(validateBudget({ amount: '100', currency: 'XYZ' }, allowed), ['currency.invalid']);
});

test('budgetSummary: nothing invented; spent is the sum of recorded expenses', () => {
  assert.equal(budgetSummary(null), null);
  assert.deepEqual(budgetSummary({ amount: 12000, currency: 'ILS' }), { total: 12000, spent: 0, left: 12000, currency: 'ILS' });
  assert.deepEqual(budgetSummary({ amount: 1000, currency: 'ILS' }, [{ amount: 250.5 }, { amount: 100 }]), { total: 1000, spent: 350.5, left: 649.5, currency: 'ILS' });
  // Floating point must not leak: 0.1 + 0.2 style sums stay exact to the agora/satang.
  assert.equal(budgetSummary({ amount: 1, currency: 'ILS' }, [{ amount: 0.1 }, { amount: 0.2 }]).left, 0.7);
});

test('setupProgress counts the two setup steps', () => {
  assert.deepEqual(setupProgress({}), { done: 0, total: 2, dates: false, budget: false });
  assert.deepEqual(setupProgress({ dates: { start: '2027-03-10', end: '2027-03-19' } }), { done: 1, total: 2, dates: true, budget: false });
  assert.deepEqual(setupProgress({ dates: { start: '2027-03-10', end: '2027-03-19' }, budget: { amount: 5, currency: 'ILS' } }).done, 2);
});

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k), map };
}

test('store saves under the configured prefix and survives a reload', () => {
  const storage = memoryStorage();
  const a = createStore(storage, 'tisa:');
  assert.deepEqual(a.load(), {});
  a.save({ dates: { start: '2027-03-10', end: '2027-03-19' } });
  assert.ok(storage.map.has('tisa:trip'));
  assert.deepEqual(createStore(storage, 'tisa:').load(), { dates: { start: '2027-03-10', end: '2027-03-19' } });
});

test('store ignores corrupt or foreign data instead of crashing', () => {
  const storage = memoryStorage();
  storage.setItem('tisa:trip', '{not json');
  assert.deepEqual(createStore(storage, 'tisa:').load(), {});
  storage.setItem('tisa:trip', JSON.stringify({ v: 99, trip: { dates: 1 } }));
  assert.deepEqual(createStore(storage, 'tisa:').load(), {});
  storage.setItem('tisa:trip', JSON.stringify({ v: 1, trip: { dates: { start: '2027-03-19', end: '2027-03-10' } } }));
  assert.deepEqual(createStore(storage, 'tisa:').load(), {}, 'invalid saved dates are dropped');
});

test('store works when storage is blocked (private mode)', () => {
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  const s = createStore(blocked, 'tisa:');
  assert.deepEqual(s.load(), {});
  assert.equal(s.save({ budget: { amount: 5, currency: 'ILS' } }), false);
  assert.equal(createStore(null, 'tisa:').save({}), false);
});

test('store can clear one part of the trip', () => {
  const storage = memoryStorage();
  const s = createStore(storage, 'tisa:');
  s.save({ dates: { start: '2027-03-10', end: '2027-03-19' }, budget: { amount: 5, currency: 'ILS' } });
  s.save({ ...s.load(), budget: undefined });
  assert.deepEqual(s.load(), { dates: { start: '2027-03-10', end: '2027-03-19' } });
});
