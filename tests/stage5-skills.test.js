// Gaps found by the personal-os-tool-site skill audit (2026-11-19): status filter and a visible "last updated" on rates.
// Written before the code (TDD). docs/GOALS_STAGE5.md S5-13, S5-14.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hideDone } from '../src/js/core/checklist.js';
import { effectiveRates, stampRates } from '../src/js/core/money.js';
import { TH } from '../data/packs/th.js';

test('S5-13: hideDone keeps the list as is when off, and drops ticked items / done tasks when on', () => {
  const items = [{ id: 'a', done: true }, { id: 'b', done: false }];
  const tasks = [{ id: 't', status: 'done' }, { id: 'u', status: 'doing' }, { id: 'v', status: 'open' }];
  assert.deepEqual(hideDone(items, false).map((x) => x.id), ['a', 'b']);
  assert.deepEqual(hideDone(items, true).map((x) => x.id), ['b']);
  assert.deepEqual(hideDone(tasks, true).map((x) => x.id), ['u', 'v']);
  assert.equal(items.length, 2, 'input untouched');
});

test('S5-14: edited rates carry the date they were set; planning rates have none', () => {
  assert.deepEqual(stampRates({ ILS_THB: 12 }, '2026-11-25'), { ILS_THB: 12, updatedAt: '2026-11-25' });
  assert.deepEqual(stampRates({}, '2026-11-25'), {}, 'back to planning rates: no date');
  const r = effectiveRates({ ILS_THB: 12, updatedAt: '2026-11-25' }, TH.planningRates);
  assert.deepEqual(r, { ILS_THB: 12, USD_ILS: 3.7, USD_THB: 37, planning: false, updatedAt: '2026-11-25' });
  assert.equal(effectiveRates({}, TH.planningRates).updatedAt, null);
});
