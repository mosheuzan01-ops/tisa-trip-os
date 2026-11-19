// 0.5.1 text search (docs/GOALS_STAGE5.md S51-1..S51-3). Written before src/js/core/search.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, matches, searchList, sumBase } from '../src/js/core/search.js';

test('S51-1: normalize: trims, collapses spaces, ignores letter case', () => {
  assert.equal(normalize('  מלון   בבנגקוק '), 'מלון בבנגקוק');
  assert.equal(normalize('eSIM'), 'esim');
  assert.equal(normalize(undefined), '');
});

test('S51-1: partial, case-insensitive match over any of the fields; empty query matches everything', () => {
  const f = ['מלון בבנגקוק', 'לינה', 'בנגקוק', 'מזומן', ''];
  assert.equal(matches(f, 'בנגקוק'), true);
  assert.equal(matches(f, 'מלון'), true);
  assert.equal(matches(f, 'לון בב'), true, 'partial inside a word and across a space');
  assert.equal(matches(['eSIM או כרטיס SIM'], 'esim'), true);
  assert.equal(matches(['ESIM'], 'eSim'), true);
  assert.equal(matches(f, 'פוקט'), false);
  assert.equal(matches(f, ''), true);
  assert.equal(matches(f, '   '), true);
  assert.equal(matches([null, undefined, 'קפה'], 'קפה'), true, 'missing fields are skipped');
});

test('S51-1: no fuzzy matching: a typo does not match', () => {
  assert.equal(matches(['בנגקוק'], 'בנקוק'), false);
});

test('S51-2: searchList keeps order, does not touch the input, and uses the fields the caller gives', () => {
  const list = [{ id: 'a', d: 'מלון בבנגקוק' }, { id: 'b', d: 'פאד תאי' }, { id: 'c', d: 'מלון בצ׳יאנג מאי' }];
  assert.deepEqual(searchList(list, 'מלון', (x) => [x.d]).map((x) => x.id), ['a', 'c']);
  assert.deepEqual(searchList(list, '', (x) => [x.d]).map((x) => x.id), ['a', 'b', 'c']);
  assert.equal(list.length, 3);
});

test('S51-3: the filtered sum is in whole agorot and only for the shown items', () => {
  assert.equal(sumBase([{ baseMinor: 120000 }, { baseMinor: 95000 }]), 215000);
  assert.equal(sumBase([]), 0);
  assert.equal(sumBase([{ baseMinor: 10 }, { baseMinor: 20 }]), 30, 'integers only: no 0.1 + 0.2 drift');
});

import { readText } from './helpers.js';
test('S51-7: every data-slot in index.html is unique (a shared name once hid the filter bar behind the status bar)', () => {
  const slots = [...readText('index.html').matchAll(/data-slot="([^"]+)"/g)].map((m) => m[1]);
  const scoped = new Set(['search-input']); // the shared search box: always queried inside its own [data-search] root
  const dup = slots.filter((x, i) => slots.indexOf(x) !== i && !scoped.has(x));
  assert.deepEqual(dup, []);
  assert.match(readText('src/js/search-view.js'), /root\.querySelector\('\[data-slot="search-input"\]'\)/, 'the scoped slot is looked up inside its root');
});
