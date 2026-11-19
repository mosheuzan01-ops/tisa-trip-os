// Stage 4 polish, 0.4.2 (docs/GOALS_STAGE4.md S4-18..S4-22). Written before the code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, affordability, toCsv, effectiveRates, makeExpense } from '../src/js/core/money.js';
import { expenseShares, validateSplit, balances, settle } from '../src/js/core/split.js';
import { TH } from '../data/packs/th.js';

const RATES = effectiveRates({}, TH.planningRates);

test('S4-18: free before planning (budget - paid) and free after planning (also minus planned and committed)', () => {
  const budget = { categoriesMinor: { food: 100000, lodging: 100000 } };
  const ex = [
    { category: 'food', status: 'paid', baseMinor: 30000 },
    { category: 'food', status: 'planned', baseMinor: 20000 },
    { category: 'lodging', status: 'committed', baseMinor: 50000 },
  ];
  const s = summarize(budget, ex);
  assert.equal(s.freeBeforePlanMinor, 170000);
  assert.equal(s.freeMinor, 100000);
});

test('S4-19: "is it worth it?" checks a purchase against free money and the daily amount', () => {
  const s = { freeMinor: 100000, hasBudget: true };
  assert.deepEqual(affordability(s, 20000, 10), { freeNowMinor: 100000, freeAfterMinor: 80000, dailyNow: { kind: 'ok', minor: 10000 }, dailyAfter: { kind: 'ok', minor: 8000 }, verdict: 'ok' });
  const over = affordability(s, 120000, 10);
  assert.equal(over.verdict, 'over');
  assert.equal(over.freeAfterMinor, -20000);
  assert.deepEqual(over.dailyAfter, { kind: 'over', minor: -20000 });
  assert.equal(affordability(s, 100000, 10).verdict, 'ok', 'exactly zero left is still within budget');
  assert.equal(affordability(s, NaN, 10), null);
  assert.equal(affordability({ freeMinor: 0, hasBudget: false }, 100, 10).verdict, 'noBudget');
  assert.deepEqual(affordability(s, 20000, null).dailyAfter, { kind: 'noDates' });
});

test('S4-20: CSV is Excel-friendly (BOM, CRLF) and escapes commas, quotes and new lines', () => {
  const csv = toCsv([['תאריך', 'תיאור', 'סכום'], ['2026-12-12', 'פאד "תאי", חריף', '300.00'], ['2026-12-13', 'שורה\nשנייה', '1']]);
  assert.ok(csv.startsWith('﻿'));
  assert.equal(csv, '﻿תאריך,תיאור,סכום\r\n2026-12-12,"פאד ""תאי"", חריף",300.00\r\n2026-12-13,"שורה\nשנייה",1\r\n');
  assert.ok(!/^=|,=/.test(toCsv([['=SUM(A1)']]).slice(1)), 'formulas are neutralised');
});

const people = [{ id: 'a', name: 'משה' }, { id: 'b', name: 'דנה' }, { id: 'c', name: 'יוסי' }];

test('S4-21: uneven split by percent or by amount; shares are exact agorot', () => {
  assert.deepEqual(expenseShares({ baseMinor: 10000, sharedBy: ['a', 'b', 'c'] }), { a: 3334, b: 3333, c: 3333 }, 'equal (0.4.1 data) still works');
  assert.deepEqual(expenseShares({ baseMinor: 10000, split: { mode: 'percent', shares: { a: 7000, b: 3000 } } }), { a: 7000, b: 3000 });
  assert.deepEqual(expenseShares({ baseMinor: 1001, split: { mode: 'percent', shares: { a: 5000, b: 5000 } } }), { a: 501, b: 500 });
  // 300 THB at 0.1: a pays 200 THB, b 100 THB of it -> 20 and 10 ILS
  const thb = makeExpense({ amount: '300', currency: 'THB', category: 'food', date: '2026-12-12', status: 'paid', method: 'cash' }, RATES, () => 'x');
  assert.deepEqual(expenseShares({ ...thb, split: { mode: 'amount', shares: { a: 20000, b: 10000 } } }), { a: 2000, b: 1000 });
  assert.deepEqual(expenseShares({ baseMinor: 1000, amountMinor: 3000, split: { mode: 'amount', shares: { a: 1000, b: 1000, c: 1000 } } }), { a: 334, b: 333, c: 333 });
  assert.equal(expenseShares({ baseMinor: 1000 }), null, 'not split');
});

test('S4-21: validateSplit: percents must add up to 100, amounts to the expense amount', () => {
  assert.deepEqual(validateSplit('percent', { a: 7000, b: 3000 }, 5000), []);
  assert.deepEqual(validateSplit('percent', { a: 7000, b: 2000 }, 5000), ['percent.sum']);
  assert.deepEqual(validateSplit('amount', { a: 3000, b: 2000 }, 5000), []);
  assert.deepEqual(validateSplit('amount', { a: 3000, b: 1000 }, 5000), ['amount.sum']);
  assert.deepEqual(validateSplit('equal', { a: 1, b: 1 }, 5000), []);
  assert.deepEqual(validateSplit('percent', {}, 5000), ['shares.none']);
  assert.deepEqual(validateSplit('amount', { a: -5, b: 5005 }, 5000), ['value.invalid']);
});

test('S4-22: balances with uneven splits and recorded repayments; the debt can be closed', () => {
  const ex = [
    { baseMinor: 10000, status: 'paid', paidBy: 'a', split: { mode: 'percent', shares: { a: 7000, b: 3000 } } },
    { baseMinor: 6000, status: 'paid', paidBy: 'b', sharedBy: ['b', 'c'] },
  ];
  const bal = balances(ex, people);
  assert.deepEqual(bal, { a: 3000, b: 0, c: -3000 });
  assert.deepEqual(settle(bal), [{ from: 'c', to: 'a', minor: 3000 }]);
  const after = balances(ex, people, [{ from: 'c', to: 'a', minor: 3000 }]);
  assert.deepEqual(after, { a: 0, b: 0, c: 0 });
  assert.deepEqual(settle(after), []);
  const partial = balances(ex, people, [{ from: 'c', to: 'a', minor: 1000 }, { from: 'x', to: 'a', minor: 999 }]);
  assert.deepEqual(partial, { a: 2000, b: 0, c: -2000 }, 'unknown people in a repayment are skipped');
});

// ---------- static guards for 0.4.2 ----------
import { readText } from './helpers.js';
import { contrastRatio, parseThemes } from '../src/js/core/contrast.js';

test('S4-23: the over-budget alert is a soft dark red: danger text on danger-soft passes 4.5:1 in both themes', () => {
  for (const [name, th] of Object.entries(parseThemes(readText('src/css/tokens.css')))) {
    assert.ok(contrastRatio(th['--danger'], th['--danger-soft']) >= 4.5, name);
    assert.ok(contrastRatio(th['--ink'], th['--danger-soft']) >= 4.5, name);
  }
});

test('S4-24: calculators and split start folded (no open attribute), with a 44px summary', () => {
  const html = readText('index.html');
  assert.match(html, /<details class="card surface settings-card fold money-split-card" data-slot="split-fold">/);
  assert.match(html, /<details class="card surface settings-card fold money-tools" data-slot="tools-fold">/);
  assert.match(readText('src/css/main.css'), /\.fold-head \{[^}]*min-height: var\(--tap\);/);
});
