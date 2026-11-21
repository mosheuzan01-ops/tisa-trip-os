// Stage 4 add-ons (docs/GOALS_STAGE4.md S4-14..S4-17): FX converter, ATM cost, expense split, scenarios.
// Written before the code in src/js/core/money.js and src/js/core/split.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveRates, convertAll, atmCost, profileToBudget, EMERGENCY } from '../src/js/core/money.js';
import { validatePerson, splitShares, balances, settle, PERSON_MAX } from '../src/js/core/split.js';
import { TH } from '../data/packs/th.js';
// Stage 9 (owner, 2026-11-21): the old route, dates and profiles moved to TH.archive (kept, not the default).

const RATES = effectiveRates({}, TH.planningRates);

test('S4-14: the converter shows one amount in every currency, from any currency', () => {
  assert.deepEqual(convertAll(10000, 'ILS', RATES), [{ currency: 'ILS', minor: 10000 }, { currency: 'THB', minor: 100000 }, { currency: 'USD', minor: 2703 }]);
  assert.deepEqual(convertAll(100000, 'THB', RATES), [{ currency: 'ILS', minor: 10000 }, { currency: 'THB', minor: 100000 }, { currency: 'USD', minor: 2703 }]);
  assert.deepEqual(convertAll(1000, 'USD', RATES).map((x) => x.minor), [3700, 37000, 1000]);
  const edited = effectiveRates({ ILS_THB: 9.5 }, TH.planningRates);
  assert.equal(convertAll(10000, 'ILS', edited)[1].minor, 95000, 'uses the user\'s rates');
  assert.deepEqual(convertAll(NaN, 'ILS', RATES), []);
  assert.deepEqual(convertAll(100, 'EUR', RATES), []);
});

test('S4-15: ATM cost: fee in baht and shekels, and the fee as a share of the withdrawal', () => {
  const r = atmCost(1000000, 22000, RATES); // 10,000 THB with a 220 THB fee
  assert.deepEqual(r, { totalMinor: 1022000, feePct: 2.2, totalBaseMinor: 102200, feeBaseMinor: 2200 });
  assert.equal(atmCost(200000, 22000, RATES).feePct, 11);
  assert.equal(atmCost(NaN, 22000, RATES), null);
  assert.equal(atmCost(100000, -1, RATES), null);
  assert.equal(atmCost(100000, 0, RATES).feePct, 0, 'a zero fee is allowed');
  assert.deepEqual(TH.atmFee, { amount: 220, currency: 'THB' });
});

test('S4-17: scenarios are renamed (optimal / average / saving), amounts unchanged, emergency 2,500 by default', () => {
  assert.deepEqual(TH.archive.budgetProfiles.map((p) => [p.id, p.name.he, p.total]), [
    ['saver', 'חסכון', 9800], ['realistic', 'ממוצע', 15270], ['comfort', 'אופטימלי', 21400],
  ]);
  for (const p of TH.archive.budgetProfiles) {
    assert.ok(p.description?.he && p.description?.en, `${p.id} has an explanation`);
    assert.equal(p.emergency, 2500, p.id);
    assert.equal(profileToBudget(p).categoriesMinor[EMERGENCY], 250000);
  }
});

const people = [{ id: 'a', name: 'משה' }, { id: 'b', name: 'דנה' }, { id: 'c', name: 'יוסי' }];

test('S4-16: people need a unique, short name', () => {
  assert.deepEqual(validatePerson('נועה', people), []);
  assert.deepEqual(validatePerson('  ', people), ['name.missing']);
  assert.deepEqual(validatePerson('משה', people), ['name.taken']);
  assert.deepEqual(validatePerson('x'.repeat(PERSON_MAX + 1), people), ['name.tooLong']);
});

test('S4-16: shares split whole agorot; the remainder goes to the first sharers, the sum is exact', () => {
  assert.deepEqual(splitShares(10000, ['a', 'b', 'c']), { a: 3334, b: 3333, c: 3333 });
  assert.deepEqual(splitShares(10001, ['a', 'b']), { a: 5001, b: 5000 });
  assert.deepEqual(splitShares(500, ['b']), { b: 500 });
  assert.deepEqual(splitShares(500, []), {});
});

test('S4-16: balances count only paid, split expenses; settle gives the fewest transfers', () => {
  const ex = [
    { id: '1', baseMinor: 30000, status: 'paid', paidBy: 'a', sharedBy: ['a', 'b', 'c'] },
    { id: '2', baseMinor: 6000, status: 'paid', paidBy: 'b', sharedBy: ['b', 'c'] },
    { id: '3', baseMinor: 99900, status: 'planned', paidBy: 'c', sharedBy: ['a', 'b', 'c'] }, // not paid yet: ignored
    { id: '4', baseMinor: 5000, status: 'paid' }, // not split: ignored
    { id: '5', baseMinor: 4000, status: 'paid', paidBy: 'gone', sharedBy: ['a', 'gone'] }, // unknown person: ignored
  ];
  const bal = balances(ex, people);
  assert.deepEqual(bal, { a: 20000, b: -7000, c: -13000 });
  assert.equal(Object.values(bal).reduce((s, v) => s + v, 0), 0, 'balances sum to zero');
  assert.deepEqual(settle(bal), [{ from: 'c', to: 'a', minor: 13000 }, { from: 'b', to: 'a', minor: 7000 }]);
  assert.deepEqual(settle({ a: 0, b: 0 }), []);
  assert.deepEqual(settle({ a: 500, b: -200, c: -300 }), [{ from: 'c', to: 'a', minor: 300 }, { from: 'b', to: 'a', minor: 200 }]);
});
